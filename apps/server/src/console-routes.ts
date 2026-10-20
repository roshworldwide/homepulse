import path from "node:path";
import type { HomePulse } from "./context.js";
import { isLoopback, type Extension } from "./http.js";
import { inject } from "./ring/injector.js";
import { confirmDraft } from "./tools/rules.js";

/**
 * Console-only routes for the simulated people around the house.
 * The caregiver's note stands in for a Bee recording: it goes through the same
 * propose_rule path with issued_by caregiver, and the caregiver confirms on their phone.
 */
export function consoleRoutes(hp: HomePulse): Extension {
  return {
    routes(app, json, roleOf) {
      /** The snapshot for a door event (bundled file for injected events, Ring media API for real ones). */
      app.get("/api/snapshot/:event_id", async (req, res) => {
        const ev = hp.ring.find(String(req.params.event_id));
        if (!ev) return res.status(404).end();
        const img = await hp.ring.snapshot(ev);
        if ("unavailable" in img) return res.status(404).json({ error: img.unavailable });
        res.type(img.mime).set("Cache-Control", "no-store").send(img.bytes);
      });

      /** Console button: ring the simulated doorbell. Goes through the signed webhook like any Ring event. Local only. */
      app.post("/api/inject", json, async (req, res) => {
        if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "local only" });
        const type = req.body?.type === "motion_detected" ? "motion_detected" : "button_press";
        const snapshot = typeof req.body?.snapshot === "string" ? path.basename(req.body.snapshot) : null;
        const r = await inject({
          url: `http://127.0.0.1:${req.socket.localPort}/ring/webhook`,
          key: hp.config.ringHmacKey,
          type,
          sub_type: type === "motion_detected" ? "human" : null,
          snapshot,
          at: hp.clock.now(),
          device_id: "sim-doorbell-1",
        });
        res.json({ status: r.status, event_id: r.payload.data.id });
      });
      app.post("/api/caregiver/note", json, async (req, res) => {
        if (roleOf(req) !== "caregiver") return res.status(401).json({ error: "caregiver token required" });
        const text = String(req.body?.text ?? "").slice(0, 500);
        if (text.trim().length < 3) return res.status(400).json({ error: "Write a note first." });
        const writtenAt = typeof req.body?.written_at === "string" ? Date.parse(req.body.written_at) : NaN;
        const r = await hp.compiler.propose(text, "caregiver", { t_event: Number.isNaN(writtenAt) ? undefined : writtenAt });
        res.json(r);
        if (r.status === "draft") void confirmDraft(hp, r.draft_id, "from the caregiver's note (stands in for a Bee recording)", ["caregiver"]);
      });
    },
  };
}
