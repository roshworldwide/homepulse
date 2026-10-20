import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { REPO_ROOT, ROLES, type Role } from "./config.js";
import type { HomePulse } from "./context.js";
import { buildMcpServer } from "./mcp/server.js";
import type { SessionInfo } from "./tools/common.js";
import { formatWindow } from "./time.js";
import { scenarioMarker } from "./demo/scenarios.js";

export interface Session {
  id: string;
  role: Role;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

export interface Extension {
  /** Routes that must see the raw body (the Ring webhook) are mounted before any JSON parser. */
  raw?: (app: express.Express) => void;
  routes?: (app: express.Express, json: express.RequestHandler, roleOf: (req: Request) => Role | null) => void;
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

export function isLoopback(addr: string | undefined): boolean {
  return !!addr && (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1");
}

export function createApp(hp: HomePulse, ext: Extension[] = []) {
  const app = express();
  app.disable("x-powered-by");
  const sessions = new Map<string, Session>();
  const tokenBufs = ROLES.map((r) => [r, Buffer.from(hp.config.tokens[r], "utf8")] as const);

  /** Bearer token -> role, compared in constant time. */
  function roleOf(req: Request): Role | null {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    if (!m) return null;
    const got = Buffer.from(m[1].trim(), "utf8");
    for (const [role, buf] of tokenBufs) {
      if (got.length === buf.length && timingSafeEqual(got, buf)) return role;
    }
    return null;
  }

  // DNS-rebinding protection when bound to loopback.
  if (isLoopback(hp.config.host) || hp.config.host === "localhost") app.use(localhostHostValidation());

  // 1. Raw-body routes first (Ring webhook signature needs the exact bytes).
  for (const e of ext) e.raw?.(app);

  // 2. Origin check: a browser request from an origin we do not know gets 403 (MCP 2025-11-25 transport rule).
  const originCheck = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !hp.config.allowedOrigins.includes(origin)) return res.status(403).json(rpcError(-32003, "Forbidden: origin not allowed"));
    next();
  };
  app.use(["/mcp", "/events", "/api", "/agent"], originCheck);

  const json = express.json({ limit: "1mb" });

  // 3. MCP Streamable HTTP on /mcp.
  app.post("/mcp", json, async (req, res) => {
    const role = roleOf(req);
    if (!role) return res.status(401).set("WWW-Authenticate", "Bearer").json(rpcError(-32001, "Unauthorized"));
    const sid = req.header("mcp-session-id");
    if (sid) {
      const s = sessions.get(sid);
      if (!s) return res.status(404).json(rpcError(-32001, "Session not found"));
      if (s.role !== role) return res.status(403).json(rpcError(-32003, "Forbidden: session belongs to a different token"));
      return s.transport.handleRequest(req, res, req.body);
    }
    if (!isInitializeRequest(req.body)) return res.status(400).json(rpcError(-32000, "Bad Request: No valid session ID provided"));

    let sessionId: string | undefined;
    const info: SessionInfo = { role, sessionId: () => sessionId };
    const server = buildMcpServer(hp, info);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessionId = id;
        sessions.set(id, { id, role, transport, server, createdAt: hp.clock.now() });
      },
    });
    transport.onclose = () => {
      if (sessionId) {
        sessions.delete(sessionId);
        hp.broker.unregister(sessionId);
      }
    };
    server.server.oninitialized = () => {
      if (sessionId && (role === "homeowner" || role === "caregiver") && server.server.getClientCapabilities()?.elicitation) {
        hp.broker.register({ session_id: sessionId, role, server });
      }
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const bySession = async (req: Request, res: Response) => {
    const role = roleOf(req);
    if (!role) return res.status(401).set("WWW-Authenticate", "Bearer").json(rpcError(-32001, "Unauthorized"));
    const sid = req.header("mcp-session-id");
    if (!sid) return res.status(400).json(rpcError(-32000, "Bad Request: Mcp-Session-Id header is required"));
    const s = sessions.get(sid);
    if (!s) return res.status(404).json(rpcError(-32001, "Session not found"));
    if (s.role !== role) return res.status(403).json(rpcError(-32003, "Forbidden: session belongs to a different token"));
    await s.transport.handleRequest(req, res);
  };
  app.get("/mcp", bySession);
  app.delete("/mcp", bySession);

  // 4. Live updates for the console.
  app.get("/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("snapshot", snapshot(hp));
    const unsub = hp.bus.subscribe((e) => send(e.type, e));
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });

