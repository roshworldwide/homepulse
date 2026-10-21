import { fmtTime, type AgentEvent, type State } from "../lib/api";
import { Card, CardHeader, Icon, Seal, Tag } from "../ui/kit";

/** Baseline door: the same agent with no guard. The only place the alarm colour appears. */
export function BaselineCard({ state, log }: { state: State; log: AgentEvent[] }) {
  const door = state.devices.baseline_door;
  const lastReply = [...log].reverse().find((e) => e.name === "naive" && e.reply !== undefined)?.reply;
  const open = door.state === "unlocked";
  const lastOpen = door.last && door.state === "locked" && door.last?.by === "auto-relock" ? door.last : null;
  return (
    <Card aria-label="Baseline: no HomePulse">
      <CardHeader title="Baseline: no HomePulse" caption="Same model and prompt. Its unlock tool drives a second simulated door with no guard." />
      <div className="mt-4 flex items-center gap-3">
        <Seal key={door.state} className="pop" tone={open ? "alarm" : "neutral"} icon={open ? "lock_open" : "lock"} size={48} />
        <div>
          <div className={`text-title-2 ${open ? "text-alarm" : "text-label-1"}`}>{open ? "Unlocked" : "Locked"}</div>
          <div className="text-caption text-label-2">Second simulated door</div>
        </div>
      </div>
      {lastReply && (
        <blockquote className="spoken mt-4 border-l-2 border-sep-strong pl-3 text-[17px] leading-snug text-label-1">“{lastReply}”</blockquote>
      )}
      {lastOpen && (
        <p className="mt-3 flex items-center gap-1.5 text-footnote font-medium text-caution">
          <Icon name="warning" size={16} fill />
          Opened by the agent, relocked at <span className="tabular">{fmtTime(lastOpen.at, state.tz, true)}</span>
        </p>
      )}
    </Card>
  );
}

const TV_RING = { ok: "#4FD68A", alert: "#FFB547", approval: "#FFB547", neutral: "rgba(255,255,255,0.12)" } as const;

/** Fire TV-style card. A television is dark in both appearances, and every line is at least 24 px. */
export function TvCard({ state }: { state: State }) {
  const card = state.devices.tv_cards.at(-1);
  const expected = state.passes.filter((p) => p.status === "active");
  const ring = state.home.away_lockdown ? TV_RING.alert : TV_RING[card?.tone ?? "neutral"];
  return (
    <Card aria-label="Living room TV">
      <CardHeader title="Living room TV" caption="What the family sees on the television">
        <Tag icon="tv">Fire TV-style card</Tag>
      </CardHeader>
      <div className="mt-4 min-h-[170px] rounded-16 p-5" style={{ background: "#0B0B0C", color: "#F5F5F7", boxShadow: `inset 0 0 0 2px ${ring}` }}>
        {state.home.away_lockdown && (
          <div className="flex items-center gap-2 text-[24px] font-bold" style={{ color: "#FFB547" }}>
            <Icon name="lock" fill size={26} /> Lockdown on
          </div>
        )}
        {card ? (
          <div key={card.id} className="enter">
            <div className="text-[28px] font-bold leading-tight tracking-[-0.02em]">{card.title}</div>
            {card.body && (
              <div className="mt-1 text-[24px] leading-snug" style={{ color: "rgba(245,245,247,0.74)" }}>
                {card.body}
              </div>
            )}
            <div className="tabular mt-2 text-[24px]" style={{ color: "rgba(245,245,247,0.5)" }}>
              {fmtTime(card.at, state.tz)}
            </div>
          </div>
        ) : (
          <div className="text-[24px]" style={{ color: "rgba(245,245,247,0.6)" }}>
            Nothing to show.
          </div>
        )}
        {expected.length > 0 && (
          <div className="mt-3 border-t pt-3 text-[24px] leading-snug" style={{ borderColor: "rgba(255,255,255,0.12)", color: "rgba(245,245,247,0.74)" }}>
            Expected: {expected.map((p) => `${p.who}, ${p.window}`).join(" · ")}
          </div>
        )}
      </div>
    </Card>
  );
}
