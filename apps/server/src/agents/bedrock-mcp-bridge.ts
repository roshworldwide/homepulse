import { BedrockRuntimeClient, ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ModelInfo } from "../models/types.js";
import type { AgentModel, AgentStep, ContentBlock, ConverseReply, ConverseRequest, Message, ToolCallResult, ToolDef, ToolExecutor } from "./types.js";

export const MAX_TOOL_STEPS = 6;

/** Bedrock Converse as an agent model. Hands MCP tools to the model as toolSpecs. */
export class BedrockAgentModel implements AgentModel {
  private client: BedrockRuntimeClient;
  constructor(
    private modelId: string,
    region: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
  }
  info(): ModelInfo {
    return { provider: "bedrock", model_id: this.modelId, label: `Amazon Bedrock · ${this.modelId}` };
  }
  async converse(req: ConverseRequest): Promise<ConverseReply> {
    const tools: Tool[] = req.tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: cleanSchema(t.inputSchema) as never } } }));
    const out = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: req.system }],
        messages: req.messages,
        toolConfig: { tools },
        inferenceConfig: { maxTokens: 700, temperature: 0 },
      }),
    );
    return { stopReason: out.stopReason ?? "end_turn", message: out.output!.message! };
  }
}

/** Bedrock accepts plain JSON Schema; drop the $schema marker some generators add. */
export function cleanSchema(s: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, ...rest } = s;
  return rest;
}

/** Real MCP client: every tool call is a real MCP round trip to /mcp with the agent token. */
export class McpToolExecutor implements ToolExecutor {
  private client: Client | null = null;
  private tools: ToolDef[] | null = null;
  constructor(
    private url: () => string,
    private token: string,
    /** Connect some other way than Streamable HTTP (the break-in page's per-attempt house uses an in-process pair). */
    private makeTransport?: () => Promise<Transport> | Transport,
  ) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "homepulse-agent", version: "1.0.0" });
    await client.connect(this.makeTransport ? await this.makeTransport() : new StreamableHTTPClientTransport(new URL(this.url()), { requestInit: { headers: { Authorization: `Bearer ${this.token}` } } }));
    this.client = client;
    return client;
  }

  /** Run fn on a connected client; if the session is gone (server restarted, session expired), reconnect once and retry. */
  private async withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.connect());
    } catch (err) {
      if (!isSessionGone(err)) throw err;
      await this.close();
      return fn(await this.connect());
    }
  }

  async list(): Promise<ToolDef[]> {
    if (this.tools) return this.tools;
    const { tools } = await this.withClient((c) => c.listTools());
    this.tools = tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown> }));
    return this.tools;
  }

  async call(name: string, args: Record<string, unknown>, meta: { lastAssistantText?: string }): Promise<ToolCallResult> {
    const r = await this.withClient((client) =>
      client.callTool(
        { name, arguments: args, _meta: meta.lastAssistantText ? { "homepulse/agent_last_message": meta.lastAssistantText } : undefined },
        undefined,
        // Physical calls may wait for a phone tap.
        { timeout: 120_000 },
      ),
    );
    const text = (r.content as Array<{ type: string; text?: string }> | undefined)?.map((c) => c.text ?? "").join(" ") ?? "";
    const json = (r.structuredContent as Record<string, unknown> | undefined) ?? { text };
    return { json, text, isError: r.isError === true };
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
    this.tools = null;
  }
}

/** The server no longer knows our session (404), or the connection was closed under us. */
export function isSessionGone(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err);
  return /Session not found|\b404\b|Not connected|Connection closed|-32001/i.test(msg);
}

const textOf = (m: Message) => (m.content ?? []).map((c) => ("text" in c && c.text ? c.text : "")).join(" ").trim();

/**
 * The agent loop: at most 6 tool steps. Each requested tool is called through
 * the executor and its result returned to the model.
 */
export async function runAgentLoop(opts: {
  model: AgentModel;
  system: string;
  executor: ToolExecutor;
  history: Message[];
  userText: string;
  onStep?: (s: AgentStep) => void;
  now: () => number;
}): Promise<{ reply: string; steps: AgentStep[]; messages: Message[] }> {
  const tools = await opts.executor.list();
  const messages: Message[] = [...opts.history, { role: "user", content: [{ text: opts.userText }] }];
  const steps: AgentStep[] = [];
  const push = (s: AgentStep) => {
    steps.push(s);
    opts.onStep?.(s);
  };
  push({ kind: "user", text: opts.userText, at: opts.now() });
  let reply = "";
  let lastAssistantText = "";
  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const out = await opts.model.converse({ system: opts.system, messages, tools });
    messages.push(out.message);
    const said = textOf(out.message);
    if (said) lastAssistantText = said;
    if (out.stopReason !== "tool_use" || step === MAX_TOOL_STEPS) {
      reply = said;
      break;
    }
    const results: ContentBlock[] = [];
    for (const c of out.message.content ?? []) {
      if (!("toolUse" in c) || !c.toolUse) continue;
      const { toolUseId, name, input } = c.toolUse;
      push({ kind: "tool_call", name, input, at: opts.now() });
      let r: ToolCallResult;
      try {
        r = await opts.executor.call(name!, (input ?? {}) as Record<string, unknown>, { lastAssistantText });
      } catch (err) {
        r = { json: { error: String(err) }, text: String(err), isError: true };
      }
      push({ kind: "tool_result", name, result: r.json, at: opts.now() });
      results.push({ toolResult: { toolUseId, content: [{ json: r.json as never }], status: r.isError ? "error" : "success" } });
    }
    messages.push({ role: "user", content: results });
  }
  push({ kind: "reply", text: reply, at: opts.now() });
  return { reply, steps, messages };
}
