import { useEffect, useMemo, useState } from "react";
import { decide } from "mcp-streamable-guard/policy";
import { GUARD_INPUT_LABELS, GUARD_KEYS, type GuardInputs, type GuardKey } from "mcp-streamable-guard/inputs";
import { fmtTime, getJson, type EngramRecord, type State } from "../lib/api";

export function latestDecision(state: State): EngramRecord | undefined {
  return [...state.records].reverse().find((r) => r.kind === "decision" && r.id >= state.scenario_marker);
}

function Verdict({ allow, big = true }: { allow: boolean; big?: boolean }) {
  return (
    <span
      className={`font-black tracking-wide ${big ? "text-4xl" : "text-sm"} ${allow ? "text-teal" : "text-amber"}`}
      aria-label={allow ? "Allowed" : "Blocked"}
    >
      {allow ? "ALLOWED" : "BLOCKED"}
    </span>
  );
}

/** The only coloured panel. Verdicts always carry words, so colour is never the only signal. */
export function DecisionCard({ state }: { state: State }) {
  const rec = latestDecision(state);
  const [why, setWhy] = useState(false);
  useEffect(() => setWhy(false), [rec?.id]);
  const pending = state.pending_approvals.find((p) => p.kind === "unlock");

  if (!rec) {
    return (
      <section className="panel p-5 min-h-[220px]">
        <div className="label">Decision</div>
        <p className="mt-6 text-muted">No door requests yet. Every unlock attempt shows up here with its verdict and reasons.</p>
        {pending && <PendingNote />}
      </section>
    );
  }
  const d = rec.payload;
  const allow = d.allow === true;
  return (
    <section
      className="rounded-[14px] p-5 border-2"
      style={{
        background: allow ? "color-mix(in srgb, #45c4b0 10%, #121826)" : "color-mix(in srgb, #f5b83d 9%, #121826)",
        borderColor: allow ? "#45c4b0" : "#f5b83d",
      }}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label">Decision · {d.tool === "open_parcel_box" ? "parcel box" : "front door"}</div>
          <div className="mt-1">
            <Verdict allow={allow} />
          </div>
          <div className="text-sm text-muted mt-1">
            {allow ? (d.path === "pass" ? "Signed one-time pass and matching code" : "Fresh approval tapped in the app") : "The door stayed locked"} ·{" "}
            {fmtTime(rec.t_known, state.tz, true)}
          </div>
        </div>
        <div className="text-right text-xs text-faint font-mono">
          <div>{d.decision_id}</div>
          <div>guard {Number(d.latency_ms).toFixed(2)} ms</div>
          <div>request via {d.args?.channel ?? "?"}</div>
        </div>
      </div>

      {!allow && d.reasons?.length > 0 && (
        <ul className="mt-4 space-y-1">
          {d.reasons.map((r: string) => (
            <li key={r} className="text-lg leading-snug">
              <span className="text-amber mr-2" aria-hidden>
                ■
              </span>
              {r[0].toUpperCase() + r.slice(1)}
            </li>
          ))}
        </ul>
      )}

      {d.echoed_outside_text && (
        <div className="mt-4 rounded-lg border border-amber/60 bg-bg/60 p-3">
          <div className="font-bold text-amber">This request repeats text from the camera.</div>
          <div className="mt-1 text-sm text-muted">
            Outside text (data, never a reason): <span className="text-ink">“{d.echoed_outside_text}”</span>
          </div>
        </div>
      )}

      {d.notes?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.notes.map((n: string) => (
            <span key={n} className="chip !whitespace-normal max-w-full break-words">
              {n}
            </span>
          ))}
        </div>
      )}

      {pending && <PendingNote />}

      <div className="mt-4 flex gap-2">
        <button className="btn" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
          {why ? "Hide why" : "Why?"}
        </button>
      </div>
      {why && <WhyPanel rec={rec} tz={state.tz} />}
    </section>
  );
}

function PendingNote() {
  return <div className="mt-4 rounded-lg bg-bg/60 border border-line p-3 text-sm">Waiting for the family to approve or deny on their phone…</div>;
}

