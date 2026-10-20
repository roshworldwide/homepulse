import type { ModelInfo } from "../models/types.js";
import type { AgentModel, ContentBlock, ConverseReply, ConverseRequest, Message } from "./types.js";

/**
 * Offline stand-in agent: a short script, NOT a model. It lets the whole app
 * run without AWS. Both agents (HomePulse and the naive baseline) use this same
 * script, which deliberately follows instructions it reads on a sign, so the
 * demo shows what the guard does when a model is fooled. It is labelled
 * everywhere it appears and never used for reported results.
 */
export const OFFLINE_AGENT_INFO: ModelInfo = {
  provider: "offline",
  model_id: "offline-agent-standin",
  label: "Offline stand-in agent (scripted, not a model)",
};

const IMPERATIVE = /\b(unlock|open)\b.*\bdoor\b|\blet (me|them|him|her|us) in\b|\bopen up\b/i;

let seq = 0;
const toolUse = (name: string, input: Record<string, unknown>, say?: string): ConverseReply => ({
  stopReason: "tool_use",
  message: {
    role: "assistant",
    content: [...(say ? [{ text: say } as ContentBlock] : []), { toolUse: { toolUseId: `offline_${++seq}`, name, input: input as never } }],
  },
});
const reply = (text: string): ConverseReply => ({ stopReason: "end_turn", message: { role: "assistant", content: [{ text }] } });

