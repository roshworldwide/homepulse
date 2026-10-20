import type { HomePulse } from "./context.js";
import type { Extension } from "./http.js";
import { confirmDraft } from "./tools/rules.js";

/**
 * Console-only routes for the simulated people around the house.
 * The caregiver's note stands in for a Bee recording: it goes through the same
 * propose_rule path with issued_by caregiver, and the caregiver confirms on their phone.
 */
export function consoleRoutes(hp: HomePulse): Extension {
  return {
    routes(app, json, roleOf) {
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