/** Replays Engram as of the decision, and lets anyone flip the 14 inputs to see the verdict change. */
function WhyPanel({ rec, tz }: { rec: EngramRecord; tz: string }) {
  const [known, setKnown] = useState<EngramRecord[] | null>(null);
  const original = rec.payload.inputs as GuardInputs;
  const [inputs, setInputs] = useState<GuardInputs>(original);
  useEffect(() => {
    setInputs(original);
    getJson<EngramRecord[]>(`/api/engram?as_of=${encodeURIComponent(rec.t_known)}`).then(setKnown).catch(() => setKnown([]));
  }, [rec.id]);

  const relied = useMemo(() => {
    if (!known) return [];
    const t = Date.parse(rec.t_known);
    return known.filter(
      (r) =>
        (r.payload.type === "pass_issued" && (!rec.payload.pass_id || r.payload.pass_id === rec.payload.pass_id)) ||
        (r.payload.type === "approval" && r.payload.decision_id === rec.payload.decision_id) ||
        (r.payload.type === "ring_event" && t - Date.parse(r.t_event) <= 120_000) ||
        (r.payload.type === "night_mode_set") ||
        (r.payload.type === "lockdown"),
    );
  }, [known, rec]);

  const result = decide(inputs);
  const changed = GUARD_KEYS.some((k) => inputs[k] !== original[k]);

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg bg-bg/60 border border-line p-3">
        <div className="label">What HomePulse knew at {fmtTime(rec.t_known, tz, true)}</div>
        {!known && <p className="text-sm text-muted mt-2">Replaying the log…</p>}
        {known && relied.length === 0 && <p className="text-sm text-muted mt-2">No pass, approval or recent doorbell event on record.</p>}
        <ul className="mt-2 space-y-1 text-sm">
          {relied.map((r) => (
            <li key={r.id}>
              <span className="text-faint font-mono mr-2">#{r.id}</span>
              {describe(r, tz)}
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint mt-3">Rebuilt from Engram records with t_known ≤ the decision time ({known?.length ?? "…"} records).</p>
      </div>
      <div className="rounded-lg bg-bg/60 border border-line p-3">
        <div className="flex items-center justify-between">
          <div className="label">What if? (same guard code, in your browser)</div>
          {changed && (
            <button className="text-xs text-sky underline" onClick={() => setInputs(original)}>
              Reset
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1">
          {GUARD_KEYS.map((k: GuardKey) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={inputs[k]} onChange={(e) => setInputs({ ...inputs, [k]: e.target.checked })} className="accent-[#45c4b0]" />
              <span className={inputs[k] !== original[k] ? "text-sky" : ""}>{GUARD_INPUT_LABELS[k]}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Verdict allow={result.allow} big={false} />
          <span className="text-sm text-muted">{result.allow ? `via ${result.path === "pass" ? "pass" : "owner approval"}` : result.reasons.map((r) => r.message).join("; ")}</span>
        </div>
      </div>
    </div>
  );
}

export function describe(r: EngramRecord, tz: string): string {
  const p = r.payload;
  const t = fmtTime(r.t_event, tz);
  switch (p.type) {
    case "pass_issued":
      return `Pass for ${p.who} (${p.door === "front" ? "front door" : "parcel box"}), signed after a tap by the ${p.issued_by}`;
    case "approval":
      return `${p.approved ? "Approved" : "Denied"} on the ${r.source}'s phone at ${fmtTime(r.t_known, tz, true)}`;
    case "ring_event":
      return `Ring ${p.event?.type?.replace("_", " ")}${p.event?.sub_type ? ` (${p.event.sub_type})` : ""} at ${t}${p.simulated ? " · simulated" : ""}`;
    case "visitor_description":
      return `Visitor description (${p.model?.label ?? "model"}): ${p.output?.summary ?? ""}`;
    case "rule_utterance":
      return `Rule request from the ${r.source}: “${p.utterance}”`;
    case "voice":
      return `Heard by Alexa: “${p.text}”`;
    case "approval_unanswered":
      return `No one answered on a phone (${p.why ?? "no answer"}), so the door stayed locked`;
    case "hall_sensor":
      return `Hall sensor (inside, simulated): someone at the front door from inside`;
    case "code_sent":
      return `Code sent to ${p.to} (simulated text message)`;
    case "notify":
      return `Notified ${(p.channels ?? []).join(", ")}: “${p.message}”`;
    case "pass_revoked":
      return `Pass for ${p.who} revoked (${p.why})`;
    case "rule_confirmation":
      return `Rule ${p.confirmed ? "confirmed" : "declined"} on the ${r.source}'s phone`;
    case "scenario_start":
      return `Scenario started: ${p.scenario}`;
    case "caregiver_note":
      return `Caregiver note (stands in for a Bee recording): “${p.text}”`;
    case "lockdown":
      return `Lockdown ${p.on ? "on" : "lifted"} (${r.source})`;
    case "night_mode_set":
      return `Night mode set by hand: ${p.value === null ? "follow the clock" : p.value ? "on" : "off"}`;
    default:
      if (r.kind === "decision") return `${p.verdict} ${p.tool} (${(p.reasons ?? []).join("; ") || p.path})`;
      if (r.kind === "tool_call") return `${p.tool} called by ${r.source}`;
      if (p.type === "door_unlocked") return `Door unlocked${p.who ? ` for ${p.who}` : ""} (relocks in 30 s)`;
      return p.type ?? r.kind;
  }
}