  // 5. Console API.
  app.get("/api/state", (_req, res) => res.json(snapshot(hp)));

  app.get("/api/console-config", (req, res) => {
    const local = isLoopback(req.socket.remoteAddress);
    res.json({
      tz: hp.config.tz,
      demo_mode: hp.config.demoMode,
      model: hp.provider.info(),
      mcp_url: "/mcp",
      tokens: hp.config.exposeTokens && local ? { homeowner: hp.config.tokens.homeowner, caregiver: hp.config.tokens.caregiver } : null,
    });
  });

  /** The simulated keypad at the door. A device, not an agent: anyone can type, the guard decides. */
  app.post("/api/keypad", json, async (req, res) => {
    const door = req.body?.door === "parcel_box" ? "parcel_box" : "front";
    const code = String(req.body?.code ?? "");
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Codes are 6 digits." });
    const { decision, effect } = await hp.homeGuard.physical(door === "front" ? "unlock_front_door" : "open_parcel_box", { presented_code: code, channel: "keypad" }, { role: "device", bucket: "keypad" });
    res.json({ allow: decision.allow, verdict: decision.allow ? "ALLOWED" : "BLOCKED", decision_id: decision.decision_id, reasons: decision.reasons, ...effect });
  });

  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    const role = roleOf(req);
    if (role !== "homeowner" && role !== "caregiver") return res.status(401).json({ error: "homeowner or caregiver token required" });
    (req as Request & { role?: Role }).role = role;
    next();
  };

  app.post("/api/home/night", json, requireOwner, (req, res) => {
    const v = req.body?.night_mode;
    hp.home.setNight(v === true ? true : v === false ? false : null);
    hp.engram.append({ kind: "input", source: (req as Request & { role: Role }).role as "homeowner" | "caregiver", payload: { type: "night_mode_set", value: hp.home.nightOverride } });
    res.json(hp.home.snapshot());
  });

  app.get("/api/engram", (req, res) => {
    const asOf = typeof req.query.as_of === "string" ? Date.parse(req.query.as_of) : NaN;
    res.json(Number.isNaN(asOf) ? hp.engram.tail(500) : hp.engram.asOf(asOf));
  });
  app.get("/api/engram/verify", (_req, res) => res.json(hp.engram.verify()));

  for (const e of ext) e.routes?.(app, json, roleOf);

  // 6. The built console, when present.
  const dist = path.join(REPO_ROOT, "apps/console/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(console|alexa|break-it)?$/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  async function close() {
    for (const s of sessions.values()) await s.transport.close().catch(() => {});
    sessions.clear();
  }

  return { app, sessions, close };
}

/** Everything the console needs to draw itself. No codes, no code hashes, no keys. */
export function snapshot(hp: HomePulse) {
  const now = hp.clock.now();
  return {
    now,
    tz: hp.config.tz,
    demo_mode: hp.config.demoMode,
    scenario: hp.scenario,
    model: hp.provider.info(),
    home: hp.home.snapshot(),
    devices: hp.devices.snapshot(),
    passes: hp.passes.all().map((r) => ({
      who: r.pass.who,
      door: r.pass.door,
      purpose: r.pass.purpose ?? null,
      window: formatWindow(r.pass.not_before, r.pass.not_after, hp.config.tz, now),
      not_before: r.pass.not_before,
      not_after: r.pass.not_after,
      allow_at_night: r.pass.allow_at_night,
      issued_by: r.pass.issued_by,
      status: r.revoked_at ? "revoked" : r.uses >= r.pass.max_uses ? "used" : Date.parse(r.pass.not_after) < now ? "expired" : "active",
    })),
    approvers: hp.broker.connected().map((a) => a.role),
    pending_approvals: [...hp.broker.pending.values()],
    drafts: hp.compiler.pendingDrafts().map((d) => ({ draft_id: d.draft_id, read_back: d.read_back, submitted_by: d.submitted_by })),
    scenario_marker: scenarioMarker(hp),
    records: hp.engram.tail(300),
  };
}
