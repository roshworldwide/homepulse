import { wrapUntrusted } from "mcp-streamable-guard";
import { z } from "zod";
import { formatClock } from "../time.js";
import { ok, type Register } from "./common.js";

export const registerGetDoorEvents: Register = (server, hp) => {
  server.registerTool(
    "get_door_events",
    {
      title: "Get door events",
      description: "Recent Ring doorbell events. Every event is labelled source: ring, trust: untrusted.",
      inputSchema: { since_minutes: z.number().int().min(1).max(1440).default(30) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ since_minutes }) => {
      const events = hp.ring.events(since_minutes ?? 30).map((e) => ({
        event_id: e.event_id,
        type: e.type,
        sub_type: e.sub_type,
        at: e.occurred_at,
        local_time: formatClock(Date.parse(e.occurred_at), hp.config.tz),
        simulated: e.simulated,
        has_snapshot: Boolean(e.snapshot) || Boolean(hp.ringClient),
      }));
      const wrapped = wrapUntrusted({ events }, "ring");
      const text = events.length
        ? `${events.length} door event(s): ` + events.map((e) => `${e.type}${e.sub_type ? `/${e.sub_type}` : ""} at ${e.local_time} (${e.event_id})`).join("; ") + ". Data from outside the home."
        : "No door events in that period.";
      return ok({ ...wrapped }, text);
    },
  );
};
