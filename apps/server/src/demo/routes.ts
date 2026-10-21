import type { HomePulse } from "../context.js";
import type { Extension } from "../http.js";
import { resetHouse, runScenario, SCENARIOS, type ScenarioName } from "./scenarios.js";

/** Keys 1–4 in the console. Runs in the background; captions arrive over SSE. */
export function demoRoutes(hp: HomePulse): Extension {
  let running: string | null = null;
  return {
    routes(app, json) {
      app.post("/demo/run", json, (req, res) => {
        const name = String(req.body?.scenario ?? "") as ScenarioName;
        if (!hp.config.demoMode) return res.status(400).json({ error: "Set DEMO_MODE=true to run scenarios." });
        if (!SCENARIOS.includes(name)) return res.status(400).json({ error: `Unknown scenario. Use one of ${SCENARIOS.join(", ")}.` });
        if (running) return res.status(409).json({ error: `Scenario ${running} is still running.` });
        running = name;
        res.status(202).json({ started: name });
        runScenario(hp, name, { base: `http://127.0.0.1:${req.socket.localPort}`, pace: Math.min(5000, Math.max(0, Number(req.body?.pace ?? 1200) || 0)) })
          .catch((err) => hp.bus.publish({ type: "demo", demo: { event: "caption", scenario: name, text: `Scenario failed: ${String(err?.message ?? err)}` } }))
          .finally(() => (running = null));
      });
      app.post("/demo/reset", (_req, res) => {
        // A reset lifts lockdown and clears passes, so it exists only in DEMO_MODE.
        if (!hp.config.demoMode) return res.status(400).json({ error: "Set DEMO_MODE=true to reset the house." });
        if (running) return res.status(409).json({ error: `Scenario ${running} is still running.` });
        resetHouse(hp, null);
        res.json({ ok: true });
      });
    },
  };
}
