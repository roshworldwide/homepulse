import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { zonedParts, zonedToUtcMs, isoInTz } from "../time.js";
import { DraftSchema, VisitorSchema, type DraftContext, type ImageInput, type ModelInfo, type ModelProvider, type RuleDraftRaw, type VisitorDescription } from "./types.js";

/**
 * A deterministic local stand-in so the app runs with no AWS account.
 * It is NOT a model, is labelled "Offline stand-in" everywhere it appears,
 * and is never used for any reported result.
 */
const INFO: ModelInfo = { provider: "offline", model_id: "offline-standin", label: "Offline stand-in (not a model)" };

const UNSAFE = /\b(uniform|badge|wearing|says (?:she|he|they)(?:'s| is| are)|claims?|from amazon|anyone|anybody|everyone|everybody|always|any ?night|every ?night|any ?time|whenever|face|looks like)\b/i;

function to24(h: number, ampm: string | undefined, otherAmpm: string | undefined, isStart: boolean, otherH?: number): number {
  const m = (ampm ?? "").replace(/\./g, "").toLowerCase();
  if (m === "am") return h === 12 ? 0 : h;
  if (m === "pm") return h === 12 ? 12 : h + 12;
  const o = (otherAmpm ?? "").replace(/\./g, "").toLowerCase();
  if (isStart && o === "pm" && otherH !== undefined) {
    // "11 to 1 pm" -> 11 am; "2 to 3 pm" -> 2 pm
    return h > otherH && h !== 12 ? h : h === 12 ? 12 : h + 12;
  }
  if (o === "am") return h === 12 ? 0 : h;
  // No marker anywhere: daytime visits are the common case.
  if (h >= 1 && h <= 7) return h + 12;
  return h === 12 ? 12 : h;
}

export function offlineDraft(utterance: string, ctx: DraftContext): RuleDraftRaw {
  const text = utterance.replace(/^\s*alexa[,!.]?\s*/i, "").trim();
  const lower = text.toLowerCase();
  const whoMatch = /\blet\s+(.+?)\s+(?:in|into|through|come in)\b/i.exec(text) ?? /^(.+?)\s+(?:and .+?\s+)?(?:is |are )?(?:arriving|coming|will come|visiting)\b/i.exec(text);
  const who = (whoMatch?.[1] ?? "the visitor").replace(/^(?:a|an)\s+/i, (s) => s).trim();
  const door = /parcel|package box|delivery box/.test(lower) ? "parcel_box" : "front";
  const allow_at_night = /\b(even at night|at night|overnight)\b/.test(lower);
  const purposeMatch = /\bfor\s+(.+?)(?:[.!?]|,|\s+(?:she|he|they)'?(?:ll| will)\b|$)/i.exec(text);
  const purpose = purposeMatch ? purposeMatch[1].trim() : null;
  const depends_on = UNSAFE.test(text) ? ["appearance_or_claim"] : ["pass_code"];

  const now = Date.parse(ctx.now_iso);
  const p = zonedParts(now, ctx.tz);
  let dayOffset = 0;
  if (/\btomorrow\b/.test(lower)) dayOffset = 1;
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const Y = base.getUTCFullYear();
  const M = base.getUTCMonth() + 1;
  const D = base.getUTCDate();

  let start: number | null = null;
  let end: number | null = null;
  const between = /\b(?:between|from)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:and|to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(text);
  const at = /\b(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(text);
  if (between) {
    const h2raw = Number(between[4]);
    const h1 = to24(Number(between[1]), between[3], between[6], true, h2raw);
    const h2 = to24(h2raw, between[6], between[3], false);
    start = zonedToUtcMs(Y, M, D, h1, Number(between[2] ?? 0), ctx.tz);
    end = zonedToUtcMs(Y, M, D, h2, Number(between[5] ?? 0), ctx.tz);
  } else if (at) {
    const h = to24(Number(at[1]), at[3], undefined, false);
    const t = zonedToUtcMs(Y, M, D, h, Number(at[2] ?? 0), ctx.tz);
    start = t - 15 * 60_000;
    end = t + 60 * 60_000;
  }
  const vague = /\b(sometime|some time|whenever|later|at some point)\b/.test(lower);
  const needs_clarification = vague || start === null ? "What time should I expect them, and until when?" : null;

  return DraftSchema.parse({
    who,
    door,
    not_before: start === null ? null : isoInTz(start, ctx.tz),
    not_after: end === null ? null : isoInTz(end, ctx.tz),
    max_uses: 1,
    allow_at_night,
    purpose,
    needs_clarification,
    depends_on,
  });
}

/** Offline vision reads a hand-written sidecar next to the snapshot (assets/<name>.offline.json). */
export function offlineVisitor(image: ImageInput): VisitorDescription {
  const candidates = image.name ? [path.join(REPO_ROOT, "assets", `${path.parse(image.name).name}.offline.json`)] : [];
  for (const c of candidates) {
    if (fs.existsSync(c)) return VisitorSchema.parse(JSON.parse(fs.readFileSync(c, "utf8")));
  }
  return {
    people_count: null,
    carrying: [],
    uniform_or_badge: { visible: false, text: null },
    visible_text: [],
    package_present: null,
    summary: "unclear (offline stand-in has no description for this snapshot)",
  };
}

export class OfflineProvider implements ModelProvider {
  info(): ModelInfo {
    return INFO;
  }
  async describeVisitor(image: ImageInput) {
    return { output: offlineVisitor(image), info: INFO, latency_ms: 0 };
  }
  async draftRule(utterance: string, ctx: DraftContext) {
    return { output: offlineDraft(utterance, ctx), info: INFO, latency_ms: 0 };
  }
}
