import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ATTACKS_DIR = path.join(HARNESS_DIR, "attacks");

export type Channel = "voice" | "visitor_speech" | "sign" | "tool_args" | "app" | "keypad" | "rule";

export interface PassSetup {
  /** Referenced from args.pass. */
  name: string;
  who?: string;
  door?: "front" | "parcel_box";
  window?: "now" | "expired" | "future";
  allow_at_night?: boolean;
  /** Signed with a key that is not the server's. */
  forged?: boolean;
  used?: boolean;
  revoked?: boolean;
}

export interface CaseSetup {
  /** Local time on 22 Oct 2026, "HH:MM", in the scenario time zone. */
  time?: string;
  /** Force night mode on/off by hand; omitted = follow the clock. */
  night_mode?: boolean;
  away_lockdown?: boolean;
  /** Default true: a Ring button press just happened. */
  visitor_at_door?: boolean;
  /** Physical requests already made by the same caller in the last 10 minutes. */
  prior_requests?: number;
  passes?: PassSetup[];
  /** A pre-recorded approval bound to this request: stale (61 s old), from an agent-role session, or a denial. */
  approval?: "stale" | "agent_role" | "deny";
}

export interface CaseArgs {
  tool?: "unlock_front_door" | "open_parcel_box";
  /** Name of a pass in setup.passes, or a literal pass id. */
  pass?: string;
  pass_id?: string;
  /** "valid" = the right code for the named pass; anything else is used as typed. */
  code?: string;
  channel?: "voice" | "app" | "agent";
  reason?: string;
}

export interface HoldoutCase {
  id: string;
  category: string;
  channel: Channel;
  setup: CaseSetup;
  /** What is said, shown on the sign, or (for multi-turn) a list of turns. */
  input: string | string[];
  args?: CaseArgs;
  expect: "block" | "allow" | "refuse";
  note?: string;
}

export const ATTACK_CATEGORIES = [
  "direct_instruction",
  "authority_impersonation",
  "urgency_emotion",
  "fake_system_message",
  "obfuscated_text",
  "multi_turn",
  "forged_credentials",
  "mode_bypass",
  "tool_argument_injection",
] as const;

export function loadCases(dir = ATTACKS_DIR): HoldoutCase[] {
  const out: HoldoutCase[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".yaml")).sort()) {
    const docs = YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")) as HoldoutCase[];
    out.push(...docs);
  }
  const ids = new Set<string>();
  for (const c of out) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return out;
}

export const isAttack = (c: HoldoutCase) => c.expect === "block";
export const isLegit = (c: HoldoutCase) => c.expect === "allow";
export const isUnsafeRule = (c: HoldoutCase) => c.expect === "refuse";
