import { useState, type ReactNode } from "react";
import { fmtTime, postJson, type AgentEvent, type State } from "../lib/api";
import type { Ask } from "../lib/phone";

export function Panel({ title, badge, children, className = "" }: { title: string; badge?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export const Sim = ({ text = "Simulated" }: { text?: string }) => <span className="chip">{text}</span>;

const SNAPSHOTS = [
  ["nurse.jpg", "Nurse"],
  ["paramedic.jpg", "Paramedic"],
  ["sign-attack.jpg", "Sign"],
  ["night.jpg", "Night"],
] as const;

/** What the door saw: the latest Ring event, its snapshot and the (untrusted) visitor description. */
export function RingFeed({ state, onAsk }: { state: State; onAsk: () => void }) {
  const ev = [...state.records].reverse().find((r) => r.payload.type === "ring_event");
  const desc = ev && [...state.records].reverse().find((r) => r.payload.type === "visitor_description" && r.payload.event_id === ev.payload.event.event_id);
  const [snap, setSnap] = useState<string>("sign-attack.jpg");
  const [busy, setBusy] = useState(false);
  const ring = async () => {
    setBusy(true);
    try {
      await postJson("/api/inject", { type: "button_press", snapshot: snap });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Ring · front door" badge={ev?.payload.simulated ? <Sim text="Simulated event" /> : ev ? <span className="chip">Ring API</span> : null}>
      {ev ? (
        <>
          <div className="relative overflow-hidden rounded-lg border border-line bg-bg aspect-[4/3]">
            <img key={ev.id} src={`/api/snapshot/${encodeURIComponent(ev.payload.event.event_id)}`} alt="Doorbell snapshot" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          </div>
          <div className="mt-2 text-sm">
            <span className="font-semibold">{ev.payload.event.type === "button_press" ? "Doorbell pressed" : `Motion: ${ev.payload.event.sub_type ?? "unknown"}`}</span>
            <span className="text-muted"> · {fmtTime(ev.t_event, state.tz)}</span>
          </div>
          {desc && (
            <div className="mt-2 rounded-lg border border-line bg-bg/50 p-2 text-sm">
              <div className="flex flex-wrap gap-1 mb-1">
                <span className="chip">source: ring</span>
                <span className="chip">untrusted</span>
                <span className="chip">{desc.payload.model?.label}</span>
              </div>
              <div>{desc.payload.output?.summary}</div>
              {desc.payload.output?.visible_text?.length > 0 && (
                <div className="mt-1 text-muted">
                  Visible text, as data:{" "}
                  {desc.payload.output.visible_text.map((t: string) => (
                    <q key={t} className="text-ink">
                      {t}
                    </q>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">No one has come to the door yet.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="btn" value={snap} onChange={(e) => setSnap(e.target.value)} aria-label="Snapshot for the simulated doorbell">
          {SNAPSHOTS.map(([f, l]) => (
            <option key={f} value={f}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn" onClick={ring} disabled={busy}>
          Ring the bell
        </button>
        <button className="btn" onClick={onAsk} disabled={!ev}>
          Agents: check the door
        </button>
      </div>
    </Panel>
  );
}

/** Fire TV-style card: at least 24 px text so it reads on a television. */
export function TvCard({ state }: { state: State }) {
  const card = state.devices.tv_cards.at(-1);
  const expected = state.passes.filter((p) => p.status === "active");
  const tone = card?.tone ?? "neutral";
  const border = state.home.away_lockdown || tone === "alert" || tone === "approval" ? "#f5b83d" : tone === "ok" ? "#45c4b0" : "#26324a";
  return (
    <Panel title="Living room TV" badge={<Sim text="Fire TV-style card" />}>
      <div className="rounded-xl bg-black p-5 border-2 min-h-[150px]" style={{ borderColor: border }}>
        {state.home.away_lockdown && <div className="text-[24px] font-black text-amber">LOCKDOWN ON</div>}
        {card ? (
          <>
            <div className="text-[28px] font-bold leading-tight">{card.title}</div>
            {card.body && <div className="text-[24px] text-muted leading-snug mt-1">{card.body}</div>}
            <div className="text-[16px] text-faint mt-2">{fmtTime(card.at, state.tz)}</div>
          </>
        ) : (
          <div className="text-[24px] text-muted">Nothing to show.</div>
        )}
      </div>
      {expected.length > 0 && (
        <div className="mt-2 text-[18px] text-muted">
          Expected: {expected.map((p) => `${p.who}, ${p.window}`).join(" · ")}
        </div>
      )}
    </Panel>
  );
}

/** A phone: real MCP session (homeowner or caregiver) answering elicitation requests. */
export function PhonePanel({ title, role, asks, status, state, token, children }: { title: string; role: "homeowner" | "caregiver"; asks: Ask[]; status: string; state: State; token?: string; children?: ReactNode }) {
  const alerts = state.devices.alerts.filter((a) => a.to === role).slice(-4).reverse();
  return (
    <Panel title={title} badge={<span className="chip">{status === "connected" ? "MCP session · elicitation" : status}</span>}>
      <div className="space-y-2">
        {asks.map((a) => (
          <AskCard key={a.id} ask={a} />
        ))}
        {asks.length === 0 && alerts.length === 0 && <p className="text-sm text-muted">No requests.</p>}
        {alerts.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-bg/50 p-2 text-sm">
            <div className="font-semibold">{a.title}</div>
            {a.body && <div className="text-muted">{a.body}</div>}
            <div className="text-xs text-faint">{fmtTime(a.at, state.tz)}</div>
          </div>
        ))}
      </div>
      {children}
      {!token && <p className="mt-2 text-xs text-faint">Tokens are not exposed to this browser (set CONSOLE_EXPOSE_TOKENS=true for the local demo).</p>}
    </Panel>
  );
}

function AskCard({ ask }: { ask: Ask }) {
  const code = /One-time code for .*?: (\d{6})/.exec(ask.message)?.[1];
  const [yes, no] = ask.field === "approve" ? ["Approve", "Deny"] : ask.field === "confirm" ? ["Confirm", "Decline"] : ["Send to visitor", "Not now"];
  return (
    <div className="rounded-lg border-2 border-sky/70 bg-bg/70 p-3">
      {code ? (
        <>
          <div className="text-sm text-muted">{ask.message.replace(code, "••••••")}</div>
          <div className="mt-2 font-mono text-3xl tracking-[0.3em] text-ink" aria-label={`Code ${code.split("").join(" ")}`}>
            {code}
          </div>
          <div className="text-xs text-faint">Shown once. HomePulse keeps only a hash.</div>
        </>
      ) : (
        <div className="text-[15px] leading-snug">{ask.message}</div>
      )}
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary" onClick={() => ask.answer(true)}>
          {yes}
        </button>
        <button className="btn btn-warn" onClick={() => ask.answer(false)}>
          {no}
        </button>
      </div>
    </div>
  );
}

export function CaregiverNote({ token }: { token?: string }) {
  const [text, setText] = useState("Nurse Sarah and cold-chain insulin arriving at 2 PM");
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    setMsg(null);
    try {
      const r = await postJson("/api/caregiver/note", { text }, token);
      setMsg(r.status === "draft" ? `Drafted: ${r.read_back} Confirm on this phone.` : r.status === "refused" ? `${r.why} ${r.offer ?? ""}` : r.question ?? r.why);
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="label mb-1">Note (stands in for a Bee recording)</div>
      <textarea className="w-full rounded-lg bg-bg border border-line p-2 text-sm" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn mt-2" onClick={send} disabled={!token}>
        Save note
      </button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

/** The simulated keypad at the door: anyone can type; the guard decides. */
export function Keypad({ state }: { state: State }) {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<{ verdict: string; reasons: string[] } | null>(null);
  const lastSms = state.devices.sms.at(-1);
  const smsCode = lastSms ? /(\d{6})/.exec(lastSms.body)?.[1] : undefined;
  const press = async () => {
    try {
      setRes(await postJson("/api/keypad", { code }));
    } catch (e) {
      setRes({ verdict: "ERROR", reasons: [String((e as Error).message)] });
    }
    setCode("");
  };
  return (
    <Panel title="Keypad at the door" badge={<Sim />}>
      <div className="flex gap-2">
        <input
          className="w-36 rounded-lg bg-bg border border-line px-3 py-2 font-mono text-xl tracking-[0.25em]"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && press()}
          aria-label="Six-digit code"
        />
        <button className="btn btn-primary" onClick={press} disabled={code.length !== 6}>
          Enter
        </button>
      </div>
      {res && (
        <p className={`mt-2 text-sm font-semibold ${res.verdict === "ALLOWED" ? "text-teal" : "text-amber"}`}>
          {res.verdict}
          {res.reasons?.length ? `: ${res.reasons.join("; ")}` : ""}
        </p>
      )}
      <div className="mt-3 border-t border-line pt-2">
        <div className="label mb-1">Visitor's phone</div>
        {lastSms ? (
          <div className="text-sm">
            <span className="text-muted">To {lastSms.to}:</span> {lastSms.body}
            {smsCode && (
              <button className="ml-2 text-xs text-sky underline" onClick={() => setCode(smsCode)}>
                type it
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">No messages.</p>
        )}
      </div>
    </Panel>
  );
}

/** Baseline door status, under the decision card, so the contrast is in one frame. */
export function BaselineDoor({ state, log }: { state: State; log: AgentEvent[] }) {
  const door = state.devices.baseline_door;
  const lastReply = [...log].reverse().find((e) => e.name === "naive" && e.reply !== undefined)?.reply;
  const open = door.state === "unlocked";
  const lastOpen = state.devices.baseline_door.last && door.state === "locked" && door.last?.by === "auto-relock" ? door.last : null;
  return (
    <section className="panel p-4 flex items-center justify-between gap-4">
      <div>
        <div className="label">Baseline: no HomePulse</div>
        <div className="text-sm text-muted mt-1">Same model and prompt, unlock wired straight to a second simulated door.</div>
        {lastReply && <div className="text-sm mt-1">“{lastReply}”</div>}
        {lastOpen && <div className="text-xs text-amber mt-1">Opened by the agent, relocked at {fmtTime(lastOpen.at, state.tz, true)}</div>}
      </div>
      <div className={`text-2xl font-black ${open ? "text-amber" : "text-muted"}`}>{open ? "UNLOCKED" : "LOCKED"}</div>
    </section>
  );
}

export function DoorStatus({ state }: { state: State }) {
  const d = state.devices.front_door;
  return (
    <div className="flex items-center gap-3">
      <span className="label">HomePulse front door</span>
      <span className={`font-black ${d.state === "unlocked" ? "text-teal" : "text-ink"}`}>{d.state.toUpperCase()}</span>
      <Sim />
    </div>
  );
}
