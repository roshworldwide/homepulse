import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import os from "node:os";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { REPO_ROOT, ROLES, type Role } from "./config.js";
import type { HomePulse } from "./context.js";
import { buildMcpServer } from "./mcp/server.js";
import type { SessionInfo } from "./tools/common.js";
import { formatWindow } from "./time.js";
import { scenarioMarker } from "./demo/scenarios.js";
import { why } from "./tools/explain_decision.js";
import { MAX_SUBSCRIBERS } from "./bus.js";

export interface Session {
  id: string;
  role: Role;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  /** Wall-clock time of the last request on this session (not the scenario clock). */
  lastSeen: number;
  /** Open server-to-client streams (GET /mcp). */
  streams: number;
  /** Requests (POST/DELETE) still being answered, e.g. a tool call waiting for a phone tap. */
  inflight: number;
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

/** Host names this server answers to when it listens beyond loopback. Interface addresses are re-read every 10 s. */
export function hostAllowList(extra: string[]): (hostname: string) => boolean {
  const fixed = new Set(["localhost", "127.0.0.1", "[::1]", os.hostname().toLowerCase(), ...extra.map((h) => h.toLowerCase())]);
  let ips = new Set<string>();
  let at = 0;
  return (hostname: string) => {
    if (fixed.has(hostname)) return true;
    if (Date.now() - at > 10_000) {
      ips = new Set(
        Object.values(os.networkInterfaces())
          .flat()
          .filter((i): i is os.NetworkInterfaceInfo => !!i)
          .map((i) => (i.family === "IPv6" ? `[${i.address}]` : i.address).toLowerCase()),
      );
      at = Date.now();
    }
    return ips.has(hostname);
  };
}

/** A small fixed-window limiter per key (client address). Old keys are swept so the map cannot grow without bound. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();
  return (key: string): boolean => {
    const now = Date.now();
    if (now - lastSweep > windowMs || hits.size > 10_000) {
      for (const [k, ts] of hits) if (!ts.some((t) => now - t < windowMs)) hits.delete(k);
      lastSweep = now;
    }
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= max;
  };
}

export function createApp(hp: HomePulse, ext: Extension[] = []) {
  const app = express();
  app.disable("x-powered-by");
  const sessions = new Map<string, Session>();
  const tokenBufs = ROLES.map((r) => [r, Buffer.from(hp.config.tokens[r], "utf8")] as const);

  /** Token -> role, compared in constant time. */
  function roleOfToken(token: string): Role | null {
    if (!token) return null;
    const got = Buffer.from(token.trim(), "utf8");
    let found: Role | null = null;
    for (const [role, buf] of tokenBufs) {
      if (got.length === buf.length && timingSafeEqual(got, buf)) found = role;
    }
    return found;
  }

  /** Bearer token -> role. */
  function roleOf(req: Request): Role | null {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    return m ? roleOfToken(m[1]) : null;
  }

  /**
   * The console, live view, agent and demo routes are open on the machine
   * itself (the local demo). From anywhere else they need a homeowner or
   * caregiver token (header, or ?token= for EventSource, which cannot set headers).
   */
  const consoleAuth = (req: Request, res: Response, next: NextFunction) => {
    if (isLoopback(req.socket.remoteAddress)) return next();
    const role = roleOf(req) ?? roleOfToken(typeof req.query.token === "string" ? req.query.token : "");
    if (role === "homeowner" || role === "caregiver") return next();
    res.status(401).json({ error: "homeowner or caregiver token required" });
  };

  // Session hygiene. A session is idle when it has no open stream and no request in progress.
  // Idle sessions expire; each role has its own cap, so one token cannot crowd out the others
  // (agent sessions can never use up the slots the homeowner's and caregiver's phones need).
  const idle = (s: Session) => s.streams === 0 && s.inflight === 0;
  function sweepSessions(): void {
    const now = Date.now();
    for (const s of [...sessions.values()]) {
      if (idle(s) && now - s.lastSeen > hp.config.sessionIdleMs) void s.transport.close().catch(() => {});
    }
  }
  /** Make room for one more session of `role`: true if there is (or now is) a free slot. */
  function makeRoom(role: Role): boolean {
    const mine = [...sessions.values()].filter((s) => s.role === role);
    if (mine.length < hp.config.sessionMax) return true;
    sweepSessions();
    const lru = mine.filter((s) => sessions.has(s.id) && idle(s)).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (lru) {
      sessions.delete(lru.id);
      void lru.transport.close().catch(() => {});
      return true;
    }
    return [...sessions.values()].filter((s) => s.role === role).length < hp.config.sessionMax;
  }
  const sweeper = setInterval(sweepSessions, Math.max(50, Math.min(30_000, Math.floor(hp.config.sessionIdleMs / 2))));
  sweeper.unref();
  const track = (s: Session, res: Response) => {
    s.inflight += 1;
    s.lastSeen = Date.now();
    res.on("close", () => {
      s.inflight = Math.max(0, s.inflight - 1);
      s.lastSeen = Date.now();
    });
  };

