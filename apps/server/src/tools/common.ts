import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Role } from "../config.js";
import type { HomePulse } from "../context.js";

export interface SessionInfo {
  role: Role;
  /** Filled in once the MCP session is initialised. */
  sessionId: () => string | undefined;
}

export type Register = (server: McpServer, hp: HomePulse, session: SessionInfo) => void;

export function ok(structuredContent: Record<string, unknown>, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function fail(text: string, structuredContent: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], structuredContent: { error: text, ...structuredContent }, isError: true };
}

/** The agent's latest message, passed by the HomePulse agent in request _meta. Explanation only. */
export function agentLastMessage(extra: unknown): string | undefined {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const v = meta?.["homepulse/agent_last_message"];
  return typeof v === "string" ? v.slice(0, 1000) : undefined;
}

export const doorLabel = (d: string) => (d === "front" ? "front door" : "parcel box");
