import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Role = "homeowner" | "caregiver" | "agent";
export const ROLES: readonly Role[] = ["homeowner", "caregiver", "agent"];

export interface Config {
  port: number;
  host: string;
  allowedOrigins: string[];
  tokens: Record<Role, string>;
  exposeTokens: boolean;
  codeSecret: string;
  ringHmacKey: string;
  modelProvider: "bedrock" | "offline";
  awsRegion: string;
  bedrockModelId: string;
  ringApiBase: string;
  ringAccessToken: string;
  ringDeviceId: string;
  demoMode: boolean;
  tz: string;
  /** Repo-level data directory (git-ignored). null = in-memory only (tests). */
  dataDir: string | null;
  /** How long a physical request waits for a phone tap before giving up. */
  approvalTimeoutMs: number;
  /** How long a door stays unlocked before relocking. */
  unlockMs: number;
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Load the repo's .env if there is one. Values already in the environment win. */
export function loadDotEnv(file = path.join(REPO_ROOT, ".env")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, k, raw] = m;
    const v = raw.replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const hex64 = () => randomBytes(32).toString("hex");

function persisted(dataDir: string | null, file: string, keys: string[], given: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  let stored: Record<string, string> = {};
  const p = dataDir ? path.join(dataDir, file) : null;
  if (p && fs.existsSync(p)) stored = JSON.parse(fs.readFileSync(p, "utf8"));
  let changed = false;
  for (const k of keys) {
    const v = given[k] || stored[k];
    if (v) out[k] = v;
    else {
      out[k] = hex64();
      changed = true;
    }
  }
  if (p && changed) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ...stored, ...out }, null, 2), { mode: 0o600 });
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { dataDir?: string | null } = {}): Config {
  const dataDir = opts.dataDir === undefined ? path.join(REPO_ROOT, "data") : opts.dataDir;
  const tokens = persisted(dataDir, "tokens.json", ["homeowner", "caregiver", "agent"], {
    homeowner: env.HOMEOWNER_TOKEN,
    caregiver: env.CAREGIVER_TOKEN,
    agent: env.AGENT_TOKEN,
  });
  const secrets = persisted(dataDir, "secrets.json", ["code", "ring"], {
    code: env.CODE_HMAC_SECRET,
    ring: env.RING_HMAC_KEY,
  });
  const port = Number(env.PORT ?? 8787);
  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS ?? `http://localhost:5173,http://127.0.0.1:5173,http://localhost:${port},http://127.0.0.1:${port}`)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    tokens: tokens as Record<Role, string>,
    exposeTokens: (env.CONSOLE_EXPOSE_TOKENS ?? "true") === "true",
    codeSecret: secrets.code,
    ringHmacKey: secrets.ring,
    modelProvider: env.MODEL_PROVIDER === "bedrock" ? "bedrock" : "offline",
    awsRegion: env.AWS_REGION ?? "us-east-1",
    bedrockModelId: env.BEDROCK_MODEL_ID ?? "",
    ringApiBase: env.RING_API_BASE ?? "https://api.amazonvision.com",
    ringAccessToken: env.RING_ACCESS_TOKEN ?? "",
    ringDeviceId: env.RING_DEVICE_ID ?? "",
    demoMode: (env.DEMO_MODE ?? "false") === "true",
    tz: env.TZ || "America/Los_Angeles",
    dataDir,
    approvalTimeoutMs: Number(env.APPROVAL_TIMEOUT_MS ?? 45_000),
    unlockMs: Number(env.UNLOCK_MS ?? 30_000),
  };
}
