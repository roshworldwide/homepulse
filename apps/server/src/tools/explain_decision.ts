import { z } from "zod";
import type { HomePulse } from "../context.js";
import type { EngramRecord } from "../engram/store.js";
import { formatClock, zonedParts, zonedToUtcMs } from "../time.js";
import { ok, type Register } from "./common.js";

const doorName = (d: string) => (d === "parcel_box" ? "parcel box" : "door");
const who = (role: string) => (role === "homeowner" ? "you" : role === "caregiver" ? "Priya" : `the ${role}`);

function joinReasons(raw: string[]): string {
  // "no valid pass" -> "there was no valid pass"; full clauses stay as they are.
  const rs = raw.map((r) => (/^no (?!one\b)/.test(r) ? `there was ${r}` : r));
  if (rs.length <= 1) return rs[0] ?? "it was not allowed";
  return rs.slice(0, -1).join(", ") + " and " + rs.at(-1);
}

const MINUTE = 60_000;
/** How far before the asked time a door request still counts as "around" it. */
const AROUND_MS = 30 * MINUTE;

/**
 * A time the person asked about: an ISO instant, or a local clock time such as
 * "1 PM", "13:05", "2:14pm", "noon", optionally "yesterday". In a free-text
 * question the time needs "at", "around" or "about" in front of it (or am/pm),
 * so ids and other numbers are never read as times. Returns null if there is none.
 */
export function askedTime(text: string, nowMs: number, tz: string, opts: { bare?: boolean } = {}): number | null {
  const t = text.trim();
  if (opts.bare && /^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  const core = t.replace(/\b(yesterday|today)\b/gi, " ").replace(/\s+/g, " ").trim();
  const clock = opts.bare
    ? /^(?:at\s+)?(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?)$/i.exec(core)
    : /\b(?:at|around|about|near)\s+(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?)(?![\w:])/i.exec(t) ??
      /\b((\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?))(?![\w])/i.exec(t);
  if (!clock) return null;
  let hour: number;
  let minute = 0;
  let ampm: "am" | "pm" | null = null;
  if (/^noon$/i.test(clock[1])) hour = 12;
  else if (/^midnight$/i.test(clock[1])) hour = 0;
  else {
    hour = Number(clock[2]);
    minute = clock[3] ? Number(clock[3]) : 0;
    ampm = clock[4] ? (clock[4].toLowerCase().startsWith("a") ? "am" : "pm") : null;
    if (hour > 23 || minute > 59 || (ampm && (hour < 1 || hour > 12))) return null;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  const today = zonedParts(nowMs, tz);
  const dayShift = /\byesterday\b/i.test(t) ? -1 : 0;
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day + dayShift));
  const at = (h: number) => zonedToUtcMs(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, minute, tz);
  // "at 2" with no am/pm: the most recent 2 o'clock that has already happened.
  if (!ampm && hour >= 1 && hour <= 12 && !/^(noon|midnight)$/i.test(clock[1])) {
    const candidates = [hour % 12, (hour % 12) + 12].map(at).filter((ms) => ms <= nowMs);
    return candidates.length ? Math.max(...candidates) : at(hour);
  }
  return at(hour);
}

/**
 * Builds the answer from the decision's recorded inputs and reasons using a
 * template, replaying Engram as of the decision. No model writes the sentence.
 * The decision is picked by id, by a time ("at 1 PM"), or as the latest one.
 */
