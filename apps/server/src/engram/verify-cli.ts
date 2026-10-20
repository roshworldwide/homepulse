import path from "node:path";
import fs from "node:fs";
import { REPO_ROOT } from "../config.js";
import { SystemClock } from "../clock.js";
import { Engram, openDatabase } from "./store.js";

/** npm run engram:verify — walk the hash chain and report the first broken link. */
const file = process.argv[2] ?? path.join(REPO_ROOT, "data", "homepulse.db");
if (!fs.existsSync(file)) {
  console.error(`No Engram database at ${file}. Start the server once first.`);
  process.exit(2);
}
const engram = new Engram(openDatabase(file), new SystemClock());
const r = engram.verify();
if (r.ok) {
  console.log(`Engram OK: ${r.count} records, chain intact. Head ${r.head.slice(0, 16)}…`);
} else {
  console.error(`Engram BROKEN at record ${r.brokenAt} (position ${r.index + 1} of ${r.count}): ${r.why}`);
  process.exit(1);
}
