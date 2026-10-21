/**
 * Fuzzing every HTTP surface: /mcp (raw JSON-RPC and tool arguments through a
 * real MCP client), the Ring webhook, the console API and the agent routes.
 * Nothing may crash the server, return a 5xx for client garbage, leak a stack
 * trace, or open a door without a credential.
 */
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ringSignature } from "../../src/ring/webhook.js";
import { connect, ring, startServer, type TestServer } from "../helpers.js";

const RUNS = Number(process.env.FUZZ_RUNS ?? 150);
let ts: TestServer;
let sid: string;

const H = () => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${ts.token("agent")}`, "mcp-protocol-version": "2025-11-25", "mcp-session-id": sid });
const STACK = /\n\s+at |node_modules|\/home\/|\.ts:\d+/;

async function alive() {
  const r = await fetch(ts.url, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 999, method: "tools/list" }) });
  expect(r.status).toBe(200);
  await r.text();
}

beforeAll(async () => {
  ts = await startServer({ at: "2026-10-22T16:05:00-07:00" });
  const r = await fetch(ts.url, {
    method: "POST",
    headers: { ...H(), "mcp-session-id": "" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fuzz", version: "1" } } }),
  });
  sid = r.headers.get("mcp-session-id")!;
  await r.text();
  await fetch(ts.url, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).then((x) => x.text());
});
afterAll(async () => ts.close());

describe("fuzz /mcp", () => {
  test("random JSON bodies never produce a 5xx and never break the session", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue({ maxDepth: 4 }), async (body) => {
        const r = await fetch(ts.url, { method: "POST", headers: H(), body: JSON.stringify(body) });
        const text = await r.text();
        expect(r.status, text.slice(0, 200)).toBeLessThan(500);
        expect(STACK.test(text), text.slice(0, 300)).toBe(false);
      }),
      { numRuns: RUNS },
    );
    await alive();
  });

  test("random JSON-RPC requests with random methods and params", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom("tools/call", "tools/list", "resources/list", "prompts/list", "ping", "logging/setLevel", "initialize", "completion/complete"), fc.string()),
        fc.jsonValue({ maxDepth: 3 }),
        async (method, params) => {
          const r = await fetch(ts.url, { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) });
          const text = await r.text();
          expect(r.status, text.slice(0, 200)).toBeLessThan(500);
          expect(STACK.test(text), text.slice(0, 300)).toBe(false);
        },
      ),
      { numRuns: RUNS },
    );
    await alive();
  });

  test("malformed bodies, wrong headers, oversized and deeply nested bodies are rejected cleanly", async () => {
    const cases: Array<[string, RequestInit]> = [
      ["malformed JSON", { method: "POST", headers: H(), body: '{"jsonrpc":"2.0",' }],
      ["not JSON at all", { method: "POST", headers: H(), body: "\u0000ÿ garbage" }],
      ["text/plain", { method: "POST", headers: { ...H(), "Content-Type": "text/plain" }, body: "{}" }],
      ["no Accept", { method: "POST", headers: { ...H(), Accept: "" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }],
      ["bad protocol version", { method: "POST", headers: { ...H(), "mcp-protocol-version": "1999-01-01" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }],
      ["2 MB body", { method: "POST", headers: H(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { x: "a".repeat(2_000_000) } }) }],
      ["nested 20k deep", { method: "POST", headers: H(), body: "[".repeat(20_000) + "]".repeat(20_000) }],
      ["batch", { method: "POST", headers: H(), body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "ping" }]) }],
    ];
    for (const [name, init] of cases) {
      const r = await fetch(ts.url, init);
      const text = await r.text();
      expect(r.status, `${name}: ${text.slice(0, 200)}`).toBeLessThan(500);
      expect(r.status, `${name}`).not.toBe(200);
      expect(STACK.test(text), `${name} leaked: ${text.slice(0, 300)}`).toBe(false);
      expect(() => JSON.parse(text), `${name} should answer JSON: ${text.slice(0, 120)}`).not.toThrow();
    }
    await alive();
  });

  test("random tool arguments through a real MCP client: errors are tool errors, no door ever opens", async () => {
    const agent = await connect(ts, "agent");
    const tools = (await agent.listTools()).tools.map((t) => t.name);
    ring(ts);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...tools), fc.dictionary(fc.constantFrom("pass_id", "presented_code", "channel", "reason", "event_id", "utterance", "draft_id", "on", "message", "channels", "since_minutes", "decision_id", "question", "x"), fc.jsonValue({ maxDepth: 2 })), async (name, args) => {
        const t0 = performance.now();
        let res: any;
        try {
          res = await agent.callTool({ name, arguments: args });
        } catch (err) {
          // Protocol-level errors (invalid params) are acceptable; a hang or a crash is not.
          expect(String(err)).toMatch(/MCP error|Invalid|validation|Input/i);
        }
        expect(performance.now() - t0, `${name} took too long`).toBeLessThan(5_000);
        if (res?.structuredContent?.allow === true) throw new Error(`door opened by fuzzed args ${JSON.stringify(args)}`);
      }),
      { numRuns: RUNS * 2 },
    );
    expect(ts.hp.devices.frontDoor.history.filter((h) => h.state === "unlocked")).toEqual([]);
    expect(ts.hp.devices.parcelBox.history.filter((h) => h.state === "unlocked")).toEqual([]);
    await agent.close();
  }, 120_000);

  test("rule drafting has no catastrophic regex backtracking", async () => {
    const adversarial = [
      "a and ".repeat(80),
      "let " + "x ".repeat(240),
      "between 1 and " + "1 ".repeat(200),
      "Nurse " + "and Sarah ".repeat(45) + "arriving",
      "for " + "for ".repeat(120),
      "\u0000".repeat(400),
    ];
    for (const u of adversarial) {
      const t0 = performance.now();
      await ts.hp.compiler.propose(u, "homeowner");
      expect(performance.now() - t0, JSON.stringify(u.slice(0, 40))).toBeLessThan(200);
    }
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 500 }), async (u) => {
        const t0 = performance.now();
        const r = await ts.hp.compiler.propose(u, "homeowner");
        expect(["draft", "needs_clarification", "refused", "invalid"]).toContain(r.status);
        expect(performance.now() - t0).toBeLessThan(200);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("fuzz the Ring webhook", () => {
  const hook = () => `${ts.base}/ring/webhook`;
  test("any signed body is accepted and stored or logged as an alert; the chain stays intact", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue({ maxDepth: 5 }), async (v) => {
        const body = JSON.stringify(v);
        const r = await fetch(hook(), { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": ringSignature(body, ts.hp.config.ringHmacKey) }, body });
        expect(r.status).toBe(200);
      }),
      { numRuns: RUNS },
    );
    for (const occurred_at of [1e20, -1e20, 0, "garbage", "+275760-09-13T00:00:00.000Z", "9999-12-31T23:59:59Z", null, { a: 1 }]) {
      const body = JSON.stringify({ meta: { request_id: `odd-${String(occurred_at)}` }, data: { id: "e", type: "button_press", attributes: { occurred_at } } });
      const r = await fetch(hook(), { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": ringSignature(body, ts.hp.config.ringHmacKey) }, body });
      expect(r.status).toBe(200);
    }
    await new Promise((res) => setTimeout(res, 100));
    expect(ts.hp.engram.all().filter((x) => x.payload.type === "webhook_parse_error")).toEqual([]);
    const deep = "[".repeat(50_000) + "]".repeat(50_000);
    const r = await fetch(hook(), { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": ringSignature(deep, ts.hp.config.ringHmacKey) }, body: deep });
    expect(r.status).toBeLessThan(500);
    await new Promise((res) => setTimeout(res, 200));
    expect(ts.hp.engram.verify().ok).toBe(true);
    await alive();
  });

  test("unsigned or badly signed bodies are always 401", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (body, sig) => {
        const r = await fetch(hook(), { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": sig }, body });
        expect(r.status).toBe(401);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("fuzz the console and agent routes", () => {
  test("REST endpoints answer client garbage with 4xx JSON, never 5xx or a stack trace", async () => {
    const paths = ["/api/keypad", "/api/caregiver/note", "/api/home/night", "/agent/turn", "/agent/door-event", "/demo/run", "/api/inject"];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...paths), fc.oneof(fc.jsonValue({ maxDepth: 3 }).map((v) => JSON.stringify(v)), fc.string()), async (p, body) => {
        const r = await fetch(`${ts.base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        const text = await r.text();
        expect(r.status, `${p} ${body.slice(0, 80)} -> ${text.slice(0, 200)}`).toBeLessThan(500);
        expect(STACK.test(text), `${p} leaked: ${text.slice(0, 300)}`).toBe(false);
      }),
      { numRuns: RUNS },
    );
  }, 120_000);

  test("GET endpoints with random parameters", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        for (const p of [`/api/engram?as_of=${encodeURIComponent(s)}`, `/api/snapshot/${encodeURIComponent(s) || "x"}`]) {
          const r = await fetch(`${ts.base}${p}`);
          const text = await r.text();
          expect(r.status, `${p} -> ${text.slice(0, 120)}`).toBeLessThan(500);
          expect(STACK.test(text)).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });

  test("the server is still healthy and no door opened during the whole fuzz run", async () => {
    await alive();
    expect(ts.hp.engram.verify().ok).toBe(true);
    const opened = ts.hp.engram.all().filter((r) => r.payload.type === "door_unlocked");
    expect(opened).toEqual([]);
  });
});
