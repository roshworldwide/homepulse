import type { HomePulse } from "../context.js";
import { formatClock } from "../time.js";
import type { ToolCallResult, ToolDef, ToolExecutor } from "./types.js";

/**
 * Naive baseline ("prompt-and-pray"): the same tools, the same model, the same
 * visitor description, but its unlock tool drives a second simulated door
 * directly. No guard, no untrusted wrapper. Label: "Baseline: no HomePulse".
 */
export class NaiveToolExecutor implements ToolExecutor {
  constructor(
    private hp: HomePulse,
    private toolDefs: () => Promise<ToolDef[]>,
    private onEvent: (e: Record<string, unknown>) => void,
  ) {}

  list(): Promise<ToolDef[]> {
    return this.toolDefs();
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const hp = this.hp;
    switch (name) {
      case "get_home_status": {
        const json = { local_time: formatClock(hp.clock.now(), hp.config.tz), front_door: hp.devices.baselineDoor.state, night_mode: hp.home.nightMode() };
        return { json, text: JSON.stringify(json) };
      }
      case "get_door_events": {
        const events = hp.ring.events(Number(args.since_minutes ?? 30));
        return { json: { events }, text: `${events.length} events` };
      }
      case "describe_visitor": {
        const ev = hp.ring.find(String(args.event_id ?? ""));
        if (!ev) return { json: { error: "no such event" }, text: "no such event", isError: true };
        const img = await hp.ring.snapshot(ev);
        if ("unavailable" in img) return { json: { video: img.unavailable }, text: img.unavailable };
        // Same model call (or the same recorded fixture) as HomePulse, returned raw: no wrapper, no label.
        const r = await hp.provider.describeVisitor(img);
        return { json: { ...r.output }, text: r.output.summary };
      }
      case "unlock_front_door":
      case "open_parcel_box": {
        hp.devices.baselineDoor.unlock(`baseline:${String(args.reason ?? "agent")}`.slice(0, 120), hp.config.unlockMs);
        this.onEvent({ event: "baseline_door_unlocked", reason: args.reason ?? null, channel: args.channel ?? null });
        return { json: { allow: true, door: "unlocked" }, text: "Door unlocked." };
      }
      case "notify_household": {
        this.onEvent({ event: "baseline_notify", message: args.message });
        return { json: { delivered: args.channels ?? [] }, text: "Delivered." };
      }
      default:
        return { json: { error: `${name} is not available in the baseline` }, text: `${name} is not available in the baseline`, isError: true };
    }
  }
}
