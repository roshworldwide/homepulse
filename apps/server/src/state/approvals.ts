import type { Role } from "../config.js";

export const APPROVAL_FRESH_MS = 60_000;

export interface Approval {
  decision_id: string;
  approved: boolean;
  /** When the approver answered (server clock). */
  at: number;
  /** The role of the session that answered, from the session table, never from the message. */
  role: Role;
  session_id: string;
}

/** One approval per request id. Spent when it allows an unlock. */
export class Approvals {
  private byDecision = new Map<string, Approval>();

  set(a: Approval): void {
    this.byDecision.set(a.decision_id, a);
  }

  get(decisionId: string): Approval | undefined {
    return this.byDecision.get(decisionId);
  }

  /** Spend an approval atomically (single-threaded JS: delete is the transaction). */
  consume(decisionId: string): boolean {
    const a = this.byDecision.get(decisionId);
    if (!a || !a.approved) return false;
    this.byDecision.delete(decisionId);
    return true;
  }

  delete(decisionId: string): void {
    this.byDecision.delete(decisionId);
  }

  /** Drop approvals too old to ever count (twice the freshness window). */
  sweep(nowMs: number): void {
    for (const [id, a] of this.byDecision) if (nowMs - a.at > 2 * APPROVAL_FRESH_MS || a.at - nowMs > 2 * APPROVAL_FRESH_MS) this.byDecision.delete(id);
  }

  size(): number {
    return this.byDecision.size;
  }

  clear(): void {
    this.byDecision.clear();
  }
}
