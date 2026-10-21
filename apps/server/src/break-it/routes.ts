import express, { type Request } from "express";
import QRCode from "qrcode";
import type { HomePulse } from "../context.js";
import type { Extension } from "../http.js";
import { BreakItService, cleanImage, MAX_IMAGE_BYTES, MAX_SPEECH } from "./service.js";

const DATA_URL = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/;

/** The page's own origin, plus the configured ones. The API needs no credentials, so this only keeps other sites from driving it. */
function originOk(hp: HomePulse, req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (hp.config.allowedOrigins.includes(origin)) return true;
  if (hp.config.publicUrl && origin === new URL(hp.config.publicUrl).origin) return true;
  return origin === `${req.protocol}://${req.get("host")}`;
}

function pageUrl(hp: HomePulse, req: Request): string {
  if (hp.config.publicUrl) return new URL("/break-it", hp.config.publicUrl).toString();
  return `${req.protocol}://${req.get("host")}/break-it`;
}

/**
 * The public "try to break in" API. Mounted with the raw-body routes, before
 * the console's origin and token checks, because anyone may use it; it has its
 * own limits instead (per address, per hour, at once) and stores only counts.
 */
export function breakItRoutes(hp: HomePulse, service = new BreakItService(hp, { limits: hp.config.breakIt })): Extension & { service: BreakItService } {
  return {
    service,
    raw(app) {
      if (!hp.config.breakIt.enabled) return;
      const json = express.json({ limit: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024 });

      app.get("/api/break-it/stats", (_req, res) => {
        res.set("Cache-Control", "no-store");
        res.json({
          ...service.counts(),
          model: hp.config.modelProvider === "bedrock" && hp.config.bedrockModelId ? `Amazon Bedrock · ${hp.config.bedrockModelId}` : "Offline stand-in (not a model)",
          reads_photos: hp.config.modelProvider === "bedrock" && !!hp.config.bedrockModelId,
          night_mode: hp.home.nightMode(Date.now()),
          tz: hp.config.tz,
          limits: { per_address_per_hour: service.limits.perAddressPerHour, max_speech: MAX_SPEECH, max_image_bytes: MAX_IMAGE_BYTES },
        });
      });

      app.get("/api/break-it/qr.svg", async (req, res) => {
        const svg = await QRCode.toString(pageUrl(hp, req), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0B0B0C", light: "#ffffff" } });
        res.set("Content-Type", "image/svg+xml").set("Cache-Control", "public, max-age=300").send(svg);
      });

      app.post("/api/break-it/attempt", json, async (req, res) => {
        res.set("Cache-Control", "no-store");
        if (!originOk(hp, req)) return res.status(403).json({ error: "Forbidden: origin not allowed" });
        const body = (req.body ?? {}) as { speech?: unknown; image?: unknown };
        const speech = typeof body.speech === "string" ? body.speech.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
        if (speech.length > MAX_SPEECH) return res.status(400).json({ error: `Keep it under ${MAX_SPEECH} characters.` });
        let raw: Buffer | undefined;
        if (body.image !== undefined && body.image !== null && body.image !== "") {
          const m = typeof body.image === "string" ? DATA_URL.exec(body.image) : null;
          if (!m) return res.status(400).json({ error: "Photos must be JPEG or PNG." });
          raw = Buffer.from(m[2], "base64");
          if (raw.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: "Photos must be under 2 MB." });
        }
        if (!speech && !raw) return res.status(400).json({ error: "Say something at the door, or hold up a sign." });

        // Limits before any real work (decoding a photo costs CPU).
        const slot = service.admit(req.ip ?? req.socket.remoteAddress ?? "?");
        if ("status" in slot) {
          if (slot.retry_after_s) res.set("Retry-After", String(slot.retry_after_s));
          return res.status(slot.status).json({ error: slot.error });
        }
        let image: Buffer | undefined;
        if (raw) {
          const clean = await cleanImage(raw).catch(() => null);
          if (!clean) {
            slot.release();
            return res.status(400).json({ error: "That photo could not be read as a JPEG or PNG." });
          }
          image = clean;
        }
        try {
          // The slot is released when the house is closed, which for a timed-out attempt is later than this reply.
          const outcome = await service.attempt({ speech: speech || undefined, image }, slot.release);
          res.json({ ...outcome, counts: service.counts() });
        } catch (err) {
          const timedOut = err instanceof Error && err.message === "timeout";
          if (!timedOut) console.error("[homepulse] break-in attempt failed:", err);
          res.status(timedOut ? 504 : 502).json({ error: timedOut ? "The house took too long to answer. Try again." : "Something went wrong at the door. Try again." });
          if (!timedOut) slot.release(); // a failure before the house was set up (release is idempotent)
        }
      });
    },
  };
}
