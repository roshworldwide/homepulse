import type { HomePulse } from "./context.js";
import type { Extension } from "./http.js";

/** Optional route groups (Ring webhook, agents, demo). Filled in as those modules land. */
export function extensions(_hp: HomePulse): Extension[] {
  return [];
}
