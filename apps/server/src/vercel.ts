import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { createHomePulse } from "./context.js";
import { createApp } from "./http.js";
import { extensions } from "./extensions.js";

// The Vercel function: the same app as index.ts, set up as the public "try to break in" page.
// Built into .vercel/output by scripts/vercel-build.mjs.

process.on("unhandledRejection", (reason) => console.error("[homepulse] unhandled rejection:", reason));

// The Dockerfile's public defaults, plus an in-memory house (the function's disk is read-only)
// and Vercel's host names. Project environment variables win.
const defaults: Record<string, string> = {
  HOST: "0.0.0.0",
  ALLOWED_HOSTS: ".vercel.app",
  DEMO_MODE: "false",
  HOME_PAGE: "/break-it",
  CONSOLE_EXPOSE_TOKENS: "false",
  TRUST_PROXY: "1",
  HOMEPULSE_TZ: "America/Los_Angeles",
  HOMEPULSE_DATA_DIR: "memory",
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;

const hp = createHomePulse(loadConfig());
const { app } = createApp(hp, extensions(hp));

// Vercel hands every request to the function over a local socket, so every visitor would pass the
// loopback checks meant for the machine itself (the console's open demo, /api/inject). Nobody is on
// this machine: give the socket a non-loopback address. Rate limits still see each visitor through
// X-Forwarded-For, which Vercel sets and TRUST_PROXY=1 reads.
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  Object.defineProperty(req.socket, "remoteAddress", { value: "0.0.0.0", configurable: true });
  app(req, res);
}
