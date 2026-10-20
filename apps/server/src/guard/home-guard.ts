import {
  codeMatches,
  createGuard,
  detectEcho,
  emptyInputs,
  passInWindow,
  verifyPass,
  type Door,
  type Guard,
  type GuardDecision,
  type ReasonMessages,
  type SigningKeys,
  type Source,
} from "mcp-streamable-guard";
import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";
import type { Config, Role } from "../config.js";
import type { Devices } from "../devices/simulated.js";
import type { Engram, EngramRecord } from "../engram/store.js";
import type { ApprovalBroker } from "../mcp/approvals.js";
import { APPROVAL_FRESH_MS, type Approvals } from "../state/approvals.js";
import type { HomeState } from "../state/home.js";
import type { PassStore } from "../state/passes.js";
import { formatClock } from "../time.js";

export const PHYSICAL_TOOLS = ["unlock_front_door", "open_parcel_box"] as const;
export type PhysicalTool = (typeof PHYSICAL_TOOLS)[number];

export const VISITOR_WINDOW_MS = 120_000;
export const RATE_WINDOW_MS = 10 * 60_000;
export const RATE_LIMIT = 5;
export const ECHO_WINDOW_MS = 10 * 60_000;

/** Rate-limit buckets come from who is calling (session role or device), never from the channel an agent claims. */
export type Bucket = "agent" | "homeowner" | "caregiver" | "keypad";

export interface UnlockArgs {
  pass_id?: string;
  presented_code?: string;
  channel: "voice" | "app" | "agent" | "keypad";
  /** Logged and shown, never used to decide. */
  reason?: string;
}

export interface PhysicalExtra {
  role: Role | "device";
  bucket: Bucket;
  session_id?: string;
  /** The agent's latest message, for the echo explanation only. */
  agent_last_message?: string;
}

export interface Deps {
  config: Config;
  clock: Clock;
  bus: Bus;
  engram: Engram;
  passes: PassStore;
  approvals: Approvals;
  home: HomeState;
  devices: Devices;
  keys: SigningKeys;
  broker: ApprovalBroker;
  newId: (prefix: string) => string;
}

export const doorOf = (tool: string): Door => (tool === "open_parcel_box" ? "parcel_box" : "front");
const doorName = (d: Door) => (d === "front" ? "front door" : "parcel box");

export function redactArgs(args: UnlockArgs): Record<string, unknown> {
  return { ...args, presented_code: args.presented_code ? "••••••" : undefined };
}

/** Untrusted text recorded in the last `windowMs` (visitor descriptions, visitor speech, Ring attributes). */
export function recentOutsideText(engram: Engram, nowMs: number, windowMs = ECHO_WINDOW_MS): string[] {
  const out: string[] = [];
  for (const r of engram.eventsBetween(nowMs - windowMs, nowMs, "input")) {
    if (r.trust !== "untrusted") continue;
    const t = (r.payload as { outside_text?: unknown }).outside_text;
    if (Array.isArray(t)) for (const s of t) if (typeof s === "string" && s.trim()) out.push(s);
  }
  return out;
}

export function latestDoorEvent(engram: Engram, nowMs: number, windowMs = VISITOR_WINDOW_MS): EngramRecord | undefined {
  return engram
    .eventsBetween(nowMs - windowMs, nowMs, "input", "ring")
    .filter((r) => isPersonEvent(r.payload))
    .at(-1);
}

export function isPersonEvent(payload: Record<string, unknown>): boolean {
  const e = payload.event as { type?: string; sub_type?: string } | undefined;
  if (!e) return false;
  return e.type === "button_press" || (e.type === "motion_detected" && e.sub_type === "human");
}

export interface HomeGuard {
  guard: Guard<UnlockArgs>;
  /** Run a physical request end to end: log it, decide, and drive the simulated lock on allow. */
  physical(tool: PhysicalTool, args: UnlockArgs, extra: PhysicalExtra): Promise<{ decision: GuardDecision<UnlockArgs>; effect: Record<string, unknown> }>;
}

