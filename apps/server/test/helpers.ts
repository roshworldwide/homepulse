import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema, type ElicitRequest, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { ControlledClock } from "../src/clock.js";
import { loadConfig, type Role } from "../src/config.js";
import { createHomePulse, type HomePulse } from "../src/context.js";
import { createApp } from "../src/http.js";
import { extensions } from "../src/extensions.js";
import type { ModelProvider } from "../src/models/types.js";

export const T = (iso: string) => Date.parse(iso);

export interface TestServer {
  hp: HomePulse;
  url: string;
  base: string;
  clock: ControlledClock;
  token: (r: Role) => string;
  close: () => Promise<void>;
}

export async function startServer(opts: { at?: string; env?: Record<string, string>; provider?: ModelProvider } = {}): Promise<TestServer> {
  const env = {
    PORT: "0",
    HOST: "127.0.0.1",
    TZ: "America/Los_Angeles",
    DEMO_MODE: "false",
    APPROVAL_TIMEOUT_MS: "4000",
    MCP_ALLOWED_ORIGINS: "http://localhost:5173",
    ...opts.env,
  };
  const config = loadConfig(env, { dataDir: null });
  const clock = new ControlledClock(T(opts.at ?? "2026-10-22T14:14:00-07:00"), true);
  const hp = createHomePulse(config, { clock, dbFile: ":memory:", provider: opts.provider });
  const { app, close } = createApp(hp, extensions(hp));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    hp,
    url: `${base}/mcp`,
    base,
    clock,
    token: (r) => config.tokens[r],
    close: async () => {
      await close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type Elicit = (req: ElicitRequest["params"]) => Promise<ElicitResult> | ElicitResult;

export async function connect(ts: TestServer, role: Role, elicit?: Elicit): Promise<Client> {
  const client = new Client({ name: `test-${role}`, version: "1.0.0" }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, async (req) => elicit(req.params));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(ts.url), { requestInit: { headers: { Authorization: `Bearer ${ts.token(role)}` } } }),
  );
  if (elicit) {
    // Wait for the approver's GET stream and registration.
    for (let i = 0; i < 50 && !ts.hp.broker.connected().some((a) => a.role === role); i++) await sleep(20);
    await sleep(100);
  }
  return client;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Put a person at the door: a Ring button press right now. */
export function ring(ts: TestServer, opts: { snapshot?: string; type?: string; sub_type?: string } = {}) {
  return ts.hp.ring.ingest(
    {
      event_type: opts.type ?? "button_press",
      event_id: `evt_${Math.random().toString(16).slice(2, 10)}`,
      device_id: "sim-doorbell",
      occurred_at: new Date(ts.clock.now()).toISOString(),
      attributes: opts.sub_type ? { sub_type: opts.sub_type } : {},
    },
    { simulated: true, snapshot: opts.snapshot ?? null },
  );
}

export function structured(r: unknown): Record<string, any> {
  return (r as { structuredContent: Record<string, any> }).structuredContent;
}
