import { generateSigningKeys, hashCode, newPassId, signPass, type PassBody } from "mcp-streamable-guard";
import type { HomePulse } from "../../apps/server/src/context.js";
import type { Bucket, PhysicalExtra, PhysicalTool, UnlockArgs } from "../../apps/server/src/guard/home-guard.js";
import { isoInTz, zonedToUtcMs } from "../../apps/server/src/time.js";
import type { HoldoutCase } from "./cases.js";

export const CASE_DATE = { year: 2026, month: 10, day: 22 };
export const TZ = "America/Los_Angeles";

export function caseTime(c: HoldoutCase): number {
  const [h, m] = String(c.setup.time ?? "16:05").split(":").map(Number);
  return zonedToUtcMs(CASE_DATE.year, CASE_DATE.month, CASE_DATE.day, h, m, TZ);
}

export interface Prepared {
  codes: Record<string, string>;
  passIds: Record<string, string>;
  whos: Record<string, string>;
}

const otherKeys = generateSigningKeys();

/** Apply a case's setup to a fresh HomePulse: home mode, signed passes, a visitor at the door, prior requests. */
export function applySetup(hp: HomePulse, c: HoldoutCase, opts: { ringEvent?: boolean; agentLevel?: boolean } = {}): Prepared {
  const now = hp.clock.now();
  const s = c.setup;
  if (s.night_mode !== undefined) hp.home.setNight(s.night_mode);
  if (s.away_lockdown) hp.home.setLockdown(true);
  const prepared: Prepared = { codes: {}, passIds: {}, whos: {} };
  (s.passes ?? []).forEach((p, i) => {
    const code = `4829${String(10 + i)}`;
    const [nb, na] = p.window === "expired" ? [now - 3 * 3600e3, now - 2 * 3600e3] : p.window === "future" ? [now + 2 * 3600e3, now + 3 * 3600e3] : [now - 30 * 60e3, now + 30 * 60e3];
    const body: PassBody = {
      pass_id: newPassId(),
      door: p.door ?? "front",
      who: p.who ?? p.name,
      not_before: isoInTz(nb, hp.config.tz),
      not_after: isoInTz(na, hp.config.tz),
      max_uses: 1,
      code_hash: hashCode(code, hp.config.codeSecret),
      allow_at_night: p.allow_at_night === true,
      issued_by: "homeowner",
      confirmed_via: "app",
      issued_at: isoInTz(now - 3600e3, hp.config.tz),
    };
    const pass = signPass(body, p.forged ? otherKeys.privateKey : hp.keys.privateKey);
    hp.passes.insert(pass, now - 3600e3);
    if (p.used) hp.passes.consume(pass.pass_id);
    if (p.revoked) hp.passes.revoke(pass.pass_id, "revoked by the homeowner", now);
    prepared.codes[p.name] = code;
    prepared.passIds[p.name] = pass.pass_id;
    prepared.whos[p.name] = body.who;
  });
  if (s.visitor_at_door !== false && opts.ringEvent !== false) {
    hp.ring.ingest({ event_type: "button_press", event_id: `evt_${c.id}`, device_id: "sim-doorbell-1", occurred_at: new Date(now).toISOString() }, { simulated: true });
  }
  if (c.channel === "sign" || c.channel === "visitor_speech") {
    const text = Array.isArray(c.input) ? c.input.join(" ") : c.input;
    hp.engram.append({ kind: "input", source: c.channel === "sign" ? "ring" : "visitor", payload: { type: c.channel === "sign" ? "visitor_description" : "visitor_speech", outside_text: [text], harness: true } });
  }
  // At agent level every request (even a keypad case, relayed by voice) comes from the agent's bucket.
  const caller = opts.agentLevel && c.channel !== "app" ? ({ role: "agent", bucket: "agent" } as PhysicalExtra) : callerFor(c);
  for (let i = 0; i < (s.prior_requests ?? 0); i++) {
    hp.engram.append({ kind: "tool_call", source: caller.role === "device" ? "visitor" : caller.role, payload: { tool: "unlock_front_door", decision_id: `prior_${i}`, physical: true, bucket: caller.bucket, args: { channel: "voice" } } });
  }
  return prepared;
}

export function callerFor(c: HoldoutCase): PhysicalExtra {
  if (c.channel === "keypad") return { role: "device", bucket: "keypad" };
  if (c.channel === "app") return { role: "homeowner", bucket: "homeowner" as Bucket, session_id: "harness-app-session" };
  return { role: "agent", bucket: "agent" };
}

export function argsFor(c: HoldoutCase, prep: Prepared): { tool: PhysicalTool; args: UnlockArgs } {
  const a = c.args ?? {};
  const tool = a.tool ?? "unlock_front_door";
  const passId = a.pass ? prep.passIds[a.pass] ?? a.pass : a.pass_id;
  let code: string | undefined;
  if (a.code === "valid") code = a.pass ? prep.codes[a.pass] : undefined;
  else if (a.code === "off_by_one") {
    const v = Number(prep.codes[a.pass ?? ""] ?? "0");
    code = String((v + 1) % 1_000_000).padStart(6, "0");
  } else code = a.code;
  const channel = c.channel === "keypad" ? "keypad" : a.channel ?? "agent";
  // The keypad never sends a pass id: it looks the code up among this door's passes.
  const args: UnlockArgs = { channel, ...(c.channel !== "keypad" && passId ? { pass_id: passId } : {}), ...(code ? { presented_code: code } : {}), ...(a.reason ? { reason: a.reason } : {}) };
  return { tool, args };
}
