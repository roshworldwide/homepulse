import fs from "node:fs";
import path from "node:path";
import { extractTexts } from "mcp-streamable-guard";
import type { Clock } from "../clock.js";
import { REPO_ROOT } from "../config.js";
import type { Engram, EngramRecord } from "../engram/store.js";
import type { ImageInput } from "../models/types.js";
import type { RingClient } from "./client.js";

/** A Ring event as HomePulse stores it. Every field came from outside the home: untrusted. */
export interface DoorEvent {
  event_id: string;
  type: string;
  /** motion_detected: human | vehicle | package_delivery | other_motion | motion | anything new (kept, not dropped). */
  sub_type: string | null;
  device_id: string | null;
  occurred_at: string;
  simulated: boolean;
  snapshot: string | null;
  /** Any other attributes Ring sent, kept as data. */
  attributes: Record<string, unknown>;
}

export const ASSETS_DIR = path.join(REPO_ROOT, "assets");

/** Pull the fields we use out of a Ring webhook body, tolerating shape differences. Unknown values pass through. */
export function normalizeRingEvent(raw: unknown, fallbackNow: number): Omit<DoorEvent, "simulated" | "snapshot"> {
  const r = (raw ?? {}) as Record<string, any>;
  const data = (r.data ?? r.event ?? r) as Record<string, any>;
  const attributes = (data.attributes ?? r.attributes ?? {}) as Record<string, unknown>;
  const type = String(data.event_type ?? attributes.event_type ?? data.type ?? r.event_type ?? r.type ?? "unknown");
  const sub = attributes.sub_type ?? data.sub_type ?? r.sub_type;
  const occurred = attributes.occurred_at ?? attributes.timestamp ?? data.occurred_at ?? data.timestamp ?? r.occurred_at ?? r.meta?.timestamp ?? r.timestamp ?? r.created_at;
  const occurredMs = typeof occurred === "number" ? (occurred < 1e12 ? occurred * 1000 : occurred) : Date.parse(String(occurred ?? ""));
  const device = data.relationships?.device?.data?.id ?? attributes.device_id ?? data.device_id ?? r.device_id ?? data.device?.id ?? null;
  return {
    event_id: String(data.event_id ?? data.id ?? r.event_id ?? r.id ?? `evt_${fallbackNow}`),
    type,
    sub_type: sub === undefined || sub === null ? null : String(sub),
    device_id: device === null ? null : String(device),
    occurred_at: new Date(Number.isNaN(occurredMs) ? fallbackNow : occurredMs).toISOString(),
    attributes,
  };
}

export class RingService {
  constructor(
    private engram: Engram,
    private clock: Clock,
    private client: RingClient | null,
  ) {}

  /** Store a Ring event (real webhook or local injector, same path) in Engram, labelled ring / untrusted. */
  ingest(raw: unknown, opts: { simulated: boolean; snapshot?: string | null }): EngramRecord {
    const ev = normalizeRingEvent(raw, this.clock.now());
    const event: DoorEvent = { ...ev, simulated: opts.simulated, snapshot: opts.snapshot ?? null };
    // Any free text in the attributes is outside text for the echo explanation.
    const outside_text = extractTexts(event.attributes).filter((s) => s.split(/\s+/).length >= 3);
    return this.engram.append({
      kind: "input",
      source: "ring",
      t_event: Date.parse(event.occurred_at),
      payload: { type: "ring_event", event, simulated: opts.simulated, outside_text },
    });
  }

  events(sinceMinutes: number): DoorEvent[] {
    const now = this.clock.now();
    return this.engram
      .eventsBetween(now - sinceMinutes * 60_000, now, "input", "ring")
      .filter((r) => r.payload.type === "ring_event")
      .map((r) => r.payload.event as DoorEvent);
  }

  find(eventId: string): DoorEvent | undefined {
    return this.engram
      .all()
      .filter((r) => r.kind === "input" && r.source === "ring" && r.payload.type === "ring_event")
      .map((r) => r.payload.event as DoorEvent)
      .reverse()
      .find((e) => e.event_id === eventId);
  }

  /** The snapshot for an event: bundled file for injected events, the Ring media API for real ones. */
  async snapshot(ev: DoorEvent): Promise<ImageInput | { unavailable: string }> {
    if (ev.snapshot) {
      // Bundled assets, plus any extra folders (the Holdout harness renders sign snapshots into its own folder).
      const dirs = [ASSETS_DIR, ...(process.env.HOMEPULSE_SNAPSHOT_DIRS ?? "").split(",").filter(Boolean)];
      const file = dirs.map((d) => path.join(d, path.basename(ev.snapshot!))).find((f) => fs.existsSync(f));
      if (!file) return { unavailable: `snapshot ${ev.snapshot} not found` };
      return { bytes: fs.readFileSync(file), mime: file.endsWith(".png") ? "image/png" : "image/jpeg", name: path.basename(file) };
    }
    if (!this.client || !ev.device_id) return { unavailable: "no snapshot for this event" };
    return this.client.snapshot(ev.device_id);
  }
}
