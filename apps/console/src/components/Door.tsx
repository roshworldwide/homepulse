import { useState } from "react";
import { fmtTime, postJson, type State } from "../lib/api";
import { Banner, Button, Card, CardHeader, Icon, Tag, sentence } from "../ui/kit";

const SNAPSHOTS = [
  ["nurse.jpg", "Nurse"],
  ["paramedic.jpg", "Paramedic"],
  ["sign-attack.jpg", "Sign at the camera"],
  ["night.jpg", "Night visitor"],
] as const;

/** What the door saw: the latest Ring event, its snapshot, and the untrusted visitor description. */
export function RingFeed({ state, onAsk }: { state: State; onAsk: () => void }) {
  const ev = [...state.records].reverse().find((r) => r.payload.type === "ring_event");
  const desc = ev && [...state.records].reverse().find((r) => r.payload.type === "visitor_description" && r.payload.event_id === ev.payload.event.event_id);
  const [snap, setSnap] = useState<string>("sign-attack.jpg");
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<number | null>(null);
  const ring = async () => {
    setBusy(true);
    try {
      await postJson("/api/inject", { type: "button_press", snapshot: snap });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card pad={false} className="overflow-hidden" aria-label="Front door camera">
      <div className="relative aspect-[16/10] bg-[#0b0b0c]">
        {ev && broken !== ev.id ? (
          <img key={ev.id} src={`/api/snapshot/${encodeURIComponent(ev.payload.event.event_id)}`} alt="Doorbell snapshot" className="absolute inset-0 h-full w-full object-cover" onError={() => setBroken(ev.id)} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[rgba(245,245,247,0.6)]">
            <Icon name="videocam" size={40} weight={300} />
            <p className="text-footnote">{ev ? "No snapshot for this event." : "No one has come to the door yet."}</p>
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="tag glass glass-marine">
            <Icon name={ev && !ev.payload.simulated ? "videocam" : "science"} fill />
            {ev ? (ev.payload.simulated ? "Simulated event" : "Ring API") : "Simulated camera"}
          </span>
        </div>
        {ev && (
          <div className="absolute bottom-3 left-3 right-3 flex">
            <span className="tag glass glass-marine !min-h-7 !px-3 !text-[13px]">
              <Icon name={ev.payload.event.type === "button_press" ? "doorbell" : "sensors"} fill />
              {ev.payload.event.type === "button_press" ? "Doorbell pressed" : `Motion: ${ev.payload.event.sub_type ?? "unknown"}`}
              <span className="tabular font-medium text-label-2">· {fmtTime(ev.t_event, state.tz)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="card-pad !pt-4">
        <CardHeader title="Front door camera" caption="Ring doorbell · what the camera saw" />
        {desc && (
          <div className="well mt-3 p-3">
            <div className="flex flex-wrap gap-1.5">
              <Tag icon="videocam">Source: Ring</Tag>
              <Tag tone="caution" icon="warning">
                Untrusted
              </Tag>
              {desc.payload.model?.label && (
                <Tag icon="smart_toy" className="max-w-full truncate" title={desc.payload.model.label}>
                  <span className="truncate">{desc.payload.model.label}</span>
                </Tag>
              )}
            </div>
            <p className="mt-2 text-body-s">{desc.payload.output?.summary}</p>
            {desc.payload.output?.visible_text?.length > 0 && (
              <p className="mt-1.5 text-footnote text-label-2">
                Visible text, as data:{" "}
                {desc.payload.output.visible_text.map((t: string) => (
                  <q key={t} className="mr-1 font-medium text-label-1">
                    {t}
                  </q>
                ))}
              </p>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="select">
            <select className="field field-sm !w-auto" value={snap} onChange={(e) => setSnap(e.target.value)} aria-label="Snapshot for the simulated doorbell">
              {SNAPSHOTS.map(([f, l]) => (
                <option key={f} value={f}>
                  {l}
                </option>
              ))}
            </select>
            <Icon name="expand_more" />
          </div>
          <Button size="small" icon="doorbell" onClick={ring} loading={busy}>
            Ring the bell
          </Button>
          <Button size="small" icon="smart_toy" onClick={onAsk} disabled={!ev}>
            Agents: check the door
          </Button>
        </div>
      </div>
    </Card>
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
  const tone = res?.verdict === "ALLOWED" ? "positive" : res?.verdict === "ERROR" ? "alarm" : "caution";
  return (
    <Card aria-label="Keypad at the door">
      <CardHeader title="Keypad at the door" caption="Anyone can type a code. The guard decides.">
        <Tag icon="science">Simulated</Tag>
      </CardHeader>
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) void press();
        }}
      >
        <input
          className="field tabular !h-12 !w-[11.5rem] !rounded-12 text-center font-mono !text-[22px] tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-label="Six-digit code"
        />
        <Button type="submit" variant="tinted" size="large" icon="dialpad" disabled={code.length !== 6}>
          Enter
        </Button>
      </form>
      {res && (
        <Banner tone={tone} icon={tone === "positive" ? "lock_open" : tone === "alarm" ? "error" : "lock"} className="enter mt-3" title={res.verdict === "ERROR" ? "Something went wrong" : sentence(res.verdict)} role="status">
          {res.reasons?.length ? res.reasons.join("; ") : undefined}
        </Banner>
      )}

      <div className="mt-5 border-t border-sep pt-4">
        <div className="flex items-center gap-2 text-caption font-semibold text-label-2">
          <Icon name="sms" size={16} />
          Visitor's phone
        </div>
        {lastSms ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="enter max-w-[34ch] rounded-[18px] rounded-bl-[6px] bg-fill-2 px-3.5 py-2.5 text-body-s">
              <span className="text-label-2">To {lastSms.to}:</span> {lastSms.body}
            </div>
            {smsCode && (
              <Button variant="plain" size="small" icon="keyboard" onClick={() => setCode(smsCode)}>
                Type it
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-footnote text-label-2">No messages.</p>
        )}
      </div>
    </Card>
  );
}
