import { useEffect, useRef, useState } from "react";
import { getJson, postJson, useLive, type ConsoleConfig } from "../lib/api";
import { usePhone } from "../lib/phone";
import { DecisionCard } from "../components/Decision";
import { Keypad, RingFeed } from "../components/Door";
import { HouseCard } from "../components/House";
import { AgentLog, Narration } from "../components/Log";
import { BaselineCard, TvCard } from "../components/Outcomes";
import { CaregiverNote, PhonePanel } from "../components/Phone";
import { Timeline } from "../components/Timeline";
import { AppShell } from "../ui/Shell";
import { Icon, Kbd, Spinner } from "../ui/kit";
import { toast } from "../ui/toast";

export function useConfig() {
  const [cfg, setCfg] = useState<ConsoleConfig | null>(null);
  useEffect(() => {
    getJson<ConsoleConfig>("/api/console-config").then(setCfg).catch(() => setCfg(null));
  }, []);
  return cfg;
}

export const SCENARIOS = [
  ["nurse", "Nurse visit"],
  ["paramedic", "Shouted paramedic"],
  ["sign", "Sign at the camera"],
  ["night", "Night check-in"],
] as const;

/** Sidebar section: the four scenarios (keys 1–4) and the two simulated controls. */
function ScenarioNav({ current, running, run, onHall, onReset }: { current: string | null; running: string | null; run: (id: string) => void; onHall: () => void; onReset: () => void }) {
  return (
    <>
      <div className="nav-head flex items-center justify-between">
        <span>Scenarios</span>
        <span className="font-medium text-label-3">Keys 1–4</span>
      </div>
      {SCENARIOS.map(([id, label], i) => (
        <button key={id} type="button" className="nav-row" data-selected={current === id} aria-keyshortcuts={String(i + 1)} onClick={() => run(id)}>
          <Kbd>{i + 1}</Kbd>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {running === id ? <Spinner className="text-tint" /> : current === id ? <span className="h-1.5 w-1.5 rounded-full bg-tint" aria-label="Last run" /> : null}
        </button>
      ))}
      <div className="nav-head">Simulate</div>
      <button type="button" className="nav-row" onClick={onHall}>
        <Icon name="sensors" />
        Hall sensor (inside)
      </button>
      <button type="button" className="nav-row" onClick={onReset}>
        <Icon name="restart_alt" />
        Reset house
      </button>
    </>
  );
}

export function ConsolePage() {
  const { state, agentLog, captions, connected, clearAgentLog } = useLive();
  const cfg = useConfig();
  const caregiver = usePhone("caregiver", cfg?.tokens?.caregiver);
  const [running, setRunning] = useState<string | null>(null);

  const run = async (scenario: string) => {
    const label = SCENARIOS.find(([id]) => id === scenario)?.[1] ?? scenario;
    setRunning(scenario);
    clearAgentLog();
    toast(`Running: ${label}`, { key: "run", tone: "tint", icon: "play_arrow" });
    try {
      await postJson("/demo/run", { scenario });
    } catch (e) {
      toast(String((e as Error).message), { key: "run", tone: "alarm", icon: "error" });
    } finally {
      setRunning((r) => (r === scenario ? null : r));
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) void runRef.current(SCENARIOS[i][0]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hall = () => postJson("/agent/hall-sensor").then(() => toast("Hall sensor: someone at the door from inside", { icon: "sensors" })).catch((e) => toast(String(e.message), { tone: "alarm", icon: "error" }));
  const reset = () => postJson("/demo/reset").then(() => toast("House reset", { tone: "positive", icon: "restart_alt" })).catch((e) => toast(String(e.message), { tone: "alarm", icon: "error" }));

  return (
    <AppShell
      page="console"
      title="Console"
      subtitle="Every unlock goes through the guard: 14 inputs, one verdict, a signed log"
      state={state}
      connected={connected}
      nav={<ScenarioNav current={state?.scenario ?? null} running={running} run={(id) => void run(id)} onHall={hall} onReset={reset} />}
    >
      {!state ? (
        <div className="flex items-center gap-3 p-6 text-label-2">
          <Spinner /> Connecting to the HomePulse server…
        </div>
      ) : (
        <div className="console-grid">
          <div className="area-decision">
            <DecisionCard state={state} onRunFirst={() => void run("nurse")} />
          </div>
          <aside className="area-inspector space-y-4" aria-label="House and family phone">
            <HouseCard state={state} />
            <PhonePanel person="Priya" roleLabel="Caregiver · phone" role="caregiver" asks={caregiver.asks} status={caregiver.status} state={state} token={cfg?.tokens?.caregiver}>
              <CaregiverNote token={cfg?.tokens?.caregiver} />
            </PhonePanel>
            <Narration captions={captions} />
          </aside>
          <div className="area-door grid gap-4 md:grid-cols-2">
            <RingFeed state={state} onAsk={() => postJson("/agent/door-event").catch(() => {})} />
            <Keypad state={state} />
          </div>
          <div className="area-outcome grid gap-4 md:grid-cols-2">
            <BaselineCard state={state} log={agentLog} />
            <TvCard state={state} />
          </div>
          <div className="area-timeline">
            <Timeline state={state} />
          </div>
          <div className="area-agents">
            <AgentLog log={agentLog} clear={clearAgentLog} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
