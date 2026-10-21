/**
 * Exposure checks for a server reachable from other machines (HOST=0.0.0.0):
 * the console, live view, log and agent routes need a homeowner or caregiver
 * token from anywhere but the machine itself; tokens are never handed out remotely.
 */
import http from "node:http";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startServer, type TestServer } from "../helpers.js";

const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
let ts: TestServer;
let remote = "";

describe.skipIf(!lan)("remote access to the console routes", () => {
  beforeAll(async () => {
    ts = await startServer({ listenHost: "0.0.0.0", env: { HOST: "0.0.0.0" } });
    remote = ts.base.replace("127.0.0.1", lan!);
  });
  afterAll(async () => ts.close());

  test("without a token: 401 for state, log, snapshots, live view, agent and demo routes", async () => {
    for (const [method, path] of [["GET", "/api/state"], ["GET", "/api/engram"], ["GET", "/api/engram/verify"], ["GET", "/api/snapshot/x"], ["GET", "/events"], ["POST", "/agent/turn"], ["POST", "/demo/reset"], ["POST", "/api/inject"]] as const) {
      const r = await fetch(`${remote}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      expect(r.status, `${method} ${path}`).toBe(401);
      await r.body?.cancel();
    }
  });

  test("an agent token is not enough; a homeowner token (header or ?token=) is", async () => {
    const agent = await fetch(`${remote}/api/state`, { headers: { Authorization: `Bearer ${ts.token("agent")}` } });
    expect(agent.status).toBe(401);
    const owner = await fetch(`${remote}/api/state`, { headers: { Authorization: `Bearer ${ts.token("homeowner")}` } });
    expect(owner.status).toBe(200);
    await owner.text();
    const ac = new AbortController();
    const live = await fetch(`${remote}/events?token=${ts.token("caregiver")}`, { signal: ac.signal });
    expect(live.status).toBe(200);
    ac.abort();
  });

  test("tokens are never handed to a remote browser", async () => {
    const r = (await (await fetch(`${remote}/api/console-config`)).json()) as { tokens: unknown };
    expect(r.tokens).toBeNull();
  });

  test("the keypad (a device at the door) and the MCP endpoint keep their own checks", async () => {
    const k = await fetch(`${remote}/api/keypad`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456" }) });
    expect(k.status).toBe(200);
    const m = await fetch(`${remote}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
    expect(m.status).toBe(401);
  });
});

describe.skipIf(!lan)("host and framing protection", () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startServer({ listenHost: "0.0.0.0", env: { HOST: "0.0.0.0" } });
  });
  afterAll(async () => t.close());

  test("a DNS-rebinding Host header is refused even from this machine", async () => {
    const port = Number(new URL(t.base).port);
    // fetch() will not let a caller set Host, so use a raw request, as a rebinding attack effectively does.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/state", headers: { Host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    const ok = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(ok.status).toBe(200);
    await ok.text();
  });

  test("pages cannot be framed (the Approve button cannot be clickjacked)", async () => {
    const r = await fetch(`${t.base}/api/console-config`);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
