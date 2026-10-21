import type { HomePulse } from "../context.js";
import { rateLimiter, type Extension } from "../http.js";
import { formatClock } from "../time.js";
import { redactCodes } from "../guard/home-guard.js";
import type { AgentService } from "./homepulse.js";

/** Text the agents receive when the doorbell rings. The event itself stays in Engram as ring / untrusted. */
export function doorEventPrompt(hp: HomePulse, eventId: string, atMs: number, type: string): string {
  const what = type === "button_press" ? "Doorbell pressed" : "Person detected";
  return `[door event] ${what} at the front door at ${formatClock(atMs, hp.config.tz)} (event_id ${eventId}). Find out who is there and tell the household.`;
}

export function hallSensorPrompt(hp: HomePulse, atMs: number): string {
  const night = hp.home.nightMode(atMs);
  return `[hall sensor] Someone is at the front door from inside the house at ${formatClock(atMs, hp.config.tz)}. Night mode is ${night ? "on" : "off"}. No visitors are expected.`;
}

export function agentRoutes(hp: HomePulse, agents: AgentService): Extension {
  const allow = rateLimiter(30, 60_000);
  return {
    routes(app, json) {
      app.get("/agent/info", (_req, res) => res.json(agents.info()));

      /** The simulated Alexa+ page: a spoken (or typed) request goes to both agents. */
      app.post("/agent/turn", json, async (req, res) => {
        if (!allow(req.ip ?? req.socket.remoteAddress ?? "?")) return res.status(429).json({ error: "Too many requests" });
        const text = String(req.body?.text ?? "").slice(0, 600).trim();
        if (!text) return res.status(400).json({ error: "Say something first." });
        const which = req.body?.agents === "homepulse" || req.body?.agents === "naive" ? req.body.agents : "both";
        hp.engram.append({ kind: "input", source: "homeowner", payload: { type: "voice", text: redactCodes(text), channel: req.body?.channel === "text" ? "text" : "voice", speaker_verified: false, simulated_alexa: true } });
        try {
          res.json({ results: await agents.turn(text, which) });
        } catch (err) {
          res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
        }
      });

      /** Let both agents react to the latest (or a given) doorbell event. */
      app.post("/agent/door-event", json, async (req, res) => {
        const id = typeof req.body?.event_id === "string" ? req.body.event_id : hp.ring.events(10).at(-1)?.event_id;
        const ev = id ? hp.ring.find(id) : undefined;
        if (!ev) return res.status(404).json({ error: "No recent door event." });
        try {
          res.json({ results: await agents.turn(doorEventPrompt(hp, ev.event_id, Date.parse(ev.occurred_at), ev.type)) });
        } catch (err) {
          res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
        }
      });

      /** Scenario 4: an indoor sensor (simulated) sees Dad at the front door at night. HomePulse only. */
      app.post("/agent/hall-sensor", json, async (_req, res) => {
        const now = hp.clock.now();
        hp.engram.append({ kind: "input", source: "system", payload: { type: "hall_sensor", where: "front hall, inside", simulated: true } });
        try {
          res.json({ results: await agents.turn(hallSensorPrompt(hp, now), "homepulse") });
        } catch (err) {
          res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
        }
      });

      app.post("/agent/reset", (_req, res) => {
        agents.reset();
        res.json({ ok: true });
      });
    },
  };
}
