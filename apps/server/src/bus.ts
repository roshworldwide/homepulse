import { EventEmitter } from "node:events";

/** Server-wide event bus. The console's Server-Sent Events stream subscribes to it. */
export type BusEvent =
  | { type: "record"; record: unknown }
  | { type: "devices"; devices: unknown }
  | { type: "decision"; decision: unknown }
  | { type: "approval"; approval: unknown }
  | { type: "agent"; agent: unknown }
  | { type: "demo"; demo: unknown };

/** Live-view connections allowed at once; each holds one listener. */
export const MAX_SUBSCRIBERS = 100;

export class Bus extends EventEmitter {
  constructor() {
    super();
    // Subscribers are capped by the SSE route; headroom for internal listeners.
    this.setMaxListeners(MAX_SUBSCRIBERS + 25);
  }

  /**
   * Deliver to every subscriber. A subscriber that throws is isolated and
   * logged: publishing happens inside Engram appends and guard decisions, so a
   * broken live-view listener must never be able to fail a door decision.
   */
  publish(e: BusEvent): void {
    for (const fn of this.listeners("event") as Array<(e: BusEvent) => void>) {
      try {
        fn(e);
      } catch (err) {
        console.error("[homepulse] bus subscriber failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  subscribe(fn: (e: BusEvent) => void): () => void {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}
