import { z } from "zod";
import type { Source } from "mcp-streamable-guard";
import { formatWindow } from "../time.js";
import { doorLabel, fail, ok, type Register } from "./common.js";
import type { HomePulse } from "../context.js";

export const registerProposeRule: Register = (server, hp, session) => {
  server.registerTool(
    "propose_rule",
    {
      title: "Propose a visitor rule",
      description:
        "Turn a spoken request such as 'let Nurse Sarah in today between 2 and 3' into a draft one-time pass and the sentence to read back. Has no effect until confirm_rule is approved in the app.",
      inputSchema: { utterance: z.string().min(3).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ utterance }) => {
      const source: Source = session.role === "agent" ? "homeowner" : session.role;
      const r = await hp.compiler.propose(utterance, source);
      switch (r.status) {
        case "draft":
          return ok({ ...r }, `Read this back: "${r.read_back}" Then call confirm_rule with draft_id ${r.draft_id}.`);
        case "needs_clarification":
          return ok({ ...r }, `Ask one question: ${r.question}`);
        case "refused":
          return ok({ ...r }, `Refused: ${r.why}${r.offer ? ` Offer: ${r.offer}${r.offer_draft_id ? ` (if they agree, call confirm_rule with draft_id ${r.offer_draft_id})` : ""}` : ""}`);
        default:
          return fail(r.why, { status: r.status });
      }
    },
  );
};

/** Ask an approver to confirm a draft; on yes, sign it and show the code once on that approver's phone only. */
export async function confirmDraft(hp: HomePulse, draftId: string, via: string, roles?: Array<"homeowner" | "caregiver">) {
  const draft = hp.compiler.getDraft(draftId);
  if (!draft) return { status: "not_found" as const, why: "No such draft. Drafts expire after 15 minutes." };
  const sentence = draft.read_back.replace(/ Confirm in the app\.$/, "");
  const ask = await hp.broker
    .ask({
    ref: draftId,
    kind: "rule",
    message: `Confirm this rule (${via}): ${sentence}`,
    field: "confirm",
    title: "Confirm",
    description: "Confirm signs a one-time pass and shows you the code once.",
    timeoutMs: hp.config.approvalTimeoutMs,
    roles,
  })
    .catch((err): { answer: null; why: string; role?: undefined; session_id?: undefined } => ({ answer: null, why: `asking the phone failed (${err instanceof Error ? err.message : String(err)})` }));
  if (ask.answer === null) return { status: "not_confirmed" as const, why: ask.why ?? "no answer" };
  hp.engram.append({ kind: "input", source: ask.role!, payload: { type: "rule_confirmation", draft_id: draftId, confirmed: ask.answer } });
  if (!ask.answer) return { status: "declined" as const, why: `The ${ask.role} declined the rule.` };
  const issued = hp.compiler.issue(draftId, ask.role!);
  if (!issued) return { status: "not_found" as const, why: "The draft expired before it was confirmed." };
  const now = hp.clock.now();
  const window = formatWindow(issued.pass.not_before, issued.pass.not_after, hp.config.tz, now);
  hp.devices.tv("neutral", `Expected ${window.split(" ")[0]}: ${issued.pass.who}, ${window.replace(/^\S+ /, "")}`, issued.pass.purpose ? `For ${issued.pass.purpose}.` : "");

  // Show the code once, only to the person who confirmed. It never goes back to the agent.
  void hp.broker
    .ask({
      ref: `code_${issued.pass.pass_id}`,
      kind: "code",
      sessionId: ask.session_id,
      message: `One-time code for ${issued.pass.who}: ${issued.code}. It is shown once; HomePulse keeps only a hash. Send it to ${issued.pass.who} by text message (simulated)?`,
      field: "send",
      title: "Send to visitor",
      description: "Sends the code to the visitor's phone (simulated text message).",
      timeoutMs: 10 * 60_000,
    })
    .then((r) => {
      if (r.answer === null && r.why === "no approver connected") {
        // The phone that confirmed went away before the code could be shown, so nobody has the code:
        // revoke the orphan pass and say so, instead of leaving a pass no one can use.
        hp.passes.revoke(issued.pass.pass_id, "code could not be shown", hp.clock.now());
        hp.engram.append({ kind: "effect", source: "system", payload: { type: "pass_revoked", pass_id: issued.pass.pass_id, who: issued.pass.who, why: "the code could not be shown on the phone" } });
        hp.devices.alert(ask.role ?? "homeowner", "Pass not created", `The code for ${issued.pass.who} could not be shown, so that pass was cancelled. Please ask again.`);
        return;
      }
      if (r.answer) {
        hp.devices.text(issued.pass.who, `HomePulse: your one-time code for the ${doorLabel(issued.pass.door)} (${window}) is ${issued.code}.`);
        hp.engram.append({ kind: "effect", source: r.role ?? "homeowner", payload: { type: "code_sent", pass_id: issued.pass.pass_id, to: issued.pass.who, simulated: true } });
      }
    })
    .catch((err) => console.error("[homepulse] showing the code failed:", err));

  return {
    status: "confirmed" as const,
    who: issued.pass.who,
    door: issued.pass.door,
    window,
    valid_at_night: issued.pass.allow_at_night,
    confirmed_by: ask.role,
    code_delivery: `shown once on the ${ask.role}'s phone`,
  };
}

export const registerConfirmRule: Register = (server, hp, session) => {
  server.registerTool(
    "confirm_rule",
    {
      title: "Confirm a visitor rule",
      description:
        "Ask the homeowner or caregiver to confirm a drafted rule in their app. On Confirm, HomePulse signs a one-time pass and shows the code once on their phone. The code is never returned to you.",
      inputSchema: { draft_id: z.string().min(1).max(40) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ draft_id }) => {
      const r = await confirmDraft(hp, draft_id, session.role === "agent" ? "requested by voice through the home assistant" : `requested by the ${session.role}`);
      if (r.status === "confirmed") {
        return ok(r, `Confirmed by the ${r.confirmed_by}. ${r.who} can come in once, ${r.window}, with a one-time code. The code was shown on the ${r.confirmed_by}'s phone.`);
      }
      return ok(r, `Not confirmed: ${r.why}`);
    },
  );
};
