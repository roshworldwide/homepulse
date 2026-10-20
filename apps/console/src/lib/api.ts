import { useEffect, useRef, useState } from "react";

export interface ModelInfo {
  provider: "bedrock" | "fixture" | "offline";
  model_id: string;
  label: string;
}

export interface ConsoleConfig {
  tz: string;
  demo_mode: boolean;
  model: ModelInfo;
  tokens: { homeowner: string; caregiver: string } | null;
}

export interface EngramRecord {
  id: number;
  kind: "input" | "tool_call" | "decision" | "effect" | "alert";
  source: string;
  trust: "trusted" | "untrusted";
  payload: Record<string, any>;
  t_event: string;
  t_known: string;
  hash: string;
  prev_hash: string;
}

export interface Lock {
  name: string;
  state: "locked" | "unlocked";
  simulated: true;
  last: { at: number; state: string; by: string } | null;
}

export interface State {
  now: number;
  tz: string;
  demo_mode: boolean;
  scenario: string | null;
  model: ModelInfo;
  home: { night_mode: boolean; night_mode_source: "clock" | "manual"; away_lockdown: boolean };
  devices: {
    front_door: Lock;
    parcel_box: Lock;
    baseline_door: Lock;
    tv_cards: Array<{ id: number; at: number; tone: "neutral" | "ok" | "alert" | "approval"; title: string; body: string }>;
    alerts: Array<{ id: number; at: number; to: string; title: string; body: string }>;
    spoken: Array<{ id: number; at: number; where: string; text: string }>;
    sms: Array<{ id: number; at: number; to: string; body: string }>;
  };
  passes: Array<{ who: string; door: string; purpose: string | null; window: string; allow_at_night: boolean; issued_by: string; status: string }>;
  approvers: string[];
  pending_approvals: Array<{ ref: string; kind: string; message: string; since: number }>;
  drafts: Array<{ draft_id: string; read_back: string; submitted_by: string }>;
  scenario_marker: number;
  records: EngramRecord[];
}

export interface AgentEvent {
  name: "homepulse" | "naive";
  step?: { kind: string; text?: string; name?: string; input?: unknown; result?: any; at: number };
  reply?: string;
  door_opened?: boolean;
  event?: string;
}

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function postJson<T = any>(path: string, body: unknown = {}, token?: string): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `${path}: ${r.status}`);
  return data as T;
}

/** Live state: one snapshot over SSE, then a refetch (throttled) whenever the server publishes anything. */
export function useLive() {
  const [state, setState] = useState<State | null>(null);
  const [agentLog, setAgentLog] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const es = new EventSource("/events");
    const refresh = () => {
      if (timer.current) return;
      timer.current = window.setTimeout(async () => {
        timer.current = null;
        try {
          setState(await getJson<State>("/api/state"));
        } catch {
          /* server restarting */
        }
      }, 120);
    };
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("snapshot", (e) => setState(JSON.parse((e as MessageEvent).data)));
    for (const t of ["record", "devices", "decision", "approval"]) es.addEventListener(t, refresh);
    es.addEventListener("demo", (e) => {
      const d = JSON.parse((e as MessageEvent).data).demo as { event: string; text?: string };
      if (d.event === "reset") {
        setCaptions([]);
        setAgentLog([]);
      }
      if (d.event === "caption" && d.text) setCaptions((c) => [...c.slice(-6), d.text!]);
      refresh();
    });
    es.addEventListener("agent", (e) => {
      const ev = JSON.parse((e as MessageEvent).data).agent as AgentEvent;
      setAgentLog((log) => [...log.slice(-80), ev]);
      refresh();
    });
    return () => es.close();
  }, []);

  return { state, agentLog, captions, connected, clearAgentLog: () => setAgentLog([]) };
}

export function fmtTime(ms: number | string, tz: string, seconds = false): string {
  const d = typeof ms === "string" ? new Date(ms) : new Date(ms);
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }).format(d);
}

/** The local clock, ticking from the server's (possibly scenario) time. */
export function useServerClock(serverNow: number | undefined) {
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (serverNow !== undefined) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Date.now() + offset;
}
