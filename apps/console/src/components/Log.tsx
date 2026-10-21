import type { AgentEvent } from "../lib/api";
import { Button, Card, CardHeader, Icon, Tag, stagger } from "../ui/kit";

/** Tool calls from the HomePulse agent and the baseline, newest first. */
export function AgentLog({ log, clear }: { log: AgentEvent[]; clear: () => void }) {
  const items = log.filter((e) => e.step && e.step.kind !== "user").slice(-24).reverse();
  return (
    <Card aria-label="Agents">
      <CardHeader title="Agents" caption="Tool calls from both agents, newest first">
        <Button variant="plain" size="small" icon="close" onClick={clear} disabled={items.length === 0}>
          Clear
        </Button>
      </CardHeader>
      {items.length === 0 ? (
        <p className="mt-3 text-footnote text-label-2">Tool calls from the HomePulse agent and the baseline show here.</p>
      ) : (
        <ol className="mt-3 max-h-[320px] divide-y divide-sep overflow-y-auto rounded-12 shadow-[inset_0_0_0_1px_var(--separator)]" tabIndex={0} aria-label="Agent tool calls (scrolls)">
          {items.map((e, i) => {
            const s = e.step!;
            const home = e.name !== "naive";
            return (
              <li key={`${s.at}-${i}`} className="enter flex items-start gap-3 px-3.5 py-2.5 text-body-s" style={stagger(i)}>
                <span className="w-[100px] flex-none">
                  <Tag tone={home ? "tint" : "neutral"} icon={home ? "shield_lock" : "smart_toy"}>
                    {home ? "HomePulse" : "Baseline"}
                  </Tag>
                </span>
                <div className="min-w-0 flex-1 break-words">
                  {s.kind === "tool_call" && (
                    <>
                      <span className="text-label-2">calls </span>
                      <code className="font-mono text-[13px] font-medium">{s.name}</code>
                      <div className="mt-0.5 truncate font-mono text-caption text-label-2" title={JSON.stringify(s.input)}>
                        {JSON.stringify(s.input)}
                      </div>
                    </>
                  )}
                  {s.kind === "tool_result" && (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <code className="font-mono text-[13px] font-medium">{s.name}</code>
                      <Icon name="arrow_forward" size={16} className="text-label-3" />
                      {s.result?.verdict ? (
                        <Tag tone={s.result.verdict === "ALLOWED" ? "positive" : "caution"} icon={s.result.verdict === "ALLOWED" ? "lock_open" : "lock"}>
                          {s.result.verdict === "ALLOWED" ? "Allowed" : "Blocked"}
                        </Tag>
                      ) : (
                        <span className="text-label-2">{s.result?.trust ? "untrusted data" : "ok"}</span>
                      )}
                    </span>
                  )}
                  {s.kind === "reply" && (
                    <span>
                      <span className="text-label-2">says </span>
                      <span className="spoken text-[16px]">“{s.text}”</span>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** The scenario's narration, step by step, on a rail. The newest step is in the tint. */
export function Narration({ captions }: { captions: string[] }) {
  return (
    <Card aria-label="Narration">
      <CardHeader title="Narration" caption="What just happened, in order" />
      {captions.length === 0 ? (
        <p className="mt-3 text-footnote text-label-2">Run a scenario from the sidebar, or press 1 to 4, and each step is narrated here.</p>
      ) : (
        <ol className={`relative mt-3 space-y-2.5 ${captions.length > 1 ? "before:absolute before:bottom-2.5 before:left-[3.5px] before:top-2.5 before:w-px before:bg-sep" : ""}`} aria-live="polite">
          {captions.map((c, i) => {
            const last = i === captions.length - 1;
            return (
              <li key={`${i}-${c}`} className="enter relative flex gap-3 pl-0" style={stagger(0)}>
                <span className={`relative mt-[7px] h-2 w-2 flex-none rounded-full ${last ? "bg-tint shadow-[0_0_0_3px_var(--tint-soft)]" : "bg-fill-1"}`} aria-hidden />
                <span className={`text-body-s ${last ? "font-medium text-label-1" : "text-label-2"}`}>{c}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
