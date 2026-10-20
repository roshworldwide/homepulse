import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, startServer, type TestServer } from "./helpers.js";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};

let ts: TestServer;
beforeAll(async () => {
  ts = await startServer();
});
afterAll(async () => ts.close());

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(ts.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${ts.token("agent")}`, ...headers },
    body: JSON.stringify(body),
  });
}

async function initSession(role: "agent" | "homeowner" = "agent"): Promise<string> {
  const r = await post(INIT, { Authorization: `Bearer ${ts.token(role)}` });
  expect(r.status).toBe(200);
  const sid = r.headers.get("mcp-session-id");
  expect(sid).toBeTruthy();
  await r.text();
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sid!, "mcp-protocol-version": "2025-11-25", Authorization: `Bearer ${ts.token(role)}` }).then((x) => x.text());
  return sid!;
}

describe("Streamable HTTP transport (MCP 2025-11-25)", () => {
  test("initialize returns an Mcp-Session-Id and negotiates 2025-11-25", async () => {
    const r = await post(INIT);
    expect(r.status).toBe(200);
    expect(r.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    const text = await r.text();
    expect(text).toContain('"protocolVersion":"2025-11-25"');
  });

  test("an unknown session id gets 404", async () => {
    const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "00000000-0000-0000-0000-000000000000", "mcp-protocol-version": "2025-11-25" });
    expect(r.status).toBe(404);
  });

  test("a non-initialize request without a session id gets 400", async () => {
    const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(r.status).toBe(400);
  });

  test("GET opens an SSE stream; DELETE ends the session; then 404", async () => {
    const sid = await initSession();
    const ac = new AbortController();
    const g = await fetch(ts.url, {
      method: "GET",
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${ts.token("agent")}`, "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" },
      signal: ac.signal,
    });
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toContain("text/event-stream");
    ac.abort();

    const d = await fetch(ts.url, { method: "DELETE", headers: { Authorization: `Bearer ${ts.token("agent")}`, "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" } });
    expect(d.status).toBe(200);
    const after = await post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" });
    expect(after.status).toBe(404);
  });

  test("a request from a foreign Origin gets 403 Forbidden", async () => {
    const r = await post(INIT, { Origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const ok = await post(INIT, { Origin: "http://localhost:5173" });
    expect(ok.status).toBe(200);
  });

  test("no token gets 401; an unknown token gets 401", async () => {
    expect((await post(INIT, { Authorization: "" })).status).toBe(401);
    expect((await post(INIT, { Authorization: "Bearer nope" })).status).toBe(401);
  });

  test("a session cannot be used with another role's token (403), on POST, GET and DELETE", async () => {
    const sid = await initSession("homeowner");
    const hdr = { "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25", Authorization: `Bearer ${ts.token("agent")}` };
    expect((await post({ jsonrpc: "2.0", id: 4, method: "tools/list" }, hdr)).status).toBe(403);
    expect((await fetch(ts.url, { method: "GET", headers: { ...hdr, Accept: "text/event-stream" } })).status).toBe(403);
    expect((await fetch(ts.url, { method: "DELETE", headers: hdr })).status).toBe(403);
  });

  test("tools/list shows the eight tools with their annotations", async () => {
    const c = await connect(ts, "agent");
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "get_home_status",
      "get_door_events",
      "describe_visitor",
      "propose_rule",
      "confirm_rule",
      "notify_household",
      "unlock_front_door",
      "open_parcel_box",
    ]);
    const unlock = tools.find((t) => t.name === "unlock_front_door")!;
    expect(unlock.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(Object.keys((unlock.inputSchema as { properties: object }).properties)).toEqual(["pass_id", "presented_code", "channel", "reason"]);
    expect(tools.find((t) => t.name === "describe_visitor")!.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    await c.close();
  });
});
