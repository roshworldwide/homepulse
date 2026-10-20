import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";

export interface ApproverSession {
  session_id: string;
  role: "homeowner" | "caregiver";
  server: McpServer;
}

export interface AskResult {
  /** true = Approve/Confirm, false = Deny, null = no answer (no approver connected, dismissed, or timed out). */
  answer: boolean | null;
  role?: "homeowner" | "caregiver";
  session_id?: string;
  at?: number;
  why?: string;
}

export interface AskOptions {
  /** Shown on the approver's phone. Built by the server from its own state; outside text is marked unverified. */
  message: string;
  field: "approve" | "confirm" | "send";
  title: string;
  description: string;
  timeoutMs: number;
  /** Ties the ask to a request, for the console's pending list. */
  ref: string;
  kind: "unlock" | "rule" | "code" | "lockdown_off";
  /** Ask only these roles (default: every approver). */
  roles?: Array<"homeowner" | "caregiver">;
  /** Ask only this session (used to show a code to the person who confirmed). */
  sessionId?: string;
}

/**
 * Sends MCP elicitation requests to approver sessions (homeowner or
 * caregiver role), never to the agent's session. The first explicit answer
 * wins and the other phones' requests are cancelled.
 */
export class ApprovalBroker {
  private sessions = new Map<string, ApproverSession>();
  pending = new Map<string, { ref: string; kind: string; message: string; since: number }>();

  constructor(
    private clock: Clock,
    private bus?: Bus,
  ) {}

  register(s: ApproverSession): void {
    this.sessions.set(s.session_id, s);
    this.bus?.publish({ type: "approval", approval: { event: "approver_connected", role: s.role, count: this.sessions.size } });
  }

  unregister(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      this.bus?.publish({ type: "approval", approval: { event: "approver_disconnected", count: this.sessions.size } });
    }
  }

  connected(): ApproverSession[] {
    return [...this.sessions.values()];
  }

  async ask(opts: AskOptions): Promise<AskResult> {
    const targets = this.connected().filter(
      (s) => (!opts.roles || opts.roles.includes(s.role)) && (!opts.sessionId || s.session_id === opts.sessionId),
    );
    if (targets.length === 0) return { answer: null, why: "no approver connected" };

    const requestedSchema = {
      type: "object" as const,
      properties: { [opts.field]: { type: "boolean" as const, title: opts.title, description: opts.description } },
      required: [opts.field],
    };
    const controllers = targets.map(() => new AbortController());
    this.pending.set(opts.ref, { ref: opts.ref, kind: opts.kind, message: opts.message, since: this.clock.now() });
    this.bus?.publish({ type: "approval", approval: { event: "asked", ref: opts.ref, kind: opts.kind, message: opts.message, roles: targets.map((t) => t.role) } });

    const result = await new Promise<AskResult>((resolve) => {
      let open = targets.length;
      let done = false;
      const finish = (r: AskResult) => {
        if (done) return;
        done = true;
        controllers.forEach((c) => c.abort("answered on another device"));
        resolve(r);
      };
      const settleOne = (why: string) => {
        open -= 1;
        if (open === 0) finish({ answer: null, why });
      };
      targets.forEach((t, i) => {
        t.server.server
          .elicitInput({ message: opts.message, requestedSchema }, { signal: controllers[i].signal, timeout: opts.timeoutMs })
          .then((res) => {
            const v = res.action === "accept" ? (res.content as Record<string, unknown> | undefined)?.[opts.field] : undefined;
            if (typeof v === "boolean") finish({ answer: v, role: t.role, session_id: t.session_id, at: this.clock.now() });
            else settleOne(res.action === "decline" ? "declined" : "dismissed");
          })
          .catch((err: unknown) => settleOne(err instanceof Error && /timed out|timeout/i.test(err.message) ? "timed out" : "no answer"));
      });
    });

    this.pending.delete(opts.ref);
    this.bus?.publish({ type: "approval", approval: { event: "answered", ref: opts.ref, kind: opts.kind, answer: result.answer, role: result.role ?? null, why: result.why ?? null } });
    return result;
  }
}