  // DNS-rebinding protection: only answer to Host names we expect. On loopback that is localhost;
  // when listening on other interfaces it is localhost, this machine's current addresses and name,
  // and ALLOWED_HOSTS (add the public name Ring delivers webhooks to).
  if (isLoopback(hp.config.host) || hp.config.host === "localhost") app.use(localhostHostValidation());
  else {
    const allowed = hostAllowList(hp.config.allowedHosts);
    app.use((req, res, next) => {
      let hostname = "";
      try {
        hostname = new URL(`http://${req.headers.host ?? ""}`).hostname.toLowerCase();
      } catch {
        /* unparseable */
      }
      if (hostname && allowed(hostname)) return next();
      res.status(403).json(rpcError(-32000, "Forbidden: unexpected Host header"));
    });
  }

  // Clickjacking: the console's Approve button must never be framed by another site.
  app.use((_req, res, next) => {
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "frame-ancestors 'none'");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  // 1. Raw-body routes first (Ring webhook signature needs the exact bytes).
  for (const e of ext) e.raw?.(app);

  // 2. Origin check: a browser request from an origin we do not know gets 403 (MCP 2025-11-25 transport rule).
  const originCheck = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !hp.config.allowedOrigins.includes(origin)) return res.status(403).json(rpcError(-32003, "Forbidden: origin not allowed"));
    next();
  };
  app.use(["/mcp", "/events", "/api", "/agent", "/demo"], originCheck);
  app.use(["/events", "/api/state", "/api/engram", "/api/why", "/api/snapshot", "/api/inject", "/agent", "/demo"], consoleAuth);

  const json = express.json({ limit: "1mb" });

  // 3. MCP Streamable HTTP on /mcp.
  app.post("/mcp", json, async (req, res) => {
    const role = roleOf(req);
    if (!role) return res.status(401).set("WWW-Authenticate", "Bearer").json(rpcError(-32001, "Unauthorized"));
    // 2025-11-25: a POST body is one JSON-RPC message; batching was removed from the protocol.
    if (Array.isArray(req.body)) return res.status(400).json(rpcError(-32600, "Batch requests are not supported (MCP 2025-11-25)"));
    if (req.body === null || typeof req.body !== "object") return res.status(400).json(rpcError(-32600, "Body must be a JSON-RPC message"));
    const sid = req.header("mcp-session-id");
    if (sid) {
      const s = sessions.get(sid);
      if (!s) return res.status(404).json(rpcError(-32001, "Session not found"));
      if (s.role !== role) return res.status(403).json(rpcError(-32003, "Forbidden: session belongs to a different token"));
      track(s, res);
      return s.transport.handleRequest(req, res, req.body);
    }
    if (!isInitializeRequest(req.body)) return res.status(400).json(rpcError(-32000, "Bad Request: No valid session ID provided"));
    if (!makeRoom(role)) return res.status(503).set("Retry-After", "30").json(rpcError(-32000, "Too many open sessions for this token; try again shortly"));

    let sessionId: string | undefined;
    const info: SessionInfo = { role, sessionId: () => sessionId };
    const server = buildMcpServer(hp, info);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessionId = id;
        sessions.set(id, { id, role, transport, server, createdAt: hp.clock.now(), lastSeen: Date.now(), streams: 0, inflight: 0 });
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
    s.lastSeen = Date.now();
    if (req.method !== "GET") track(s, res);
    if (req.method === "GET") {
      // Track the server-to-client stream: an approver is only asked while it is open.
      s.streams += 1;
      if (s.role === "homeowner" || s.role === "caregiver") hp.broker.streamOpened(s.id);
      res.on("close", () => {
        s.streams = Math.max(0, s.streams - 1);
        s.lastSeen = Date.now();
        if (s.streams === 0) hp.broker.streamClosed(s.id);
      });
    }
    await s.transport.handleRequest(req, res);
  };
  app.get("/mcp", bySession);
  app.delete("/mcp", bySession);

  // 4. Live updates for the console.
  let liveViews = 0;
  // Each bus event is serialised once, however many live views are open.
  const wire = new WeakMap<object, string>();
  const frame = (e: { type: string }) => {
    let f = wire.get(e);
    if (f === undefined) {
      f = `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
      wire.set(e, f);
    }
    return f;
  };
  /** A live view that stops reading is dropped rather than buffered without limit. */
  const MAX_BUFFERED = 4 * 1024 * 1024;
  app.get("/events", (req, res) => {
    if (liveViews >= MAX_SUBSCRIBERS) return res.status(503).set("Retry-After", "10").json({ error: "Too many live views open" });
    liveViews += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.on("error", () => {});
    const write = (chunk: string) => {
      if (res.writableEnded || res.destroyed) return;
      if (res.writableLength > MAX_BUFFERED) {
        res.destroy();
        return;
      }
      try {
        res.write(chunk);
      } catch {
        /* the socket went away; the close handler cleans up */
      }
    };
    write(`event: snapshot\ndata: ${JSON.stringify(snapshot(hp))}\n\n`);
    const unsub = hp.bus.subscribe((e) => write(frame(e)));
    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    ping.unref();
    let closed = false;
    res.on("close", () => {
      if (closed) return;
      closed = true;
      liveViews -= 1;
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
  const keypadLimit = rateLimiter(20, 60_000);
  app.post("/api/keypad", json, async (req, res) => {
    if (!keypadLimit(req.socket.remoteAddress ?? "?")) return res.status(429).set("Retry-After", "60").json({ error: "Too many attempts from this address" });
    const door = req.body?.door === "parcel_box" ? "parcel_box" : "front";
    const code = String(req.body?.code ?? "");
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Codes are 6 digits." });
    try {
      const { decision, effect } = await hp.homeGuard.physical(door === "front" ? "unlock_front_door" : "open_parcel_box", { presented_code: code, channel: "keypad" }, { role: "device", bucket: "keypad" });
      res.json({ allow: decision.allow, verdict: decision.allow ? "ALLOWED" : "BLOCKED", decision_id: decision.decision_id, reasons: decision.reasons, ...effect });
    } catch (err) {
      // Fail closed: the effect only ever runs after an allow, so an error means the door stayed locked.
      console.error("[homepulse] keypad check failed:", err);
      res.status(500).json({ allow: false, verdict: "BLOCKED", error: "The check failed; the door stayed locked." });
    }
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
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 500));
    res.json(Number.isNaN(asOf) ? hp.engram.tail(limit) : hp.engram.asOfTail(asOf, limit));
  });
  app.get("/api/why/:decision_id", (req, res) => {
    const w = why(hp, String(req.params.decision_id));
    if (!w) return res.status(404).json({ error: "No such decision" });
    res.json(w);
  });
  app.get("/api/engram/verify", (_req, res) => res.json(hp.engram.verify()));

  for (const e of ext) e.routes?.(app, json, roleOf);

  // 6. The built console, when present.
  const dist = path.join(REPO_ROOT, "apps/console/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(console|alexa|break-it)?$/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // 7. Anything else under an API prefix is a JSON 404; other methods on /mcp are 405.
  app.all("/mcp", (_req, res) => res.status(405).set("Allow", "GET, POST, DELETE").json(rpcError(-32000, "Method not allowed")));
  app.use(["/api", "/agent", "/demo", "/events", "/ring"], (_req, res) => res.status(404).json({ error: "Not found" }));

  // 8. One error handler: JSON only, never an HTML page or a stack trace; JSON-RPC errors on /mcp.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = (err ?? {}) as { status?: number; statusCode?: number; type?: string; message?: string };
    const code = e.status ?? e.statusCode;
    const status = typeof code === "number" && code >= 400 && code < 600 ? code : 500;
    if (status >= 500) {
      console.error(`[homepulse] ${req.method} ${req.path} failed:`, err);
      try {
        hp.engram.append({ kind: "alert", source: "system", payload: { type: "server_error", method: req.method, path: req.path, error: String(e.message ?? err).slice(0, 300) } });
      } catch {
        /* the log itself failed; the console line above is the record */
      }
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message =
      e.type === "entity.parse.failed" ? "Body is not valid JSON"
      : e.type === "entity.too.large" ? "Body too large"
      : e.type === "encoding.unsupported" || e.type === "charset.unsupported" ? "Unsupported body encoding"
      : status < 500 ? "Bad request"
      : "Internal error";
    if (req.path === "/mcp") return res.status(status).json(rpcError(e.type === "entity.parse.failed" ? -32700 : status < 500 ? -32600 : -32603, message));
    res.status(status).json({ error: message });
  });

  async function close() {
    clearInterval(sweeper);
    for (const s of [...sessions.values()]) await s.transport.close().catch(() => {});
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
