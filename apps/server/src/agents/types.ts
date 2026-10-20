import type { ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";
import type { ModelInfo } from "../models/types.js";

export type { ContentBlock, Message };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  /** Sent back to the model as a JSON tool result. */
  json: Record<string, unknown>;
  text: string;
  isError?: boolean;
}

/** Where an agent's tool calls go: real MCP (HomePulse) or a direct, unguarded executor (naive baseline). */
export interface ToolExecutor {
  list(): Promise<ToolDef[]>;
  call(name: string, args: Record<string, unknown>, meta: { lastAssistantText?: string }): Promise<ToolCallResult>;
}

export interface ConverseRequest {
  system: string;
  messages: Message[];
  tools: ToolDef[];
}

export interface ConverseReply {
  stopReason: string;
  message: Message;
}

/** The model behind an agent: live Bedrock Converse, recorded fixtures, or the scripted offline stand-in. */
export interface AgentModel {
  info(): ModelInfo;
  converse(req: ConverseRequest): Promise<ConverseReply>;
}

export interface AgentStep {
  kind: "user" | "tool_call" | "tool_result" | "reply";
  text?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  at: number;
}

export interface TurnResult {
  agent: "homepulse" | "naive";
  reply: string;
  steps: AgentStep[];
  model: ModelInfo;
  /** True when this agent's door ended the turn unlocked. */
  door_opened: boolean;
}
