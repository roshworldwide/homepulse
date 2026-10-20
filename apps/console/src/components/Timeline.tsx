import { useState } from "react";
import { fmtTime, getJson, type AgentEvent, type EngramRecord, type State } from "../lib/api";
import { describe } from "./DecisionCard";
import { Panel } from "./Panels";

/** Engram timeline with an "as of" picker: rebuilds exactly what HomePulse knew at that time. */
export function Timeline({ state }: { state: State }) {
  const [asOf, setAsOf] = useState("");
  const [replay, setReplay] = useState<EngramRecord[] | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const live = all ? state.records : state.records.filter((r) => r.id >= state.scenario_marker);
  const records = (replay ?? live).slice(-60).reverse();

  const pick = async (v: string) => {
    setAsOf(v);
    if (!v) return setReplay(null);
    // The picker is in the browser's zone; the server compares instants.
    setReplay(await getJson<EngramRecord[]>(`/api/engram?as_of=${encodeURIComponent(new Date(v).toISOString())}`));
  };
  const check = async () => {
    const r = await getJson<{ ok: boolean; count: number; brokenAt?: number; why?: string }>("/api/engram/verify");
    setVerify(r.ok ? `Chain intact: ${r.count} records` : `Broken at record ${r.brokenAt}: ${r.why}`);
  };

  return (
    <Panel
      title="Engram timeline"
      badge={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="text-xs text-muted flex items-center gap-1">
            as of
            <input type="datetime-local" step={1} className="btn !py-1 !px-2 text-xs" value={asOf} onChange={(e) => pick(e.target.value)} />
          </label>
          <button className="btn !py-1 text-xs" onClick={() => setAll((a) => !a)} aria-pressed={all}>
            {all ? "This scenario" : "All records"}
          </button>
          <button className="btn !py-1 text-xs" onClick={check}>
            Verify chain
          </button>
        </div>
      }
    >
      {verify && <p className="text-sm mb-2 text-muted">{verify}</p>}
      {replay && <p className="text-sm mb-2 text-sky">Replaying {replay.length} records known by {new Date(asOf).toLocaleString()}.</p>}
      <ol className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
        {records.map((r) => (
          <li key={r.id} className="grid grid-cols-[40px_64px_minmax(0,1fr)] gap-2 text-sm items-baseline break-words">
            <span className="font-mono text-faint text-xs">#{r.id}</span>
            <span className="text-muted text-xs">{fmtTime(r.t_event, state.tz, true)}</span>
            <span>
              <span className="chip mr-1">{r.kind}</span>
              <span className={`chip mr-1 ${r.trust === "untrusted" ? "!text-amber !border-amber/50" : ""}`}>
                {r.source}
                {r.trust === "untrusted" ? " · untrusted" : ""}
              </span>
              {describe(r, state.tz)}
              {r.t_known !== r.t_event && Math.abs(Date.parse(r.t_known) - Date.parse(r.t_event)) > 60_000 && (
                <span className="text-xs text-faint"> (recorded {fmtTime(r.t_known, state.tz)})</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function AgentLog({ log, clear }: { log: AgentEvent[]; clear: () => void }) {
  const items = log.filter((e) => e.step && e.step.kind !== "user").slice(-24).reverse();
  return (
    <Panel
      title="Agents"
      badge={
        <button className="text-xs text-sky underline" onClick={clear}>
          clear
        </button>
      }
    >
      {items.length === 0 && <p className="text-sm text-muted">Tool calls from the HomePulse agent and the baseline show here.</p>}
      <ol className="space-y-1 max-h-[260px] overflow-y-auto text-sm">
        {items.map((e, i) => (
          <li key={i}>
            <span className={`chip mr-1 ${e.name === "naive" ? "" : "!text-teal !border-teal/50"}`}>{e.name === "naive" ? "baseline" : "HomePulse"}</span>
            {e.step!.kind === "tool_call" && (
              <span>
                calls <span className="font-mono">{e.step!.name}</span> <span className="text-faint font-mono text-xs break-all">{JSON.stringify(e.step!.input).slice(0, 90)}</span>
              </span>
            )}
            {e.step!.kind === "tool_result" && (
              <span>
                <span className="font-mono">{e.step!.name}</span> →{" "}
                {e.step!.result?.verdict ? <b className={e.step!.result.verdict === "ALLOWED" ? "text-teal" : "text-amber"}>{e.step!.result.verdict}</b> : <span className="text-muted">{e.step!.result?.trust ? "untrusted data" : "ok"}</span>}
              </span>
            )}
            {e.step!.kind === "reply" && <span className="text-muted">says “{e.step!.text}”</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
