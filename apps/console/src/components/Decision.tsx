import { useEffect, useState } from "react";
import { decide } from "mcp-streamable-guard/policy";
import { GUARD_INPUT_LABELS, GUARD_KEYS, type GuardInputs, type GuardKey } from "mcp-streamable-guard/inputs";
import { fmtTime, getJson, type EngramRecord, type State } from "../lib/api";
import { Banner, Button, Empty, Icon, Kbd, Seal, Spinner, Tag, stagger } from "../ui/kit";

export function latestDecision(state: State): EngramRecord | undefined {
  return [...state.records].reverse().find((r) => r.kind === "decision" && r.id >= state.scenario_marker);
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The hero card: the guard's latest verdict. Aura edge (the one per page), a seal and a
 * word for the verdict, reasons as sentences, and Why? to replay the log and flip inputs.
 */
export function DecisionCard({ state, onRunFirst }: { state: State; onRunFirst?: () => void }) {
  const rec = latestDecision(state);
  const [why, setWhy] = useState(false);
  useEffect(() => setWhy(false), [rec?.id]);
  const pending = state.pending_approvals.find((p) => p.kind === "unlock");

  if (!rec) {
    return (
      <div className="aura">
        <section className="card card-pad" aria-live="polite" aria-label="Decision">
          <div className="eyebrow">Front door · Decision</div>
          <Empty
            icon="shield_lock"
            title="No door requests yet"
            action={
              onRunFirst && (
                <Button variant="tinted" icon="play_arrow" onClick={onRunFirst}>
                  Run the nurse visit <Kbd>1</Kbd>
                </Button>
              )
            }
          >
            Every unlock attempt shows up here with its verdict and the reasons behind it.
          </Empty>
          {pending && <PendingNote />}
        </section>
      </div>
    );
  }

  const d = rec.payload;
  const allow = d.allow === true;
  const door = d.tool === "open_parcel_box" ? "Parcel box" : "Front door";
  return (
    <div className="aura">
      <section className="card card-pad" aria-live="polite" aria-labelledby="verdict">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="eyebrow">{door} · Decision</div>
          <div className="tabular font-mono text-caption text-label-2">
            {d.decision_id} · guard {Number(d.latency_ms).toFixed(2)} ms · via {d.args?.channel ?? "?"}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <Seal key={rec.id} className="pop" tone={allow ? "positive" : "caution"} icon={allow ? "lock_open" : "lock"} size={64} />
          <div className="min-w-0">
            <h2 id="verdict" className={`text-display ${allow ? "text-positive" : "text-caution"}`}>
              {allow ? "Allowed" : "Blocked"}
            </h2>
            <p className="mt-1 text-body-s text-label-2">
              {allow ? (d.path === "pass" ? "Signed one-time pass and a matching code" : "A fresh approval, tapped on a family phone") : "The door stayed locked"} ·{" "}
              <span className="tabular">{fmtTime(rec.t_known, state.tz, true)}</span>
            </p>
          </div>
        </div>

        {!allow && d.reasons?.length > 0 && (
          <ul className="mt-5 space-y-2" aria-label="Reasons">
            {d.reasons.map((r: string, i: number) => (
              <li key={r} className="enter flex items-start gap-2.5 text-[17px] leading-snug" style={stagger(i)}>
                <Icon name="do_not_disturb_on" size={20} fill className="mt-[2px] text-caution" />
                <span>{capital(r)}</span>
              </li>
            ))}
          </ul>
        )}

        {d.echoed_outside_text && (
          <Banner tone="caution" icon="campaign" className="mt-4" title="This request repeats text from the camera.">
            Outside text (data, never a reason): <span className="font-medium text-label-1">“{d.echoed_outside_text}”</span>
          </Banner>
        )}

        {d.notes?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {d.notes.map((n: string) => (
              <Tag key={n} icon="info" className="tag-wrap">
                {n}
              </Tag>
            ))}
          </div>
        )}

        {pending && <PendingNote />}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="gray" icon={why ? "expand_more" : "help"} onClick={() => setWhy((w) => !w)} aria-expanded={why} aria-controls="why-panel">
            {why ? "Hide why" : "Why?"}
          </Button>
          {!why && <span className="text-footnote text-label-2">Replay what HomePulse knew, then flip any of the 14 inputs.</span>}
        </div>
        {why && <WhyPanel rec={rec} tz={state.tz} />}
      </section>
    </div>
  );
}

