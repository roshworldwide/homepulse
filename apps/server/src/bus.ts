import { EventEmitter } from "node:events";

/** Server-wide event bus. The console's Server-Sent Events stream subscribes to it. */
export type BusEvent =
  | { type: "record"; record: unknown }
  | { type: "devices"; devices: unknown }
  | { type: "decision"; decision: unknown }
  | { type: "approval"; approval: unknown }
  | { type: "agent"; agent: unknown }
  | { type: "demo"; demo: unknown };

export class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
  publish(e: BusEvent): void {
    this.emit("event", e);
  }
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}
