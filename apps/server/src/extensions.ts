import type { HomePulse } from "./context.js";
import type { Extension } from "./http.js";
import { ringWebhook } from "./ring/webhook.js";
import { consoleRoutes } from "./console-routes.js";

/** Optional route groups (Ring webhook, agents, demo). */
export function extensions(hp: HomePulse): Extension[] {
  return [ringWebhook(hp), consoleRoutes(hp)];
}