function PendingNote() {
  return (
    <Banner tone="info" busy className="mt-4">
      Waiting for the family to approve or deny on their phone…
    </Banner>
  );
}

/** Replays Engram as of the decision, and lets anyone flip the 14 inputs to see the verdict change. */
function WhyPanel({ rec, tz }: { rec: EngramRecord; tz: string }) {
  const [relied, setRelied] = useState<EngramRecord[] | null>(null);
  const [knownCount, setKnownCount] = useState<number | null>(null);
  const original = rec.payload.inputs as GuardInputs;
  const [inputs, setInputs] = useState<GuardInputs>(original);
  useEffect(() => {
    setInputs(original);
    getJson<{ relied_on: EngramRecord[]; known_records: number }>(`/api/why/${encodeURIComponent(rec.payload.decision_id)}`)
      .then((w) => {
        setRelied(w.relied_on);
        setKnownCount(w.known_records);
      })
      .catch(() => setRelied([]));
  }, [rec.id]);

  const result = decide(inputs);
  const changed = GUARD_KEYS.filter((k) => inputs[k] !== original[k]).length;

  return (
    <div id="why-panel" className="enter mt-5 grid gap-3 md:grid-cols-2">
      <div className="well p-4">
        <h3 className="text-[15px] font-semibold">What HomePulse knew</h3>
        <p className="text-caption text-label-2">
          At <span className="tabular">{fmtTime(rec.t_known, tz, true)}</span>, rebuilt from the log
        </p>
        {!relied && (
          <p className="mt-3 flex items-center gap-2 text-footnote text-label-2">
            <Spinner /> Replaying the log…
          </p>
        )}
        {relied && relied.length === 0 && <p className="mt-3 text-footnote text-label-2">No pass, approval or recent doorbell event on record.</p>}
        <ol className="mt-3 space-y-2">
          {(relied ?? []).map((r, i) => (
            <li key={r.id} className="enter flex items-baseline gap-2 text-body-s" style={stagger(i)}>
              <span className="tabular flex-none font-mono text-caption text-label-2">#{r.id}</span>
              <span>{describe(r, tz)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-caption text-label-2">Records with t_known at or before the decision (up to #{knownCount ?? "…"}).</p>
      </div>

      <div className="well p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold">What if?</h3>
            <p className="text-caption text-label-2">The same guard code, running in your browser</p>
          </div>
          {changed > 0 && (
            <Button variant="plain" size="small" icon="undo" onClick={() => setInputs(original)}>
              Reset
            </Button>
          )}
        </div>
        <div className="mt-2 divide-y divide-sep">
          {GUARD_KEYS.map((k: GuardKey) => {
            const flipped = inputs[k] !== original[k];
            return (
              <label key={k} className="flex cursor-pointer items-center justify-between gap-3 py-[7px]">
                <span className={`text-body-s ${flipped ? "font-medium text-tint" : "text-label-1"}`}>
                  {GUARD_INPUT_LABELS[k]}
                  {flipped && <span className="sr-only"> (changed)</span>}
                </span>
                <input type="checkbox" role="switch" className="switch" checked={inputs[k]} onChange={(e) => setInputs({ ...inputs, [k]: e.target.checked })} />
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sep pt-3" aria-live="polite">
          <Tag tone={result.allow ? "positive" : "caution"} icon={result.allow ? "lock_open" : "lock"}>
            {result.allow ? "Allowed" : "Blocked"}
          </Tag>
          <span className="min-w-0 flex-1 text-footnote text-label-2">
            {result.allow ? `via ${result.path === "pass" ? "the pass" : "owner approval"}` : result.reasons.map((r) => r.message).join("; ")}
            {changed > 0 && ` · ${changed} input${changed > 1 ? "s" : ""} changed`}
          </span>
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
