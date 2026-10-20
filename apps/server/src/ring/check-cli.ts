import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadDotEnv, REPO_ROOT } from "../config.js";
import { RingClient } from "./client.js";

/**
 * npm run ring:check — the Day-one check against the Ring Developer Playground.
 * Lists devices, reads history, and tries the snapshot call. Saves the snapshot
 * to data/ring-snapshot.* when one comes back.
 */
loadDotEnv();
const config = loadConfig();
if (!config.ringAccessToken) {
  console.error("Set RING_ACCESS_TOKEN (a 30-minute token from the Ring Developer Playground) in .env first.");
  process.exit(2);
}
const client = new RingClient(config.ringApiBase, () => config.ringAccessToken);
const started = Date.now();
try {
  const devices = (await client.devices()) as { data?: Array<{ id: string; attributes?: Record<string, unknown> }> };
  const list = devices.data ?? [];
  console.log(`devices: ${list.length}`);
  for (const d of list) console.log(`  ${d.id}  ${JSON.stringify(d.attributes ?? {}).slice(0, 160)}`);
  const id = config.ringDeviceId || list[0]?.id;
  if (!id) process.exit(0);
  const hist = (await client.history(id)) as { data?: unknown[] };
  console.log(`history events for ${id}: ${Array.isArray(hist.data) ? hist.data.length : "?"}`);
  console.log(`video unavailable (e2e): ${await client.videoUnavailable(id)}`);
  const snap = await client.snapshot(id);
  if ("unavailable" in snap) console.log(`snapshot: ${snap.unavailable}`);
  else {
    const out = path.join(REPO_ROOT, "data", `ring-snapshot.${snap.mime === "image/png" ? "png" : "jpg"}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, snap.bytes);
    console.log(`snapshot: ${snap.bytes.length} bytes -> ${path.relative(REPO_ROOT, out)}`);
  }
  console.log(`done in ${Date.now() - started} ms`);
} catch (err) {
  console.error(String(err));
  process.exit(1);
}
