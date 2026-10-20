import { formatClock, formatWindow, isoInTz } from "../time.js";
import { ok, type Register } from "./common.js";

export const registerGetHomeStatus: Register = (server, hp) => {
  server.registerTool(
    "get_home_status",
    {
      title: "Get home status",
      description: "Home mode (night, lockdown), lock states, and today's expected visitors. Never includes codes.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const now = hp.clock.now();
      const tz = hp.config.tz;
      const startOfWindow = now - 12 * 3600_000;
      const visitors = hp.passes
        .all()
        .filter((r) => Date.parse(r.pass.not_after) >= startOfWindow)
        .map((r) => ({
          who: r.pass.who,
          door: r.pass.door,
          window: formatWindow(r.pass.not_before, r.pass.not_after, tz, now),
          purpose: r.pass.purpose ?? null,
          status: r.revoked_at ? "revoked" : r.uses >= r.pass.max_uses ? "arrived" : Date.parse(r.pass.not_after) < now ? "expired" : "expected",
          valid_at_night: r.pass.allow_at_night,
        }));
      const s = {
        now: isoInTz(now, tz),
        local_time: formatClock(now, tz),
        time_zone: tz,
        mode: hp.home.snapshot(),
        locks: { front_door: hp.devices.frontDoor.state, parcel_box: hp.devices.parcelBox.state, simulated: true },
        expected_visitors: visitors,
        approvers_connected: hp.broker.connected().map((a) => a.role),
      };
      const text = `It is ${s.local_time}. Front door ${s.locks.front_door}, parcel box ${s.locks.parcel_box}. Night mode ${s.mode.night_mode ? "on" : "off"}${s.mode.away_lockdown ? ", lockdown ON" : ""}. ${visitors.filter((v) => v.status === "expected").length} expected visitor(s).`;
      return ok(s, text);
    },
  );
};
