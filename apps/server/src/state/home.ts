import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";
import { localHour } from "../time.js";

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

/** Home mode: night mode (22:00–06:00 by clock, or set by hand) and away lockdown. */
export class HomeState {
  /** null = follow the clock. */
  nightOverride: boolean | null = null;
  awayLockdown = false;

  constructor(
    private clock: Clock,
    private tz: string,
    private bus?: Bus,
  ) {}

  nightMode(nowMs = this.clock.now()): boolean {
    if (this.nightOverride !== null) return this.nightOverride;
    const h = localHour(nowMs, this.tz);
    return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
  }

  nightSource(): "clock" | "manual" {
    return this.nightOverride === null ? "clock" : "manual";
  }

  setNight(v: boolean | null): void {
    this.nightOverride = v;
    this.bus?.publish({ type: "devices", devices: { home: this.snapshot() } });
  }

  setLockdown(v: boolean): void {
    this.awayLockdown = v;
    this.bus?.publish({ type: "devices", devices: { home: this.snapshot() } });
  }

  reset(): void {
    this.nightOverride = null;
    this.awayLockdown = false;
  }

  snapshot() {
    return { night_mode: this.nightMode(), night_mode_source: this.nightSource(), away_lockdown: this.awayLockdown };
  }
}
