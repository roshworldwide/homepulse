import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadCases } from "../src/cases.js";
import { modelChartSvg, type ModelRow } from "../src/chart.js";
import { modelsReport, runModel, summarizeModel } from "../models.js";
import type { AgentCaseResult } from "../src/agent-level.js";

const row = (model: string, naive: number, homepulse: number, over: Partial<ModelRow> = {}): ModelRow => ({
  model,
  attacks: 100,
  naive_unlocked: naive,
  homepulse_unlocked: homepulse,
  legit: 20,
  naive_refused: 1,
  homepulse_refused: 0,
  errors: 0,
  ...over,
});

describe("model-agnostic proof (wow 5)", () => {
  test("summaries count attacks that opened, visitors refused and case errors", () => {
    const r = (id: string, expect: "block" | "allow", naive: boolean, home: boolean, error?: string): AgentCaseResult => ({
      id,
      category: "x",
      expect,
      naive_opened: naive,
      homepulse_opened: home,
      homepulse_attempted_unlock: false,
      homepulse_reply: "",
      naive_reply: "",
      ...(error ? { error } : {}),
    });
    expect(summarizeModel("m", [r("a", "block", true, false), r("b", "block", false, false, "boom"), r("c", "allow", false, true)])).toEqual({
      model: "m",
      attacks: 2,
      naive_unlocked: 1,
      homepulse_unlocked: 0,
      legit: 1,
      naive_refused: 1,
      homepulse_refused: 0,
      errors: 1,
    });
  });

  test("the chart: two thin columns per model in each panel, values on the caps, an honest headline", () => {
    const svg = modelChartSvg([row("a.model-1", 31, 0), row("b.model<2>", 58, 0), row("c.model-3", 100, 0)], { date: "2026-10-22" });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("Better models help. The guard makes it not matter.");
    expect(svg).toContain("b.model&lt;2&gt;"); // model names are escaped
    expect(svg).not.toContain("b.model<2>");
    expect((svg.match(/<title>[^<]*: (Naive baseline|HomePulse)/g) ?? []).length).toBe(12); // 3 models x 2 series x 2 panels
    const widths = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="2"/g)].map((m) => Number(m[1]));
    for (const w of widths) expect(w).toBeLessThanOrEqual(24);
    expect(svg).not.toMatch(/NaN|undefined/);
    // When HomePulse lets any attack through, the chart does not claim otherwise.
    expect(modelChartSvg([row("a", 30, 1)], { date: "d" })).not.toContain("makes it not matter");
    // A smoke run says so in its subtitle and never carries the video line.
    const smoke = modelChartSvg([row("offline", 2, 0)], { date: "d", smoke: true });
    expect(smoke).toContain("SMOKE TEST");
    expect(smoke).not.toContain("makes it not matter");
  });

  test("the report table lists every model and flags partial or offline runs", () => {
    const md = modelsReport([row("a", 31, 0), row("b", 58, 0, { errors: 2 })], { date: "2026-10-22", smoke: false, partial: false });
    expect(md).toContain("| `a` | 31 of 100 | 0 of 100 | 1 of 20 | 0 of 20 | 0 |");
    expect(md).toContain("| `b` | 58 of 100 | 0 of 100 | 1 of 20 | 0 of 20 | 2 |");
    expect(modelsReport([row("x", 1, 0)], { date: "d", smoke: true, partial: true })).toMatch(/Not a result[\s\S]*not a reportable result/);
  });

  test("a run saves each case as it finishes and resumes where it stopped", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "models-"));
    const file = path.join(dir, "m.json");
    const all = loadCases().filter((c) => ["direct-001", "legit-001", "cred-001"].includes(c.id));
    const env = { ...process.env, MODEL_PROVIDER: "offline", BEDROCK_MODEL_ID: "" };
    const first = await runModel("offline", all.slice(0, 2), { file, fresh: false, concurrency: 2, env });
    expect(first.map((r) => r.id)).toEqual(all.slice(0, 2).map((c) => c.id));
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as AgentCaseResult[];
    const marker = { ...saved[0], homepulse_reply: "kept from the first run" };
    fs.writeFileSync(file, JSON.stringify([marker, saved[1]]));
    const second = await runModel("offline", all, { file, fresh: false, concurrency: 2, env });
    expect(second).toHaveLength(3);
    expect(second[0].homepulse_reply).toBe("kept from the first run"); // not re-run
    expect(second.every((r) => !r.homepulse_opened || r.expect === "allow")).toBe(true);
    const fresh = await runModel("offline", all.slice(0, 1), { file, fresh: true, concurrency: 1, env });
    expect(fresh[0].homepulse_reply).not.toBe("kept from the first run");
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
