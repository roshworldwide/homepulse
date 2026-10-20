import { z } from "zod";
import type { HomePulse } from "../context.js";
import type { EngramRecord } from "../engram/store.js";
import { formatClock, zonedParts } from "../time.js";
import { ok, type Register } from "./common.js";

const doorName = (d: string) => (d === "parcel_box" ? "parcel box" : "door");
const who = (role: string) => (role === "homeowner" ? "you" : role === "caregiver" ? "Priya" : `the ${role}`);

function joinReasons(raw: string[]): string {
  // "no valid pass" -> "there was no valid pass"; full clauses stay as they are.
  const rs = raw.map((r) => (/^no (?!one\b)/.test(r) ? `there was ${r}` : r));
  if (rs.length <= 1) return rs[0] ?? "it was not allowed";
  return rs.slice(0, -1).join(", ") + " and " + rs.at(-1);
}

/**
 * Builds the answer from the decision's recorded inputs and reasons using a
 * template, replaying Engram as of the decision. No model writes the sentence.
 */
export function explain(hp: HomePulse, decisionId?: string, question?: string): { sentence: string; decision_id: string | null; based_on: number[] } {
  const tz = hp.config.tz;
  const now = hp.clock.now();
  const known = hp.engram.asOf(now);

  if (question && /\bwho (came|visited|was here|has been)\b/i.test(question)) {
    const today = zonedParts(now, tz);
    const opened = known.filter((r) => {
      if (r.payload.type !== "door_unlocked") return false;
      const p = zonedParts(Date.parse(r.t_event), tz);
      return p.year === today.year && p.month === today.month && p.day === today.day;
    });
    if (!opened.length) return { sentence: "No one has come in today.", decision_id: null, based_on: [] };
    const parts = opened.map((r) => `${r.payload.who ?? "a visitor let in after an approval"} at ${formatClock(Date.parse(r.t_event), tz)}`);
    return { sentence: `Today: ${parts.join("; ")}.`, decision_id: null, based_on: opened.map((r) => r.id) };
  }

  let dec: EngramRecord | undefined;
  if (decisionId) dec = known.filter((r) => r.kind === "decision" && r.payload.decision_id === decisionId).at(-1);
  else if (question && /\bopen\b/i.test(question)) dec = known.filter((r) => r.kind === "decision" && r.payload.allow === true).at(-1);
  dec ??= known.filter((r) => r.kind === "decision").at(-1);
  if (!dec) return { sentence: "There haven't been any door requests yet.", decision_id: null, based_on: [] };

  const d = dec.payload as Record<string, any>;
  const at = formatClock(Date.parse(dec.t_event), tz);
  const asOf = hp.engram.asOf(Date.parse(dec.t_known));
  const based: number[] = [dec.id];

  if (d.allow && d.path === "pass") {
    const issued = asOf.filter((r) => r.payload.type === "pass_issued" && r.payload.pass_id === d.pass_id).at(-1);
    const opened = asOf.concat(hp.engram.asOf(now)).find((r) => r.payload.type === "door_unlocked" && r.payload.decision_id === d.decision_id);
    const name = (opened?.payload.who as string | undefined) ?? (issued?.payload.who as string | undefined) ?? "the visitor";
    if (issued) based.push(issued.id);
    const approved = issued ? `, which ${who(String(issued.payload.issued_by))} approved at ${formatClock(Date.parse(issued.t_known), tz)},` : "";
    const where = d.args?.channel === "keypad" ? "the code entered at the door" : "the code given to Alexa";
    return { sentence: `The ${doorName(d.door)} opened at ${at} because ${name}'s pass${approved} matched ${where}.`, decision_id: d.decision_id, based_on: based };
  }
  if (d.allow && d.path === "owner") {
    const appr = asOf.filter((r) => r.payload.type === "approval" && r.payload.decision_id === d.decision_id).at(-1);
    if (appr) based.push(appr.id);
    const by = appr ? `${who(appr.source)} approved it on the phone at ${formatClock(Date.parse(appr.t_known), tz)}` : "it was approved in the app";
    return { sentence: `The ${doorName(d.door)} opened at ${at} because ${by}.`, decision_id: d.decision_id, based_on: based };
  }
  return { sentence: `The ${doorName(d.door)} stayed locked at ${at} because ${joinReasons(d.reasons ?? [])}.`, decision_id: d.decision_id, based_on: based };
}

export const registerExplainDecision: Register = (server, hp) => {
  server.registerTool(
    "explain_decision",
    {
      title: "Explain a door decision",
      description: "Answer 'why did the door open (or not)?' or 'who came today?' from the log, as HomePulse knew it at the time. The sentence is filled from a template, not written by a model.",
      inputSchema: { decision_id: z.string().max(40).optional(), question: z.string().max(300).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ decision_id, question }) => {
      const r = explain(hp, decision_id, question);
      return ok(r, r.sentence);
    },
  );
};
