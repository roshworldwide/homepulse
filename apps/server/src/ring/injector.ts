import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv, REPO_ROOT } from "../config.js";
import { buildRingPayload, ringSignature } from "./webhook.js";

/**
 * npm run ring:inject -- --type button_press --snapshot assets/sign-attack.jpg
 *
 * Builds a payload in Ring's v1.1 shape, signs it with the local HMAC key
 * exactly as Ring signs webhooks, and posts it to /ring/webhook. The server
 * stores it with simulated: true and the console shows a "Simulated event" badge.
 */
export async function inject(opts: { url: string; key: string; type: string; sub_type?: string | null; snapshot?: string | null; device_id?: string; at?: number; extra?: Record<string, unknown> }) {
  const payload = buildRingPayload({ type: opts.type, sub_type: opts.sub_type, device_id: opts.device_id ?? "sim-doorbell-1", at: opts.at ?? Date.now(), extra: opts.extra });
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Signature": ringSignature(body, opts.key),
    "X-HomePulse-Injector": "1",
  };
  if (opts.snapshot) headers["X-HomePulse-Snapshot"] = path.basename(opts.snapshot);
  const res = await fetch(opts.url, { method: "POST", headers, body });
  return { status: res.status, payload };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("ring", "injector.ts"));
if (isMain) {
  const { values } = parseArgs({
    options: {
      type: { type: "string", default: "button_press" },
      "sub-type": { type: "string" },
      snapshot: { type: "string" },
      url: { type: "string" },
      device: { type: "string" },
    },
  });
  loadDotEnv();
  const config = loadConfig();
  const url = values.url ?? `http://127.0.0.1:${config.port}/ring/webhook`;
  if (values.snapshot && !fs.existsSync(path.resolve(REPO_ROOT, values.snapshot)) && !fs.existsSync(values.snapshot)) {
    console.error(`Snapshot not found: ${values.snapshot}`);
    process.exit(2);
  }
  const r = await inject({ url, key: config.ringHmacKey, type: values.type!, sub_type: values["sub-type"] ?? (values.type === "motion_detected" ? "human" : null), snapshot: values.snapshot, device_id: values.device });
  console.log(`POST ${url} -> ${r.status}  (${r.payload.data.type}${r.payload.data.attributes.sub_type ? "/" + r.payload.data.attributes.sub_type : ""}, ${r.payload.data.id})`);
  process.exit(r.status === 200 ? 0 : 1);
}
