import { useState, type ReactNode } from "react";
import { fmtTime, postJson, type State } from "../lib/api";
import type { Ask } from "../lib/phone";
import { Banner, Button, Card, Icon, Mark, Tag, stagger } from "../ui/kit";

/**
 * A family phone. It is a real MCP client: it opens a session with the homeowner or
 * caregiver token and answers the server's elicitation requests (approve, confirm, send).
 */
export function PhonePanel({ person, roleLabel, role, asks, status, state, token, children }: { person: string; roleLabel: string; role: "homeowner" | "caregiver"; asks: Ask[]; status: string; state: State; token?: string; children?: ReactNode }) {
  const alerts = state.devices.alerts.filter((a) => a.to === role).slice(-4).reverse();
  const connected = status === "connected";
  return (
    <Card aria-label={`${person}'s phone`}>
      <header className="flex items-center gap-3">
        <span className="avatar" aria-hidden>
          {person[0]}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-heading">{person}</h2>
          <p className="text-caption text-label-2">{roleLabel}</p>
        </div>
        <Icon name="smartphone" size={20} className="text-label-3" />
      </header>
      <div className="mt-3">
        <Tag tone={connected ? "positive" : status === "error" ? "alarm" : "neutral"} dot>
          {connected ? "MCP session · elicitation" : status === "connecting" ? "Connecting…" : status === "error" ? "Could not connect" : "Offline"}
        </Tag>
      </div>

      <div className="mt-4 space-y-2.5">
        {asks.map((a) => (
          <AskCard key={a.id} ask={a} />
        ))}
        {asks.length === 0 && alerts.length === 0 && (
          <p className="flex items-center gap-2 text-footnote text-label-2">
            <Icon name="notifications" size={16} /> No requests.
          </p>
        )}
        {alerts.length > 0 && (
          <ul className="group">
            {alerts.map((a, i) => (
              <li key={a.id} className="enter flex gap-2.5 px-3.5 py-3" style={stagger(i)}>
                <Icon name="notifications" size={18} fill className="mt-0.5 text-tint" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-body-s font-semibold">{a.title}</span>
                    <span className="tabular flex-none text-caption text-label-3">{fmtTime(a.at, state.tz)}</span>
                  </div>
                  {a.body && <p className="mt-0.5 text-footnote text-label-2">{a.body}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {children}
      {!token && <p className="mt-3 text-caption text-label-3">Tokens are not exposed to this browser (set CONSOLE_EXPOSE_TOKENS=true for the local demo).</p>}
    </Card>
  );
}

/** An elicitation request, drawn as a notification with two capsule buttons. */
function AskCard({ ask }: { ask: Ask }) {
  const code = /One-time code for .*?: (\d{6})/.exec(ask.message)?.[1];
  const [yes, no] = ask.field === "approve" ? ["Approve", "Deny"] : ask.field === "confirm" ? ["Confirm", "Decline"] : ["Send to visitor", "Not now"];
  return (
    <div className="pop rounded-16 bg-elevated p-3.5 shadow-3" role="alertdialog" aria-label={ask.title}>
      <div className="flex items-center gap-2 text-caption text-label-2">
        <Mark size={20} />
        <span className="font-semibold text-label-1">HomePulse</span>
        <span className="ml-auto">now</span>
      </div>
      {code ? (
        <>
          <p className="mt-2 text-body-s text-label-2">{ask.message.replace(code, "••••••")}</p>
          <div className="tabular mt-2 font-mono text-[32px] font-medium tracking-[0.3em] text-label-1" aria-label={`Code ${code.split("").join(" ")}`}>
            {code}
          </div>
          <p className="text-caption text-label-3">Shown once. HomePulse keeps only a hash.</p>
        </>
      ) : (
        <p className="mt-2 text-body-s leading-snug">{ask.message}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="prominent" className="flex-1" onClick={() => ask.answer(true)}>
          {yes}
        </Button>
        <Button variant="gray" className="flex-1" onClick={() => ask.answer(false)}>
          {no}
        </Button>
      </div>
    </div>
  );
}

export function CaregiverNote({ token }: { token?: string }) {
  const [text, setText] = useState("Nurse Sarah and cold-chain insulin arriving at 2 PM");
  const [msg, setMsg] = useState<{ tone: "positive" | "caution" | "alarm"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await postJson("/api/caregiver/note", { text }, token);
      setMsg(
        r.status === "draft"
          ? { tone: "positive", text: `Drafted: ${r.read_back} Confirm on this phone.` }
          : { tone: "caution", text: r.status === "refused" ? `${r.why} ${r.offer ?? ""}` : (r.question ?? r.why) },
      );
    } catch (e) {
      setMsg({ tone: "alarm", text: String((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t border-sep pt-4">
      <label htmlFor="caregiver-note" className="field-label">
        Note
      </label>
      <textarea id="caregiver-note" className="field !min-h-0 text-body-s" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="field-help">Stands in for a Bee recording.</p>
      <Button size="small" icon="edit_note" className="mt-2" onClick={send} disabled={!token} loading={busy}>
        Save note
      </Button>
      {msg && (
        <Banner tone={msg.tone} className="enter mt-3" role="status">
          {msg.text}
        </Banner>
      )}
    </div>
  );
}
