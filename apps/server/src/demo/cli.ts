/**
 * npm run demo -- --scenario nurse|paramedic|sign|night     (or --all)
 * npm run demo:record                                        (live Bedrock, writes fixtures)
 *
 * Starts a fresh in-memory HomePulse in DEMO_MODE on a spare port, connects a
 * scripted caregiver phone over MCP (it confirms the nurse rule and denies the
 * paramedic), runs the scenario end to end, and prints what happened.
 */
import type { AddressInfo } from "node:net";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, loadDotEnv } from "../config.js";
import { createHomePulse } from "../context.js";
import { extensions } from "../extensions.js";
import { createApp } from "../http.js";
import { FixtureStore } from "../models/fixtures.js";
import { runScenario, SCENARIOS, type ScenarioName } from "./scenarios.js";

const { values } = parseArgs({ options: { scenario: { type: "string" }, all: { type: "boolean", default: false }, record: { type: "boolean", default: false } } });
loadDotEnv();
if (values.record) {
  process.env.RECORD_FIXTURES = "1";
  if (process.env.MODEL_PROVIDER !== "bedrock" || !process.env.BEDROCK_MODEL_ID) {
    console.error("demo:record needs MODEL_PROVIDER=bedrock and BEDROCK_MODEL_ID (and AWS credentials): fixtures come only from real model runs.");
    process.exit(2);
  }
}
const names: ScenarioName[] = values.all || values.record ? [...SCENARIOS] : values.scenario ? [values.scenario as ScenarioName] : [];
if (!names.length || names.some((n) => !SCENARIOS.includes(n))) {
  console.error(`Usage: npm run demo -- --scenario ${SCENARIOS.join("|")}   (or --all)`);
  process.exit(2);
}

const config = loadConfig({ ...process.env, DEMO_MODE: "true", PORT: "0", HOST: "127.0.0.1", APPROVAL_TIMEOUT_MS: "20000", UNLOCK_MS: "30000" }, { dataDir: null });
const hp = createHomePulse(config, { dbFile: ":memory:" });
let base = "";
const { app, close } = createApp(hp, extensions(hp, () => `${base}/mcp`));
const server = await new Promise<import("node:http").Server>((r) => {
  const s = app.listen(0, "127.0.0.1", () => r(s));
});
base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// The scripted caregiver phone: a real MCP session with the caregiver token.
let current: ScenarioName = names[0];
const phone = new Client({ name: "scripted-caregiver-phone", version: "1.0.0" }, { capabilities: { elicitation: {} } });
phone.setRequestHandler(ElicitRequestSchema, async (req) => {
  const p = req.params as { message: string; requestedSchema: { properties: Record<string, unknown> } };
  const field = Object.keys(p.requestedSchema.properties)[0];
  const yes = current === "nurse";
  await new Promise((r) => setTimeout(r, 800));
  console.log(`  [caregiver phone] "${p.message.replace(/\b\d{6}\b/, "••••••")}" -> ${yes ? (field === "send" ? "Send to visitor" : field === "confirm" ? "Confirm" : "Approve") : "Deny"}`);
  return { action: "accept", content: { [field]: yes } };
});
await phone.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${config.tokens.caregiver}` } } }));
await new Promise((r) => setTimeout(r, 200));

const info = hp.agents!.info();
console.log(`HomePulse demo · DEMO_MODE · model: ${hp.provider.info().label} · agent: ${info.homepulse.label} · fixtures on disk: ${new FixtureStore().count()}`);
let failed = false;
for (const name of names) {
  current = name;
  console.log(`\n=== ${name} ===`);
  const unsub = hp.bus.subscribe((e) => {
    if (e.type === "demo" && (e.demo as { event: string }).event === "caption") console.log(`  · ${(e.demo as { text: string }).text}`);
  });
  try {
    const o = await runScenario(hp, name, { base });
    for (const r of o.replies) if (r.text) console.log(`  ${r.agent === "homepulse" ? "Alexa (HomePulse)" : "Baseline        "}: ${r.text}`);
    for (const d of o.decisions) console.log(`  guard ${d.decision_id}: ${d.verdict}${d.reasons.length ? " (" + d.reasons.join("; ") + ")" : ""}`);
    console.log(`  HomePulse door opened: ${o.homepulse_door_opened ? "yes" : "no"} · baseline door opened: ${o.baseline_door_opened ? "yes" : "no"}`);
  } catch (err) {
    failed = true;
    console.error(`  failed: ${String(err instanceof Error ? err.message : err)}`);
  } finally {
    unsub();
  }
}
console.log(`\nEngram: ${JSON.stringify(hp.engram.verify())}`);
await phone.close();
await hp.agents?.close();
await close();
server.closeAllConnections();
server.close();
process.exit(failed ? 1 : 0);
