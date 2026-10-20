import { z } from "zod";
import type { HomePulse } from "../context.js";
import type { Role } from "../config.js";
import { ok, type Register } from "./common.js";

/**
 * Safer takes a sentence, riskier takes a tap. Turning lockdown on needs no
 * approval because it only makes the home safer. It suspends every pass (the
 * guard blocks all unlocks during lockdown) without revoking them, so a
 * visitor shouting "lock everything down" cannot cancel the nurse's visit;
 * turning it off needs the same app approval as an unlock.
 */
export async function setLockdown(hp: HomePulse, on: boolean, role: Role, sessionId?: string) {
  if (on) {
    hp.home.setLockdown(true);
    hp.engram.append({ kind: "input", source: role === "agent" ? "agent" : role, payload: { type: "lockdown", on: true } });
    hp.devices.tv("alert", "LOCKDOWN ON", "Every door stays locked. Turning it off needs a tap in the app.");
    hp.devices.alert("caregiver", "Lockdown turned on", "Every door stays locked until someone taps to lift it.");
    return { lockdown: true, message: "Lockdown is on. Every door stays locked. Turning it off needs a tap in the app." };
  }
  if (!hp.home.awayLockdown) return { lockdown: false, message: "Lockdown is already off." };
  let approvedBy: string | null = null;
  if ((role === "homeowner" || role === "caregiver") && sessionId) approvedBy = role;
  else {
    const ask = await hp.broker.ask({
      ref: `lockdown_off_${hp.clock.now()}`,
      kind: "lockdown_off",
      message: "Lift the lockdown? Doors will follow passes and approvals again.",
      field: "approve",
      title: "Lift lockdown",
      description: "Approve to turn lockdown off.",
      timeoutMs: hp.config.approvalTimeoutMs,
    });
    if (ask.answer) approvedBy = ask.role!;
  }
  if (!approvedBy) return { lockdown: true, message: "Lockdown stays on: turning it off needs a tap in the app." };
  hp.home.setLockdown(false);
  hp.engram.append({ kind: "input", source: approvedBy as "homeowner" | "caregiver", payload: { type: "lockdown", on: false } });
  hp.devices.tv("neutral", "Lockdown lifted", `Approved by the ${approvedBy}.`);
  return { lockdown: false, message: `Lockdown is off, approved by the ${approvedBy}.` };
}

export const registerSetLockdown: Register = (server, hp, session) => {
  server.registerTool(
    "set_lockdown",
    {
      title: "Lockdown",
      description: "Turn lockdown on (works at once: every door stays locked) or off (needs a tap in the homeowner's or caregiver's app).",
      inputSchema: { on: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ on }) => {
      const r = await setLockdown(hp, on, session.role, session.sessionId());
      return ok(r, r.message);
    },
  );
};
