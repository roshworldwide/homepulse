/**
 * npm run bench:guard — time decide() alone and the full guard check
 * (signature verify, code HMAC, SQLite reads, Engram write) separately,
 * 10,000 runs each, with performance.now(). Writes docs/latency.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, hashCode, inputsFromMask, newPassId, signPass } from "mcp-streamable-guard";
import { ControlledClock } from "../clock.js";
import { loadConfig, REPO_ROOT } from "../config.js";
import { createHomePulse } from "../context.js";
import { OfflineProvider } from "../models/offline.js";
import { isoInTz, zonedToUtcMs } from "../time.js";

const RUNS = Number(process.env.RUNS ?? 10_000);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (x: number) => Math.round(x * 1000) / 1000;

// 1. decide() alone, cycling through all 16,384 input combinations.
const inputs = Array.from({ length: 1 << 14 }, (_, m) => inputsFromMask(m));
for (let i = 0; i < 2000; i++) decide(inputs[i]); // warm up
const pure: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const x = inputs[i % inputs.length];
  const t0 = performance.now();
  decide(x);
  pure.push(performance.now() - t0);
}

// 2. Full check on a real pass: signature, HMAC, passes table, approvals, Engram reads and the decision record.
const config = loadConfig({ TZ: "America/Los_Angeles", DEMO_MODE: "false" }, { dataDir: null });
const clock = new ControlledClock(zonedToUtcMs(2026, 10, 22, 14, 14, config.tz), false);
const hp = createHomePulse(config, { clock, dbFile: ":memory:", provider: new OfflineProvider() });
const now = clock.now();
const code = "482913";
// A parcel-box pass presented at the front door: every check runs, nothing is consumed, so it can repeat.
const pass = signPass(
  {
    pass_id: newPassId(), door: "parcel_box", who: "bench", not_before: isoInTz(now - 3600e3, config.tz), not_after: isoInTz(now + 3600e3, config.tz),
    max_uses: 1, code_hash: hashCode(code, config.codeSecret), allow_at_night: false, issued_by: "homeowner", confirmed_via: "app", issued_at: isoInTz(now - 7200e3, config.tz),
  },
  hp.keys.privateKey,
);
hp.passes.insert(pass, now);
hp.ring.ingest({ event_type: "button_press", event_id: "evt_bench", occurred_at: new Date(now).toISOString() }, { simulated: true });
const full: number[] = [];
for (let i = 0; i < RUNS + 200; i++) {
  const d = await hp.homeGuard.guard.check("unlock_front_door", { pass_id: pass.pass_id, presented_code: code, channel: "app" }, { role: "device", bucket: `bench${i}` as never }, `dec_bench_${i}`);
  if (i >= 200) full.push(d.latency_ms);
}

const result = {
  measured_at: new Date().toISOString(),
  machine: `${os.cpus()[0]?.model ?? "unknown CPU"} · ${os.cpus().length} cores · Node ${process.version} · ${os.platform()}`,
  runs: RUNS,
  decide_ms: { median: round(pct(pure, 50)), p95: round(pct(pure, 95)), p99: round(pct(pure, 99)) },
  full_check_ms: { median: round(pct(full, 50)), p95: round(pct(full, 95)), p99: round(pct(full, 99)), includes: "Ed25519 verify, HMAC compare, SQLite reads (passes table, Engram window queries for visitor, rate and echo), decide(); excludes the decision record write" },
};
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(REPO_ROOT, "docs", "latency.json"), JSON.stringify(result, null, 2) + "\n");
