import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";

/** Every device here is simulated, and says so in its snapshot so the UI can label it. */

export type LockState = "locked" | "unlocked";

export interface LockEvent {
  at: number;
  state: LockState;
  by: string;
}

export class SimulatedLock {
  state: LockState = "locked";
  history: LockEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly name: string,
    private clock: Clock,
    private onChange: () => void,
  ) {}

  /** Unlock, then relock automatically after `ms`. */
  unlock(by: string, ms: number): void {
    this.set("unlocked", by);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.set("locked", "auto-relock"), ms);
    this.timer.unref?.();
  }

  lock(by: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.set("locked", by);
  }

  private set(state: LockState, by: string): void {
    this.state = state;
    this.history.push({ at: this.clock.now(), state, by });
    if (this.history.length > 50) this.history.shift();
    this.onChange();
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = "locked";
    this.history = [];
  }

  snapshot() {
    return { name: this.name, state: this.state, simulated: true, last: this.history.at(-1) ?? null };
  }
}

export type CardTone = "neutral" | "ok" | "alert" | "approval";

export interface TvCard {
  id: number;
  at: number;
  tone: CardTone;
  title: string;
  body: string;
}

export interface PhoneAlert {
  id: number;
  at: number;
  to: "caregiver" | "homeowner";
  title: string;
  body: string;
}

export interface Utterance {
  id: number;
  at: number;
  where: "alexa" | "doorbell";
  text: string;
}

export interface Sms {
  id: number;
  at: number;
  to: string;
  body: string;
}

export class Devices {
  readonly frontDoor: SimulatedLock;
  readonly parcelBox: SimulatedLock;
  /** The naive baseline agent's door: same lock, no guard in front of it. */
  readonly baselineDoor: SimulatedLock;
  tvCards: TvCard[] = [];
  alerts: PhoneAlert[] = [];
  spoken: Utterance[] = [];
  sms: Sms[] = [];
  private seq = 0;

  constructor(
    private clock: Clock,
    private bus?: Bus,
  ) {
    const changed = () => this.publish();
    this.frontDoor = new SimulatedLock("front", clock, changed);
    this.parcelBox = new SimulatedLock("parcel_box", clock, changed);
    this.baselineDoor = new SimulatedLock("baseline_front", clock, changed);
  }

  lockFor(door: "front" | "parcel_box"): SimulatedLock {
    return door === "front" ? this.frontDoor : this.parcelBox;
  }

  tv(tone: CardTone, title: string, body = ""): TvCard {
    const c = { id: ++this.seq, at: this.clock.now(), tone, title, body };
    this.tvCards.push(c);
    if (this.tvCards.length > 20) this.tvCards.shift();
    this.publish();
    return c;
  }

  alert(to: PhoneAlert["to"], title: string, body = ""): PhoneAlert {
    const a = { id: ++this.seq, at: this.clock.now(), to, title, body };
    this.alerts.push(a);
    if (this.alerts.length > 50) this.alerts.shift();
    this.publish();
    return a;
  }

  say(text: string, where: Utterance["where"] = "alexa"): Utterance {
    const u = { id: ++this.seq, at: this.clock.now(), where, text };
    this.spoken.push(u);
    if (this.spoken.length > 50) this.spoken.shift();
    this.publish();
    return u;
  }

  text(to: string, body: string): Sms {
    const s = { id: ++this.seq, at: this.clock.now(), to, body };
    this.sms.push(s);
    if (this.sms.length > 20) this.sms.shift();
    this.publish();
    return s;
  }

  reset(): void {
    this.frontDoor.reset();
    this.parcelBox.reset();
    this.baselineDoor.reset();
    this.tvCards = [];
    this.alerts = [];
    this.spoken = [];
    this.sms = [];
    this.publish();
  }

  snapshot() {
    return {
      simulated: true,
      front_door: this.frontDoor.snapshot(),
      parcel_box: this.parcelBox.snapshot(),
      baseline_door: this.baselineDoor.snapshot(),
      tv_cards: this.tvCards.slice(-5),
      alerts: this.alerts.slice(-10),
      spoken: this.spoken.slice(-10),
      sms: this.sms.slice(-5),
    };
  }

  private publish(): void {
    this.bus?.publish({ type: "devices", devices: this.snapshot() });
  }
}
