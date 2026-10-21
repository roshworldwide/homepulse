import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fmtTime, getJson, type EngramRecord, type State } from "../lib/api";
import { Banner, Button, Card, CardHeader, Icon, Segmented, Tag, stagger, type Tone } from "../ui/kit";
import { describe } from "./Decision";

const KIND_TONE: Record<string, Tone> = { decision: "tint", alert: "caution" };
const COLS = "md:grid-cols-[44px_92px_100px_minmax(0,160px)_minmax(0,1fr)]";

/**
 * Engram timeline, drawn as a data table: sticky header, hairlines, tabular times.
 * Time travel replays the log as known at each moment; "As of" picks any instant.
 */
export function Timeline({ state }: { state: State }) {
  const [asOf, setAsOf] = useState("");
  const [replay, setReplay] = useState<EngramRecord[] | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; text: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [scope, setScope] = useState<"scenario" | "all">("scenario");
  const live = scope === "all" ? state.records : state.records.filter((r) => r.id >= state.scenario_marker);
  const records = (replay ?? live).slice(-60).reverse();

  // Rows that arrive while the page is open get a short highlight.
  const newest = useRef(0);
  const seen = newest.current;
  useEffect(() => {
    for (const r of state.records) newest.current = Math.max(newest.current, r.id);
  });

  const pick = async (v: string) => {
    setAsOf(v);
    setPos(null);
    if (!v) return setReplay(null);
    // The picker is in the browser's zone; the server compares instants.
    setReplay(await getJson<EngramRecord[]>(`/api/engram?as_of=${encodeURIComponent(new Date(v).toISOString())}`));
  };

  // Time travel: one stop per moment something became known; the far right is live.
  const marks = useMemo(() => [...new Set(live.map((r) => r.t_known))].sort(), [live]);
  const [pos, setPos] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const scrub = (i: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (i >= marks.length - 1) {
      setPos(null);
      setAsOf("");
      setReplay(null);
      return;
    }
    setPos(i);
    const t = marks[i];
    // Replay from the server's log, not the page's copy: the same query the Why? panel uses.
    timer.current = setTimeout(() => {
      void getJson<EngramRecord[]>(`/api/engram?as_of=${encodeURIComponent(t)}`).then((r) => {
        setAsOf(t);
        setReplay(r);
      });
    }, 120);
  };
  const check = async () => {
    setVerifying(true);
    try {
      const r = await getJson<{ ok: boolean; count: number; brokenAt?: number; why?: string }>("/api/engram/verify");
      setVerify({ ok: r.ok, text: r.ok ? `Chain intact: ${r.count} records, each hash linked to the one before.` : `Broken at record ${r.brokenAt}: ${r.why}` });
    } catch (e) {
      setVerify({ ok: false, text: `Could not check the chain: ${(e as Error).message}` });
    } finally {
      setVerifying(false);
    }
  };
  const at = pos === null ? marks.length - 1 : pos;
  const pct = marks.length > 1 ? (at / (marks.length - 1)) * 100 : 100;
  // Only a value the picker produced goes back into it (scrubber instants are ISO with a Z).
  const pickerValue = asOf && !asOf.endsWith("Z") ? asOf : "";

  return (
    <Card aria-label="Engram timeline">
      <CardHeader title="Engram timeline" caption="Hash-chained log of every input, decision and effect">
        <Button size="small" icon="verified" onClick={check} loading={verifying}>
          Verify chain
        </Button>
      </CardHeader>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          label="Which records"
          value={scope}
          onChange={setScope}
          options={[
            { value: "scenario", label: "This scenario" },
            { value: "all", label: "All records" },
          ]}
        />
        <label className="flex items-center gap-2 text-footnote text-label-2">
          As of
          <input type="datetime-local" step={1} className="field field-sm tabular !w-auto" value={pickerValue} onChange={(e) => pick(e.target.value)} />
        </label>
      </div>

      {marks.length > 1 && (
        <div className="well mt-4 px-3.5 pb-1.5 pt-2.5">
          <div className="flex items-center gap-3">
            <label htmlFor="scrub" className="flex flex-none items-center gap-1.5 text-footnote font-medium text-label-2">
              <Icon name="history" size={18} /> <span className="hidden sm:inline">Time travel</span>
            </label>
            <input
              id="scrub"
              type="range"
              className="slider min-w-0 flex-1"
              min={0}
              max={marks.length - 1}
              step={1}
              value={at}
              style={{ "--pct": `${pct}%` } as CSSProperties}
              onChange={(e) => scrub(Number(e.target.value))}
              aria-label="Time travel"
              aria-valuetext={pos === null ? "Live" : `As known at ${fmtTime(marks[pos], state.tz, true)}`}
            />
            <span className={`tabular w-[84px] flex-none text-right font-mono text-[13px] font-medium ${pos === null ? "text-positive" : "text-tint"}`}>{pos === null ? "Live" : fmtTime(marks[pos], state.tz, true)}</span>
          </div>
          <p className="mt-0.5 text-caption text-label-3">
            {marks.length} moments. Drag left to see the log exactly as HomePulse knew it then.
          </p>
        </div>
      )}

      {verify && (
        <Banner tone={verify.ok ? "positive" : "alarm"} icon={verify.ok ? "verified" : "error"} className="enter mt-3" role="status">
          {verify.text}
        </Banner>
      )}
      {replay && (
        <Banner tone="info" icon="history" className="enter mt-3">
          Replaying {replay.length} records known by <span className="tabular">{fmtTime(asOf, state.tz, true)}</span>: exactly what HomePulse knew then.
        </Banner>
      )}

      <div className="mt-4 max-h-[460px] overflow-y-auto rounded-12 shadow-[inset_0_0_0_1px_var(--separator)]">
        <div className={`sticky top-0 z-[1] hidden gap-3 border-b border-sep bg-card px-3.5 py-2 text-caption font-semibold text-label-2 md:grid ${COLS}`} aria-hidden>
          <span>#</span>
          <span>Time</span>
          <span>Kind</span>
          <span>Source</span>
          <span>What happened</span>
        </div>
        <ol aria-label="Engram records">
          {records.length === 0 && <li className="px-3.5 py-6 text-center text-footnote text-label-2">Nothing recorded yet.</li>}
          {records.map((r, i) => (
            <li
              key={r.id}
              className={`grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 border-b border-sep px-3.5 py-2.5 text-body-s last:border-b-0 ${COLS} ${seen > 0 && r.id > seen && !replay ? "enter bg-tint-soft" : ""}`}
              style={stagger(i)}
            >
              <span className="tabular font-mono text-caption text-label-3">#{r.id}</span>
              <span className="tabular text-footnote text-label-2">{fmtTime(r.t_event, state.tz, true)}</span>
              <span className="justify-self-end md:justify-self-start">
                <Tag tone={KIND_TONE[r.kind] ?? "neutral"}>{r.kind.replace("_", " ")}</Tag>
              </span>
              <span className="col-span-3 min-w-0 md:col-span-1">
                {r.trust === "untrusted" ? (
                  <Tag tone="caution" icon="warning" className="max-w-full">
                    <span className="truncate">{r.source} · untrusted</span>
                  </Tag>
                ) : (
                  <Tag className="max-w-full">
                    <span className="truncate">{r.source}</span>
                  </Tag>
                )}
              </span>
              <span className="col-span-3 min-w-0 break-words md:col-span-1">
                {describe(r, state.tz)}
                {r.t_known !== r.t_event && Math.abs(Date.parse(r.t_known) - Date.parse(r.t_event)) > 60_000 && (
                  <span className="text-caption text-label-3"> (recorded {fmtTime(r.t_known, state.tz)})</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