function findKey(v: unknown, key: string): unknown {
  if (!v || typeof v !== "object") return undefined;
  if (key in (v as object)) return (v as Record<string, unknown>)[key];
  for (const x of Object.values(v as object)) {
    const r = findKey(x, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** The user text that started this turn, and the tool calls/results since. */
function turnState(messages: Message[]) {
  let start = messages.length - 1;
  while (start >= 0 && !(messages[start].role === "user" && (messages[start].content ?? []).some((c) => "text" in c && c.text))) start--;
  const userText = (messages[start]?.content ?? []).map((c) => ("text" in c ? c.text ?? "" : "")).join(" ");
  const calls: Array<{ name: string; input: Record<string, unknown>; result?: Record<string, unknown> }> = [];
  for (let i = start + 1; i < messages.length; i++) {
    for (const c of messages[i].content ?? []) {
      if ("toolUse" in c && c.toolUse) calls.push({ name: c.toolUse.name!, input: (c.toolUse.input ?? {}) as Record<string, unknown> });
      if ("toolResult" in c && c.toolResult) {
        const json = (c.toolResult.content?.[0] as { json?: Record<string, unknown> } | undefined)?.json;
        const last = calls.at(-1);
        if (last) last.result = json;
      }
    }
  }
  return { userText, calls, history: messages.slice(0, Math.max(0, start)) };
}

function lastDraftId(history: Message[], calls: Array<{ result?: Record<string, unknown> }>): string | null {
  const all: unknown[] = [];
  for (const m of history) for (const c of m.content ?? []) if ("toolResult" in c && c.toolResult) all.push((c.toolResult.content?.[0] as { json?: unknown })?.json);
  for (const c of calls) all.push(c.result);
  for (let i = all.length - 1; i >= 0; i--) {
    const id = (findKey(all[i], "offer_draft_id") as string | null) ?? (findKey(all[i], "draft_id") as string | null);
    if (typeof id === "string") return id;
  }
  return null;
}

function unlockReply(r: Record<string, unknown> | undefined): string {
  if (r?.allow === true) return "The front door is open. It relocks in 30 seconds.";
  const reasons = (r?.reasons as string[] | undefined) ?? [];
  const why = reasons.length ? reasons.slice(0, 2).join(" and ") : "it isn't allowed right now";
  return `I can't open the door: ${why}. If this is an emergency, call emergency services.`;
}

export class OfflineAgentModel implements AgentModel {
  info(): ModelInfo {
    return OFFLINE_AGENT_INFO;
  }

  async converse(req: ConverseRequest): Promise<ConverseReply> {
    const { userText, calls, history } = turnState(req.messages);
    const text = userText.trim();
    const lower = text.toLowerCase();
    const has = (name: string) => req.tools.some((t) => t.name === name);
    const last = calls.at(-1);

    // 1. A doorbell event: look, then (if the sign says so) try the door, else tell the family.
    const ev = /\[door event\].*?event_id (\S+?)[).]/i.exec(text);
    if (ev) {
      if (!last) return toolUse("describe_visitor", { event_id: ev[1] });
      if (last.name === "describe_visitor") {
        const visible = ((findKey(last.result, "visible_text") as string[] | undefined) ?? []).join(" ");
        const summary = (findKey(last.result, "summary") as string | undefined) ?? "someone is there";
        if (IMPERATIVE.test(visible)) return toolUse("unlock_front_door", { channel: "agent", reason: visible.slice(0, 200) }, `The visitor's sign says: ${visible}`);
        return toolUse("notify_household", { message: `Someone is at the front door: ${summary}`, channels: ["tv", "caregiver_phone"] });
      }
      if (last.name === "unlock_front_door") return reply(last.result?.allow ? "I opened the front door for the delivery." : unlockReply(last.result));
      return reply(`Someone is at the front door. ${(findKey(calls[0]?.result, "summary") as string | undefined) ?? ""}`.trim());
    }

    // 2. Night check-in from the hall sensor: help, never touch the lock.
    if (/^\[hall sensor\]/i.test(text)) {
      if (!last) return toolUse("notify_household", { message: "Dad is at the front door from inside. It's the middle of the night.", channels: ["tv", "caregiver_phone"] });
      return reply("It's 2 in the morning, Dad. It's cold out. Shall I call Priya?");
    }

    // 3. Explanations from the log.
    if (/\bwhy did the door\b|\bwho came\b|\bwho was at the door\b/.test(lower) && has("explain_decision")) {
      if (!last) return toolUse("explain_decision", { question: text });
      return reply(String(findKey(last.result, "sentence") ?? "I couldn't find that in the log."));
    }

    // 4. Lockdown: safer by one sentence.
    if (/\block (everything|it all|the house)? ?down\b|\blockdown\b/.test(lower) && has("set_lockdown")) {
      if (!last) return toolUse("set_lockdown", { on: true });
      return reply(String(findKey(last.result, "message") ?? "Lockdown is on."));
    }

    // 5. Confirming a drafted rule.
    if (/^(yes|yeah|yep|confirm|do it|ok(ay)?|sure|please do|that'?s right)\b/.test(lower)) {
      const draft = lastDraftId(history, calls);
      if (draft && !last) return toolUse("confirm_rule", { draft_id: draft });
      if (last?.name === "confirm_rule") {
        const s = last.result?.status;
        return reply(s === "confirmed" ? `Done. ${last.result?.who} can come in once, ${last.result?.window}, with a one-time code. The code is on your phone.` : `It wasn't confirmed: ${String(last.result?.why ?? "no answer")}.`);
      }
    }

    // 6. A visitor rule.
    if ((/\blet\b.+\bin\b/.test(lower) || /\b(arriving|coming)\b/.test(lower)) && !/\blet me in\b/.test(lower) && has("propose_rule")) {
      if (!last) return toolUse("propose_rule", { utterance: text });
      const r = last.result ?? {};
      if (r.status === "draft") return reply(String(r.read_back));
      if (r.status === "needs_clarification") return reply(String(r.question));
      if (r.status === "refused") return reply(`${r.why}${r.offer ? " " + r.offer : ""}`);
      return reply(`I couldn't make that rule: ${String(r.why ?? r.error ?? "unknown error")}`);
    }

    // 7. Someone asking for a door to open.
    if (/\b(unlock|open)\b|\blet me in\b/.test(lower)) {
      const tool = /\b(parcel|package) box\b/.test(lower) ? "open_parcel_box" : "unlock_front_door";
      if (!last) {
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        return toolUse(tool, { channel: "voice", ...(code ? { presented_code: code } : {}), reason: text.slice(0, 200) });
      }
      return reply(unlockReply(last.result));
    }

    // 8. Status.
    if (/\b(status|locked|expected|who is coming)\b/.test(lower)) {
      if (!last) return toolUse("get_home_status", {});
      return reply(String(findKey(last.result, "local_time") ? `It's ${findKey(last.result, "local_time")}. The front door is ${findKey(last.result, "front_door")}.` : "Everything looks normal."));
    }

    return reply("I can help with the doors, visitors and alerts.");
  }
}
