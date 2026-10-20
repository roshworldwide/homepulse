import { z } from "zod";
import { ok, type Register } from "./common.js";

export const registerNotifyHousehold: Register = (server, hp, session) => {
  server.registerTool(
    "notify_household",
    {
      title: "Notify the household",
      description: "Show a Fire TV-style card, speak an announcement through Alexa, and/or alert the caregiver's phone. All simulated.",
      inputSchema: {
        message: z.string().min(1).max(300),
        channels: z.array(z.enum(["tv", "speaker", "caregiver_phone"])).min(1).max(3),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ message, channels }) => {
      const set = new Set(channels);
      if (set.has("tv")) hp.devices.tv("neutral", "From the assistant", message);
      if (set.has("speaker")) hp.devices.say(message, "alexa");
      if (set.has("caregiver_phone")) hp.devices.alert("caregiver", "From the assistant", message);
      hp.engram.append({ kind: "effect", source: session.role === "agent" ? "agent" : session.role, payload: { type: "notify", message, channels: [...set], simulated: true } });
      return ok({ delivered: [...set], simulated: true }, `Delivered to ${[...set].join(", ")} (simulated).`);
    },
  );
};
