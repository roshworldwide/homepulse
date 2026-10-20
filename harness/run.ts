/**
 * npm run holdout -- --level guard
 * npm run holdout -- --level agent            (needs MODEL_PROVIDER=bedrock and BEDROCK_MODEL_ID)
 * npm run holdout -- --level agent --only sign-001,cred-002
 * npm run holdout -- --level agent --allow-offline   (smoke test only; never a reportable result)
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "../apps/server/src/config.js";
import { HARNESS_DIR, loadCases } from "./src/cases.js";
import { runGuardLevel, summarize } from "./src/guard-level.js";
import { agentReport, runAgentCase, type AgentCaseResult } from "./src/agent-level.js";

const { values } = parseArgs({ options: { level: { type: "string", default: "guard" }, only: { type: "string" }, "allow-offline": { type: "boolean", default: false } } });
loadDotEnv();
let cases = loadCases();
if (values.only) {
  const ids = new Set(values.only.split(","));
  cases = cases.filter((c) => ids.has(c.id));
}

if (values.level === "guard") {
  const s = summarize(await runGuardLevel(cases));
  console.log("| Metric | HomePulse guard |\n| --- | --- |");
  console.log(`| Attacks allowed (of ${s.attacks}) | ${s.attacks_allowed} |`);
  console.log(`| Legitimate visits refused (of ${s.legit}) | ${s.legit_refused} |`);
  console.log(`| Unsafe rules accepted (of ${s.unsafe_rules}) | ${s.unsafe_rules_accepted} |`);
  for (const [cat, v] of Object.entries(s.by_category)) console.log(`  ${cat.padEnd(26)} ${v.n - v.failed}/${v.n} as expected`);
  for (const f of s.failures) console.log(`FAIL ${f.id}: expected ${f.expect}; ${f.reasons.join("; ")}`);
  process.exit(s.failures.length ? 1 : 0);
}

const provider = process.env.MODEL_PROVIDER === "bedrock" && process.env.BEDROCK_MODEL_ID ? "bedrock" : "offline";
if (provider === "offline" && !values["allow-offline"]) {
  console.error("Agent level needs a real model: set MODEL_PROVIDER=bedrock and BEDROCK_MODEL_ID (and AWS credentials). Use --allow-offline only for a smoke test.");
  process.exit(2);
}
const doorCases = cases.filter((c) => c.expect !== "refuse");
const results: AgentCaseResult[] = [];
for (const c of doorCases) {
  const r = await runAgentCase(c, { ...process.env, MODEL_PROVIDER: provider });
  results.push(r);
  console.log(`${r.id.padEnd(14)} naive ${r.naive_opened ? "OPENED" : "closed"}  homepulse ${r.homepulse_opened ? "OPENED" : "closed"}${r.homepulse_attempted_unlock ? " (agent tried)" : ""}${r.error ? "  ERROR " + r.error : ""}`);
}
const model = provider === "bedrock" ? process.env.BEDROCK_MODEL_ID! : "offline-agent-standin (scripted, NOT A RESULT)";
const report = agentReport(results, model, provider);
const out = provider === "bedrock" && !values.only ? path.join(HARNESS_DIR, "report.md") : path.join(HARNESS_DIR, "out", "report-smoke.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, report);
fs.writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
console.log(`\n${report}\nWrote ${path.relative(process.cwd(), out)}`);
