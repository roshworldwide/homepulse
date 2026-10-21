import { z } from "zod";
import type { Bucket, PhysicalTool, UnlockArgs } from "../guard/home-guard.js";
import { agentLastMessage, type Register } from "./common.js";

const inputSchema = {
  pass_id: z.string().max(40).optional(),
  presented_code: z.string().regex(/^\d{6}$/).optional(),
  channel: z.enum(["voice", "app", "agent"]),
  reason: z.string().max(200).optional(),
};

function registerPhysical(tool: PhysicalTool, title: string, description: string): Register {
  return (server, hp, session) => {
    server.registerTool(
      tool,
      { title, description, inputSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
      async (args, extra) => {
        let out;
        try {
          out = await hp.homeGuard.physical(tool, args as UnlockArgs, {
            role: session.role,
            bucket: session.role as Bucket,
            session_id: session.sessionId(),
            agent_last_message: agentLastMessage(extra),
          });
        } catch (err) {
          // Fail closed: effects only run after an allow, so an error means nothing moved.
          console.error(`[homepulse] ${tool} check failed:`, err);
          return {
            content: [{ type: "text" as const, text: "BLOCKED: the check could not be completed, so the door stayed locked." }],
            structuredContent: { allow: false, verdict: "BLOCKED", reasons: ["the check could not be completed"], error: true },
            isError: true,
          };
        }
        const { decision, effect } = out;
        const structuredContent = {
          allow: decision.allow,
          verdict: decision.allow ? "ALLOWED" : "BLOCKED",
          decision_id: decision.decision_id,
          path: decision.path,
          reasons: decision.reasons,
          notes: decision.notes,
          approval_requested: decision.approval_requested,
          ...(decision.echoed_outside_text ? { echoed_outside_text: decision.echoed_outside_text } : {}),
          ...effect,
        };
        const text = decision.allow
          ? `ALLOWED via ${decision.path === "pass" ? "a signed one-time pass" : "a fresh app approval"}. The door relocks in ${effect.relocks_in_seconds} seconds. Decision ${decision.decision_id}.`
          : `BLOCKED: ${decision.reasons.join("; ")}. The door is still locked. Decision ${decision.decision_id}.`;
        return { content: [{ type: "text" as const, text }], structuredContent };
      },
    );
  };
}

export const registerUnlockFrontDoor = registerPhysical(
  "unlock_front_door",
  "Unlock the front door",
  "Physical action. Runs only with a valid signed pass and code, or a fresh approval tapped in the homeowner's or caregiver's app. The reason field is logged and shown, never used to decide.",
);

export const registerOpenParcelBox = registerPhysical(
  "open_parcel_box",
  "Open the parcel box",
  "Physical action. Runs only with a valid signed pass and code for the parcel box, or a fresh approval tapped in the app. The reason field is logged and shown, never used to decide.",
);
