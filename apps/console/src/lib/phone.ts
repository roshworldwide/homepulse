import { useEffect, useRef, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface Ask {
  id: number;
  message: string;
  field: string;
  title: string;
  description?: string;
  answer: (v: boolean | null) => void;
}

/**
 * A phone in the console is a real MCP client: it opens a session with the
 * homeowner or caregiver token and declares the elicitation capability, so
 * the server can ask it to approve a door or confirm a rule.
 */
export function usePhone(role: "homeowner" | "caregiver", token: string | null | undefined) {
  const [asks, setAsks] = useState<Ask[]>([]);
  const [status, setStatus] = useState<"offline" | "connecting" | "connected" | "error">("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    const client = new Client({ name: `${role}-phone`, version: "1.0.0" }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, (req, extra) => {
      const p = req.params as { message: string; requestedSchema?: { properties: Record<string, { title?: string; description?: string }> } };
      const field = Object.keys(p.requestedSchema?.properties ?? { approve: {} })[0];
      const meta = p.requestedSchema?.properties?.[field] ?? {};
      return new Promise((resolve) => {
        const id = ++seq.current;
        const remove = () => setAsks((xs) => xs.filter((a) => a.id !== id));
        // If another phone answered first, the server cancels this request.
        extra.signal.addEventListener("abort", () => {
          remove();
          resolve({ action: "cancel" });
        });
        setAsks((xs) => [
          ...xs,
          {
            id,
            message: p.message,
            field,
            title: meta.title ?? "Approve",
            description: meta.description,
            answer: (v) => {
              remove();
              resolve(v === null ? { action: "decline" } : { action: "accept", content: { [field]: v } });
            },
          },
        ]);
      });
    });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", window.location.origin), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    setStatus("connecting");
    client
      .connect(transport)
      .then(() => {
        if (closed) return;
        setStatus("connected");
        setSessionId(transport.sessionId ?? null);
      })
      .catch(() => !closed && setStatus("error"));
    return () => {
      closed = true;
      void transport.terminateSession().catch(() => {});
      void client.close();
    };
  }, [role, token]);

  return { asks, status, sessionId };
}