export function explain(hp: HomePulse, decisionId?: string, question?: string, atText?: string): { sentence: string; decision_id: string | null; based_on: number[] } {
  const tz = hp.config.tz;
  const now = hp.clock.now();

  if (!atText && question && /\bwho (came|visited|was here|has been)\b/i.test(question)) {
    const today = zonedParts(now, tz);
    const startOfDay = zonedToUtcMs(today.year, today.month, today.day, 0, 0, tz);
    const opened = hp.engram.eventsBetween(startOfDay, now, "effect").filter((r) => r.payload.type === "door_unlocked");
    if (!opened.length) return { sentence: "No one has come in today.", decision_id: null, based_on: [] };
    const parts = opened.map((r) => `${r.payload.who ?? "a visitor let in after an approval"} at ${formatClock(Date.parse(r.t_event), tz)}`);
    return { sentence: `Today: ${parts.join("; ")}.`, decision_id: null, based_on: opened.map((r) => r.id) };
  }

  // "open" asks about a door that opened, unless the question is negative ("why didn't it open?").
  const askOpened = !!question && /\bopen(ed)?\b/i.test(question) && !/\b(didn'?t|did not|not|wouldn'?t|won'?t|never|stay(ed)? locked)\b/i.test(question);

  if (!decisionId) {
    const T = atText ? askedTime(atText, now, tz, { bare: true }) : question ? askedTime(question, now, tz) : null;
    if (atText && T === null) return { sentence: `I couldn't read "${atText.slice(0, 40)}" as a time.`, decision_id: null, based_on: [] };
    if (T !== null) {
      const when = formatClock(T, tz);
      if (T > now + MINUTE) return { sentence: `It isn't ${when} yet.`, decision_id: null, based_on: [] };
      const near = hp.engram.decisionsBetween(T - AROUND_MS, T + MINUTE - 1, now);
      const pick = (askOpened ? near.filter((r) => r.payload.allow === true) : near).at(-1);
      if (pick) return sentenceFor(hp, pick, now);
      if (askOpened && near.length) {
        const r = sentenceFor(hp, near.at(-1)!, now);
        return { ...r, sentence: `The door didn't open around ${when}. ${r.sentence}` };
      }
      return { sentence: `There were no door requests around ${when}.`, decision_id: null, based_on: [] };
    }
  }

  let dec: EngramRecord | undefined;
  if (decisionId) dec = hp.engram.findDecision(decisionId, now);
  else if (askOpened) dec = hp.engram.latestDecision(now, true);
  dec ??= decisionId ? undefined : hp.engram.latestDecision(now);
  if (!dec) return { sentence: decisionId ? "I couldn't find that door request." : "There haven't been any door requests yet.", decision_id: null, based_on: [] };
  return sentenceFor(hp, dec, now);
}

function sentenceFor(hp: HomePulse, dec: EngramRecord, now: number): { sentence: string; decision_id: string | null; based_on: number[] } {
  const tz = hp.config.tz;
  const d = dec.payload as Record<string, any>;
  const at = formatClock(Date.parse(dec.t_event), tz);
  const knownAt = Date.parse(dec.t_known);
  const based: number[] = [dec.id];

  if (d.allow && d.path === "pass") {
    const issued = d.pass_id ? hp.engram.passIssued(String(d.pass_id), knownAt) : undefined;
    const opened = hp.engram.aboutDecision(String(d.decision_id), now).find((r) => r.payload.type === "door_unlocked");
    const name = (opened?.payload.who as string | undefined) ?? (issued?.payload.who as string | undefined) ?? "the visitor";
    if (issued) based.push(issued.id);
    const approved = issued ? `, which ${who(String(issued.payload.issued_by))} approved at ${formatClock(Date.parse(issued.t_known), tz)},` : "";
    const where = d.args?.channel === "keypad" ? "the code entered at the door" : "the code given to Alexa";
    return { sentence: `The ${doorName(d.door)} opened at ${at} because ${name}'s pass${approved} matched ${where}.`, decision_id: d.decision_id, based_on: based };
  }
  if (d.allow && d.path === "owner") {
    const appr = hp.engram.aboutDecision(String(d.decision_id), knownAt).filter((r) => r.payload.type === "approval").at(-1);
    if (appr) based.push(appr.id);
    const by = appr ? `${who(appr.source)} approved it on the phone at ${formatClock(Date.parse(appr.t_known), tz)}` : "it was approved in the app";
    return { sentence: `The ${doorName(d.door)} opened at ${at} because ${by}.`, decision_id: d.decision_id, based_on: based };
  }
  return { sentence: `The ${doorName(d.door)} stayed locked at ${at} because ${joinReasons(d.reasons ?? [])}.`, decision_id: d.decision_id, based_on: based };
}

/** The records a decision relied on, as HomePulse knew them at the time (for the console's Why? panel). */
export function why(hp: HomePulse, decisionId: string) {
  const dec = hp.engram.findDecision(decisionId);
  if (!dec) return null;
  const knownAt = Date.parse(dec.t_known);
  const relied = [
    ...(dec.payload.pass_id ? [hp.engram.passIssued(String(dec.payload.pass_id), knownAt)] : []),
    ...hp.engram.aboutDecision(decisionId, knownAt).filter((r) => r.payload.type === "approval"),
    hp.engram.latestPersonEvent(knownAt - 120_000, knownAt),
  ].filter((r): r is EngramRecord => !!r);
  return { decision: dec, relied_on: relied.sort((a, b) => a.id - b.id), known_records: dec.id };
}

export const registerExplainDecision: Register = (server, hp) => {
  server.registerTool(
    "explain_decision",
    {
      title: "Explain a door decision",
      description: "Answer 'why did the door open (or not)?', 'what happened at 1 PM?' or 'who came today?' from the log, as HomePulse knew it at the time. Pick the request by decision_id, by a time, or the latest. The sentence is filled from a template, not written by a model: say it exactly as returned.",
      inputSchema: {
        decision_id: z.string().max(40).optional(),
        at: z.string().max(40).optional().describe('A time to explain, e.g. "1 PM", "13:05", "yesterday 9 pm" or an ISO 8601 instant'),
        question: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ decision_id, at, question }) => {
      const r = explain(hp, decision_id, question, at);
      return ok(r, r.sentence);
    },
  );
};
