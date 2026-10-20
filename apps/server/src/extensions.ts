import type { HomePulse } from "./context.js";
import type { Extension } from "./http.js";
import { AgentService } from "./agents/homepulse.js";
import { agentRoutes } from "./agents/routes.js";
import { consoleRoutes } from "./console-routes.js";
import { demoRoutes } from "./demo/routes.js";
import { ringWebhook } from "./ring/webhook.js";

/**
 * Route groups beyond /mcp: the Ring webhook (raw body), console routes, and
 * the agents. The agents reach the server over real MCP at `mcpUrl`.
 */
export function extensions(hp: HomePulse, mcpUrl: () => string = () => `http://127.0.0.1:${hp.config.port}/mcp`): Extension[] {
  hp.agents ??= new AgentService(hp, mcpUrl);
  return [ringWebhook(hp), consoleRoutes(hp), agentRoutes(hp, hp.agents), demoRoutes(hp)];
}
