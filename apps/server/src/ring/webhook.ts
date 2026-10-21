import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import express from "express";
import type { HomePulse } from "../context.js";
import type { Extension } from "../http.js";

/** sha256=<hex HMAC-SHA256 of the raw body>, as Ring signs webhooks in the X-Signature header. */
export function ringSignature(body: Buffer | string, key: string): string {
  return "sha256=" + createHmac("sha256", key).update(body).digest("hex");
}

export function verifyRingSignature(body: Buffer, header: string | undefined, key: string): boolean {
  const expected = Buffer.from(ringSignature(body, key));
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * A webhook body in Ring's v1.1 shape (meta + data/attributes + device
 * relationship). Field names follow the Partner API docs as far as we could
 * read them; the receiver's normaliser tolerates differences, and unknown
 * attribute values are passed through rather than dropped.
 */
export function buildRingPayload(opts: { type: string; sub_type?: string | null; device_id: string; at: number; extra?: Record<string, unknown> }) {
  const attributes: Record<string, unknown> = { occurred_at: new Date(opts.at).toISOString(), ...opts.extra };
  if (opts.sub_type) attributes.sub_type = opts.sub_type;
  return {
    meta: { version: "1.1", request_id: randomUUID(), timestamp: new Date(opts.at).toISOString() },
    data: {
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      type: opts.type,
      attributes,
      relationships: { device: { data: { type: "devices", id: opts.device_id } } },
    },
  };
}

export const ACTED_ON = new Set(["motion_detected", "button_press"]);

function safeAlert(hp: HomePulse, payload: Record<string, unknown>): void {
  try {
    hp.engram.append({ kind: "alert", source: "system", payload });
  } catch {
    /* the alert itself could not be written */
  }
}

/** Same code path for real Ring webhooks and the local injector. Mounted before any JSON parser. */
export function ringWebhook(hp: HomePulse): Extension {
  const seen = new Set<string>();
  return {
    raw(app) {
      app.post("/ring/webhook", express.raw({ type: "application/json", limit: "256kb" }), (req, res) => {
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || !verifyRingSignature(body, req.header("x-signature"), hp.config.ringHmacKey)) {
          return res.status(401).end();
        }
        // Labels only: whether this came from the local injector, and which bundled snapshot it carries.
        const simulated = req.header("x-homepulse-injector") === "1";
        const snapshotHeader = req.header("x-homepulse-snapshot");
        const snapshot = simulated && snapshotHeader ? path.basename(snapshotHeader) : null;
        // Store first, then answer: the append is one small synchronous write (well under Ring's
        // 5-second budget even under a flood), and a 200 then means the event is on disk. Answering
        // before storing lost the in-flight events when the process was killed.
        let raw: unknown;
        try {
          raw = JSON.parse(body.toString("utf8"));
        } catch (err) {
          // Signed but unreadable: keep a record and answer 200 so Ring does not resend it forever.
          safeAlert(hp, { type: "webhook_parse_error", error: String(err).slice(0, 300) });
          return res.status(200).end();
        }
        const rid = (raw as { meta?: { request_id?: unknown } } | null)?.meta?.request_id;
        if (typeof rid === "string" && seen.has(rid)) return res.status(200).end(); // idempotent on meta.request_id
        let rec;
        try {
          rec = hp.ring.ingest(raw, { simulated, snapshot });
        } catch (err) {
          if ((err as { code?: string })?.code === "ERR_SQLITE_ERROR") {
            // The database could not take the write right now: answer 503 so Ring resends it later.
            console.error("[homepulse] could not store a Ring event:", err);
            return res.status(503).set("Retry-After", "5").end();
          }
          // The payload itself cannot be stored (for example nested too deeply): record that, don't retry.
          safeAlert(hp, { type: "webhook_unstorable", error: String(err).slice(0, 300) });
          return res.status(200).end();
        }
        if (typeof rid === "string") {
          // Marked seen only once stored, so a redelivery after a failed write is not ignored.
          seen.add(rid);
          if (seen.size > 5000) seen.delete(seen.values().next().value as string);
        }
        res.status(200).end();
        const ev = rec.payload.event as { type: string; sub_type: string | null };
        if (ACTED_ON.has(ev.type) && (ev.type === "button_press" || ev.sub_type === "human")) {
          setImmediate(() => hp.bus.publish({ type: "demo", demo: { event: "door_event", record_id: rec.id } }));
        }
      });
    },
  };
}