export function createHomeGuard(h: Deps): HomeGuard {
  const passFor = new Map<string, string | undefined>();

  const guard = createGuard<UnlockArgs>({
    resolve(ctx) {
      const now = h.clock.now();
      const extra = ctx.extra as PhysicalExtra;
      const door = doorOf(ctx.tool);
      const x = emptyInputs();
      const messages: ReasonMessages = {};
      const notes: string[] = [];

      // Pass path: by id if given, otherwise by code (keypad, or an agent relaying a code).
      let row = ctx.args.pass_id ? h.passes.get(ctx.args.pass_id) : undefined;
      if (!row && !ctx.args.pass_id && ctx.args.presented_code) {
        row = h.passes.findByCode(door, ctx.args.presented_code, h.config.codeSecret, now);
      }
      passFor.set(ctx.decision_id, row?.pass.pass_id);
      if (row) {
        const p = row.pass;
        x.pass_present = true;
        x.pass_signature_valid = verifyPass(p, h.keys.publicKey);
        x.pass_in_window = passInWindow(p, now);
        x.pass_unused = row.uses < p.max_uses && !row.revoked_at;
        x.pass_for_this_door = p.door === door;
        x.code_matches = codeMatches(ctx.args.presented_code, p.code_hash, h.config.codeSecret);
        x.pass_allows_night = p.allow_at_night === true;
        if (row.revoked_at) messages.pass_unused = `the pass was ${row.revoked_reason ?? "revoked"}`;
        if (!x.pass_in_window) messages.pass_in_window = Date.parse(p.not_before) > now ? "the pass is not valid yet" : "the pass has expired";
      }

      // Owner path: an approval bound to this request id, from an owner-role session.
      const a = h.approvals.get(ctx.decision_id);
      x.owner_approved = a?.approved === true;
      x.approval_fresh = !!a && now - a.at <= APPROVAL_FRESH_MS;
      x.approver_is_owner_role = !!a && (a.role === "homeowner" || a.role === "caregiver");
      if (a && !a.approved) messages.owner_approved = `the ${a.role} denied the request`;

      // Home state.
      x.night_mode = h.home.nightMode(now);
      x.away_lockdown = h.home.awayLockdown;
      x.visitor_at_door = latestDoorEvent(h.engram, now) !== undefined;

      // Rate: physical requests from the same caller bucket in the last 10 minutes, not counting this one.
      const prior = h.engram
        .eventsBetween(now - RATE_WINDOW_MS, now, "tool_call")
        .filter((r) => r.payload.physical === true && r.payload.bucket === extra.bucket && r.payload.decision_id !== ctx.decision_id).length;
      x.rate_ok = prior < RATE_LIMIT;

      if (ctx.args.channel === "voice") notes.push("voice-only request: speaking starts a request but never opens the door by itself");
      if (x.night_mode) notes.push("night mode is on");
      if (ctx.args.reason) notes.push(`stated reason (not used to decide): "${ctx.args.reason.slice(0, 120)}"`);
      return { inputs: x, messages, notes };
    },

    async requestApproval(ctx) {
      const extra = ctx.extra as PhysicalExtra;
      // Keypad mistakes alert the caregiver instead of asking them; owner sessions already approved by asking.
      if (extra.bucket === "keypad" || extra.role === "homeowner" || extra.role === "caregiver") return;
      const now = h.clock.now();
      const door = doorOf(ctx.tool);
      const ev = latestDoorEvent(h.engram, now);
      const evText = ev ? describeEvent(ev, h.config.tz) : "someone is at the door";
      const claim = ctx.args.reason ? ` Unverified claim, not checked by HomePulse: "${ctx.args.reason.slice(0, 120)}".` : "";
      const message = `Someone is at the ${doorName(door)} (${evText}). A request to open it came through the home assistant${ctx.args.channel === "voice" ? " by voice" : ""}.${claim} Open the ${doorName(door)} for ${Math.round(h.config.unlockMs / 1000)} seconds?`;
      h.devices.tv("approval", `Someone at the ${doorName(door)}`, "Asking the family to approve or deny on their phone.");
      const res = await h.broker.ask({
        ref: ctx.decision_id,
        kind: "unlock",
        message,
        field: "approve",
        title: "Approve",
        description: "Approve opens the door once, now. Deny keeps it locked.",
        timeoutMs: h.config.approvalTimeoutMs,
      });
      if (res.answer === null) {
        h.engram.append({ kind: "alert", source: "system", payload: { type: "approval_unanswered", decision_id: ctx.decision_id, why: res.why } });
        return;
      }
      h.approvals.set({ decision_id: ctx.decision_id, approved: res.answer, at: res.at ?? h.clock.now(), role: res.role!, session_id: res.session_id! });
      h.engram.append({
        kind: "input",
        source: res.role!,
        payload: { type: "approval", decision_id: ctx.decision_id, approved: res.answer, session_id: res.session_id },
      });
      if (!res.answer) h.devices.tv("alert", `${cap(res.role!)} denied the request`, `The ${doorName(door)} stays locked.`);
    },

    commit(ctx, result) {
      if (result.path === "pass") {
        const id = passFor.get(ctx.decision_id);
        return !!id && h.passes.consume(id);
      }
      return h.approvals.consume(ctx.decision_id);
    },

    explain(ctx) {
      const extra = ctx.extra as PhysicalExtra;
      const candidates = [ctx.args.reason, extra.agent_last_message].filter((s): s is string => typeof s === "string" && s.length > 0);
      if (!candidates.length) return {};
      const echo = detectEcho(candidates, recentOutsideText(h.engram, h.clock.now()));
      return echo.echoed ? { echoed_outside_text: echo.outsideText, notes: ["this request repeats text from the camera"] } : {};
    },

    record(d) {
      const now = h.clock.now();
      const passId = passFor.get(d.decision_id);
      passFor.delete(d.decision_id);
      const door = doorOf(d.tool);
      h.engram.append({
        kind: "decision",
        source: "system",
        payload: {
          decision_id: d.decision_id,
          tool: d.tool,
          door,
          args: redactArgs(d.args),
          pass_id: passId ?? null,
          inputs: d.inputs,
          allow: d.allow,
          verdict: d.allow ? "ALLOWED" : "BLOCKED",
          path: d.path,
          reasons: d.reasons,
          failed: d.failed,
          notes: d.notes,
          approval_requested: d.approval_requested,
          echoed_outside_text: d.echoed_outside_text ?? null,
          latency_ms: d.latency_ms,
          wait_ms: d.wait_ms,
        },
      });
      // Wrong codes against a known pass count toward revocation.
      if (passId && d.args.presented_code && !d.inputs.code_matches) {
        if (h.passes.wrongCode(passId, now)) {
          const row = h.passes.get(passId);
          h.engram.append({ kind: "effect", source: "system", payload: { type: "pass_revoked", pass_id: passId, who: row?.pass.who, why: "5 wrong codes" } });
          h.devices.alert("caregiver", "Pass revoked", `${row?.pass.who ?? "A visitor"}'s pass was revoked after 5 wrong codes.`);
        }
      }
      h.bus.publish({ type: "decision", decision: { ...d, args: redactArgs(d.args), pass_id: passId ?? null, at: now } });
      if (!d.allow) {
        h.devices.tv("alert", `BLOCKED: the ${doorName(door)} stayed locked`, cap(d.reasons.join("; ")) + ".");
        h.devices.alert("caregiver", `Door request blocked at ${formatClock(now, h.config.tz)}`, cap(d.reasons.join("; ")) + ".");
      }
    },
  });

  async function physical(tool: PhysicalTool, args: UnlockArgs, extra: PhysicalExtra) {
    const decision_id = h.newId("dec_");
    const now = h.clock.now();
    const source: Source = extra.role === "device" ? "visitor" : extra.role;
    h.engram.append({
      kind: "tool_call",
      source,
      payload: { tool, decision_id, physical: true, bucket: extra.bucket, session_id: extra.session_id ?? null, args: redactArgs(args) },
    });
    // A physical request from the homeowner's or caregiver's own app session is itself the fresh tap.
    if ((extra.role === "homeowner" || extra.role === "caregiver") && extra.session_id) {
      h.approvals.set({ decision_id, approved: true, at: now, role: extra.role, session_id: extra.session_id });
    }
    const decision = await guard.check(tool, args, extra, decision_id);
    let effect: Record<string, unknown> = {};
    if (decision.allow) {
      const door = doorOf(tool);
      h.devices.lockFor(door).unlock(`guard:${decision.decision_id}`, h.config.unlockMs);
      const t = formatClock(h.clock.now(), h.config.tz);
      let who: string | null = null;
      if (decision.path === "pass") {
        const row = h.engram.findDecision(decision.decision_id);
        const pid = row?.payload.pass_id as string | undefined;
        who = pid ? h.passes.get(pid)?.pass.who ?? null : null;
      }
      h.engram.append({
        kind: "effect",
        source: "system",
        payload: { type: "door_unlocked", door, decision_id: decision.decision_id, path: decision.path, who, relock_after_ms: h.config.unlockMs, simulated: true },
      });
      if (decision.path === "pass") {
        h.devices.tv("ok", `${who ?? "Expected visitor"} arrived ${t}`, `${cap(doorName(door))} unlocked for ${Math.round(h.config.unlockMs / 1000)} seconds with a one-time pass.`);
        h.devices.alert("caregiver", `${who ?? "Expected visitor"} arrived`, `${cap(doorName(door))} opened at ${t} with their one-time code.`);
      } else {
        h.devices.tv("ok", `${cap(doorName(door))} opened ${t}`, "Approved on the family's phone.");
      }
      effect = { door, state: "unlocked", relocks_in_seconds: Math.round(h.config.unlockMs / 1000), who };
    }
    return { decision, effect };
  }

  return { guard, physical };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function describeEvent(r: EngramRecord, tz: string): string {
  const e = r.payload.event as { type?: string } | undefined;
  const t = formatClock(Date.parse(r.t_event), tz);
  return e?.type === "button_press" ? `doorbell pressed ${t}` : `person seen ${t}`;
}
