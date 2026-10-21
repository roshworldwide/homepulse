import { ApprovalBroker as GenericBroker, type AskOptions as GenericAskOptions, type AskResult as GenericAskResult } from "mcp-streamable-guard/approvals";
import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";

export type ApproverRole = "homeowner" | "caregiver";
export type AskResult = GenericAskResult<ApproverRole>;
export type AskOptions = GenericAskOptions<ApproverRole> & {
  field: "approve" | "confirm" | "send";
  kind: "unlock" | "rule" | "code" | "lockdown_off";
};

/**
 * HomePulse's approver phones: MCP elicitation to homeowner and caregiver
 * sessions, never to the agent's. The broker itself lives in
 * mcp-streamable-guard so the guard proxy uses the same, tested code.
 */
export class ApprovalBroker extends GenericBroker<ApproverRole> {
  constructor(clock: Clock, bus?: Bus, graceMs = 5000) {
    super(clock, bus ? (approval) => bus.publish({ type: "approval", approval }) : undefined, graceMs);
  }
  override ask(opts: AskOptions): Promise<AskResult> {
    return super.ask(opts);
  }
}
