import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadDotEnv, REPO_ROOT } from "./config.js";
import { createHomePulse } from "./context.js";
import { createApp } from "./http.js";
import { extensions } from "./extensions.js";

// Last line of defence. Every known async path catches its own errors, so these should never fire.
// A stray rejection is logged; an uncaught exception means state may be inconsistent, so log and exit
// and let the supervisor restart (the lock is simulated and fails locked; Engram is append-only on disk).
process.on("unhandledRejection", (reason) => console.error("[homepulse] unhandled rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("[homepulse] uncaught exception, exiting:", err);
  process.exit(1);
});

loadDotEnv();
const config = loadConfig();
const hp = createHomePulse(config);
const { app, close } = createApp(hp, extensions(hp));

const server = app.listen(config.port, config.host, () => {
  const model = hp.provider.info();
  console.log(`HomePulse MCP server on http://${config.host}:${config.port}/mcp (protocol 2025-11-25, Streamable HTTP)`);
  const built = fs.existsSync(path.join(REPO_ROOT, "apps/console/dist/index.html"));
  const pages = built ? `http://localhost:${config.port}/console, /alexa, /break-it` : "http://localhost:5173/console (npm run dev), or npm run build to serve it here";
  console.log(`Pages: ${pages} · Model: ${model.label}${config.demoMode ? " · DEMO_MODE" : ""}`);
  console.log(`Role tokens are in .env or data/tokens.json. Engram: ${config.dataDir ?? "memory"}/homepulse.db`);
});

// Graceful shutdown: stop accepting, end MCP sessions, flush the WAL and close the log.
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[homepulse] ${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  server.close();
  await hp.agents?.close().catch(() => {});
  await close().catch(() => {});
  server.closeAllConnections();
  try {
    hp.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    hp.db.close();
  } catch {
    /* in-memory or already closed */
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
