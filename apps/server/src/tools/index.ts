import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HomePulse } from "../context.js";
import type { SessionInfo } from "./common.js";
import { registerDescribeVisitor } from "./describe_visitor.js";
import { registerExplainDecision } from "./explain_decision.js";
import { registerSetLockdown } from "./set_lockdown.js";
import { registerGetDoorEvents } from "./get_door_events.js";
import { registerGetHomeStatus } from "./get_home_status.js";
import { registerNotifyHousehold } from "./notify_household.js";
import { registerOpenParcelBox, registerUnlockFrontDoor } from "./physical.js";
import { registerConfirmRule, registerProposeRule } from "./rules.js";

/** Four read tools, four write tools, then the two physical tools that only run through the guard. */
export const TOOL_REGISTRY = [
  registerGetHomeStatus,
  registerGetDoorEvents,
  registerDescribeVisitor,
  registerExplainDecision,
  registerProposeRule,
  registerConfirmRule,
  registerNotifyHousehold,
  registerSetLockdown,
  registerUnlockFrontDoor,
  registerOpenParcelBox,
];

export function registerTools(server: McpServer, hp: HomePulse, session: SessionInfo): void {
  for (const register of TOOL_REGISTRY) register(server, hp, session);
}
