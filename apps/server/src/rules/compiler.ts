import { randomUUID } from "node:crypto";
import { hashCode, newCode, newPassId, signPass, type Door, type PassBody, type SigningKeys, type Source, type VisitPass } from "mcp-streamable-guard";
import type { Clock } from "../clock.js";
import type { Engram } from "../engram/store.js";
import type { PassStore } from "../state/passes.js";
import { NIGHT_END_HOUR, NIGHT_START_HOUR } from "../state/home.js";
import { formatWindow, isoInTz, zonedParts } from "../time.js";
import { DraftSchema, type ModelInfo, type ModelProvider, type RuleDraftRaw } from "../models/types.js";

export const MAX_WINDOW_MS = 12 * 60 * 60_000;
const START_GRACE_MS = 2 * 60_000;
const DRAFT_TTL_MS = 15 * 60_000;
const SAFE_DEPENDENCIES = new Set(["pass_code", "owner_approval"]);

/** Conditions a visitor can fake. A rule that rests on any of these is refused. */
const FAKEABLE = /\b(whoever|uniform|badge|wearing|dressed|says (?:she|he|they)(?:'s| is| are)|claims?|from amazon|delivery (?:guy|person|driver)s?|anyone|anybody|everyone|everybody|always|any ?night|every ?night|any ?time|whenever|face|looks like|recogni[sz]e)\b/i;
const OPEN_ENDED = /\b(always|forever|any ?night|every ?night|every ?day|any ?time|permanent(?:ly)?|from now on)\b/i;
const NIGHT_WORDS = /\b(even at night|at night|overnight|late at night|night ?time)\b/i;

export interface Draft {
  draft_id: string;
  submitted_by: Source;
  utterance: string;
  who: string;
  door: Door;
  not_before: string;
  not_after: string;
  allow_at_night: boolean;
  purpose: string | null;
  read_back: string;
  created_at: number;
  t_event: number;
  model: ModelInfo;
}

export type ProposeResult =
  | { status: "draft"; draft_id: string; read_back: string; draft: PublicDraft; model: ModelInfo }
  | { status: "needs_clarification"; question: string; model: ModelInfo }
  | { status: "refused"; why: string; offer: string | null; offer_draft_id: string | null; model: ModelInfo }
  | { status: "invalid"; why: string; model: ModelInfo };

export type PublicDraft = Pick<Draft, "who" | "door" | "not_before" | "not_after" | "allow_at_night" | "purpose">;

export interface Issued {
  pass: VisitPass;
  /** Six digits, returned only to the approver's session. Never stored, never given to the agent or the model. */
  code: string;
}

const doorName = (d: Door) => (d === "front" ? "front door" : "parcel box");

/** Turns a spoken rule into a draft, then (after a tap in the app) into a signed one-time pass. */
export class RuleCompiler {
  private drafts = new Map<string, Draft>();

  constructor(
    private provider: () => ModelProvider,
    private clock: Clock,
    private tz: string,
    private keys: SigningKeys,
    private codeSecret: string,
    private passes: PassStore,
    private engram: Engram,
  ) {}

  getDraft(id: string): Draft | undefined {
    const d = this.drafts.get(id);
    if (d && this.clock.now() - d.created_at > DRAFT_TTL_MS) {
      this.drafts.delete(id);
      return undefined;
    }
    return d;
  }

  pendingDrafts(): Draft[] {
    return [...this.drafts.values()].filter((d) => this.clock.now() - d.created_at <= DRAFT_TTL_MS);
  }

  clear(): void {
    this.drafts.clear();
  }

  async propose(utterance: string, submittedBy: Source, opts: { t_event?: number } = {}): Promise<ProposeResult> {
    const now = this.clock.now();
    const p = zonedParts(now, this.tz);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: this.tz, weekday: "long" }).format(new Date(now));
    const clean = utterance.replace(/[\u0000-\u001f]/g, " ").slice(0, 500);
    const { output, info, latency_ms } = await this.provider().draftRule(clean, { now_iso: isoInTz(now, this.tz), tz: this.tz, weekday });
    void p;

    this.engram.append({
      kind: "input",
      source: submittedBy,
      t_event: opts.t_event,
      payload: { type: "rule_utterance", utterance: clean, model: info, latency_ms, draft: output },
    });

    const parsed = DraftSchema.safeParse(output);
    if (!parsed.success) return { status: "invalid", why: "The draft did not match the rule schema.", model: info };
    const raw: RuleDraftRaw = parsed.data;

    // 1. Unsafe conditions: anything a visitor can fake, or open-ended times.
    const unsafeDeps = raw.depends_on.filter((d) => !SAFE_DEPENDENCIES.has(d));
    const fakeable = FAKEABLE.exec(clean);
    const openEnded = OPEN_ENDED.exec(clean);
    if (unsafeDeps.length > 0 || fakeable || openEnded) {
      return this.refuse(clean, raw, submittedBy, info, fakeable?.[0] ?? openEnded?.[0] ?? unsafeDeps[0], opts.t_event);
    }

    // 2. Vague timing: ask one question instead of drafting.
    if (raw.needs_clarification || !raw.not_before || !raw.not_after) {
      return { status: "needs_clarification", question: raw.needs_clarification ?? "What time should I expect them, and until when?", model: info };
    }

    const checked = this.checkLimits(raw, clean, now);
    if ("why" in checked) return { status: "invalid", why: checked.why, model: info };

    const draft = this.store({ ...checked, submitted_by: submittedBy, utterance: clean, model: info, t_event: opts.t_event ?? now });
    return { status: "draft", draft_id: draft.draft_id, read_back: draft.read_back, draft: publicDraft(draft), model: info };
  }

  private checkLimits(raw: RuleDraftRaw, utterance: string, now: number): PublicDraft | { why: string } {
    let start = Date.parse(raw.not_before ?? "");
    const end = Date.parse(raw.not_after ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) return { why: "The time window could not be read." };
    if (start < now - START_GRACE_MS) return { why: "The window has to start in the future." };
    if (start < now) start = now;
    if (end <= start) return { why: "The window has to end after it starts." };
    if (end - start > MAX_WINDOW_MS) return { why: "A pass can last 12 hours at most." };
    if (raw.door !== "front" && raw.door !== "parcel_box") return { why: "Unknown door." };
    const who = raw.who.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!who) return { why: "Who is the pass for?" };
    // allow_at_night only when the person said so in words.
    const allow_at_night = raw.allow_at_night && NIGHT_WORDS.test(utterance);
    return {
      who,
      door: raw.door,
      not_before: isoInTz(start, this.tz),
      not_after: isoInTz(end, this.tz),
      allow_at_night,
      purpose: raw.purpose,
    };
  }

  private readBack(d: PublicDraft, now: number): string {
    const window = formatWindow(d.not_before, d.not_after, this.tz, now);
    let s = `Allow ${d.who} through the ${doorName(d.door)} once, ${window}, with a code`;
    if (d.allow_at_night) s += ", even at night";
    s += ".";
    if (!d.allow_at_night && overlapsNight(d.not_before, d.not_after, this.tz)) {
      s += " Night mode starts at 10 PM, so the code won't open the door after that.";
    }
    return s + " Confirm in the app.";
  }

  private store(d: PublicDraft & { submitted_by: Source; utterance: string; model: ModelInfo; t_event: number }): Draft {
    const now = this.clock.now();
    const draft: Draft = { ...d, draft_id: "draft_" + randomUUID().slice(0, 8), read_back: this.readBack(d, now), created_at: now };
    this.drafts.set(draft.draft_id, draft);
    return draft;
  }

  private refuse(utterance: string, raw: RuleDraftRaw, submittedBy: Source, info: ModelInfo, trigger: string | undefined, tEvent?: number): ProposeResult {
    const now = this.clock.now();
    void trigger;
    const why = /\b(uniform|badge|wearing|dressed)\b/i.test(utterance)
      ? "Anyone can wear a uniform."
      : /\b(says|claims?|from amazon|amazon guy|delivery (?:guy|person|driver))\b/i.test(utterance)
        ? "Anyone can say that at the door."
        : /\b(face|looks like|recogni[sz]e)\b/i.test(utterance)
          ? "HomePulse doesn't open doors based on how someone looks."
          : OPEN_ENDED.test(utterance)
            ? "A pass can't be open-ended; it needs a time window of 12 hours or less."
            : /\b(anyone|anybody|everyone|everybody|whoever)\b/i.test(utterance)
              ? "That would let in anyone who comes to the door."
              : "That rule rests on something a visitor could fake.";

    // Offer the nearest safe rule: a named person with a one-time code for a set window.
    const named = /^(?:[A-Z][\w'-]*\.?\s?){1,4}$/.test(raw.who.trim()) && !FAKEABLE.test(raw.who) ? raw.who.trim() : null;
    const keyword = /\b(nurse|doctor|aide|carer|caregiver|plumber|cleaner|electrician|courier)\b/i.exec(utterance)?.[1]?.toLowerCase();
    const known = keyword
      ? this.pendingDrafts().find((d) => d.who.toLowerCase().includes(keyword)) ??
        this.passes.active(now).map((r) => r.pass).find((p) => p.who.toLowerCase().includes(keyword))
      : undefined;
    const who = named ?? known?.who ?? null;
    let windowStart = raw.not_before ? Date.parse(raw.not_before) : NaN;
    let windowEnd = raw.not_after ? Date.parse(raw.not_after) : NaN;
    if ((Number.isNaN(windowStart) || Number.isNaN(windowEnd)) && known) {
      windowStart = Date.parse(known.not_before);
      windowEnd = Date.parse(known.not_after);
    }
    if (who && !Number.isNaN(windowStart) && !Number.isNaN(windowEnd)) {
      const safe = this.checkLimits(
        { ...raw, who, not_before: new Date(windowStart).toISOString(), not_after: new Date(windowEnd).toISOString(), allow_at_night: false, depends_on: ["pass_code"], needs_clarification: null },
        "",
        now,
      );
      if (!("why" in safe)) {
        const draft = this.store({ ...safe, submitted_by: submittedBy, utterance, model: info, t_event: tEvent ?? now });
        const window = formatWindow(safe.not_before, safe.not_after, this.tz, now);
        return {
          status: "refused",
          why,
          offer: `I can give ${who} a one-time code for ${window.replace(/^today /, "")} instead. Want that?`,
          offer_draft_id: draft.draft_id,
          model: info,
        };
      }
    }
    return {
      status: "refused",
      why,
      offer: "I can give a named visitor a one-time code for a set time instead. Who is coming, and when?",
      offer_draft_id: null,
      model: info,
    };
  }

  /** Called only after an approver tapped Confirm in the app. */
  issue(draftId: string, issuedBy: "homeowner" | "caregiver"): Issued | null {
    const d = this.getDraft(draftId);
    if (!d) return null;
    this.drafts.delete(draftId);
    const now = this.clock.now();
    const code = newCode();
    const body: PassBody = {
      pass_id: newPassId(),
      door: d.door,
      who: d.who,
      purpose: d.purpose ?? undefined,
      not_before: d.not_before,
      not_after: d.not_after,
      max_uses: 1,
      code_hash: hashCode(code, this.codeSecret),
      allow_at_night: d.allow_at_night,
      issued_by: issuedBy,
      confirmed_via: "app",
      issued_at: isoInTz(now, this.tz),
    };
    const pass = signPass(body, this.keys.privateKey);
    this.passes.insert(pass, now);
    this.engram.append({
      kind: "effect",
      source: issuedBy,
      payload: {
        type: "pass_issued",
        pass_id: pass.pass_id,
        who: pass.who,
        door: pass.door,
        not_before: pass.not_before,
        not_after: pass.not_after,
        allow_at_night: pass.allow_at_night,
        issued_by: issuedBy,
        draft_id: draftId,
      },
    });
    return { pass, code };
  }
}

export function publicDraft(d: PublicDraft): PublicDraft {
  return { who: d.who, door: d.door, not_before: d.not_before, not_after: d.not_after, allow_at_night: d.allow_at_night, purpose: d.purpose };
}

function overlapsNight(startIso: string, endIso: string, tz: string): boolean {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  for (let t = s; t <= e; t += 15 * 60_000) {
    const h = zonedParts(t, tz).hour;
    if (h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR) return true;
  }
  return false;
}
