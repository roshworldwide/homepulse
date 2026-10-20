import { randomUUID } from "node:crypto";

/**
 * Ids for drafts, decisions and injected events. Random normally; in DEMO_MODE
 * they are sequential per scenario so recorded agent fixtures (which mention
 * ids such as draft_id) replay against the same ids.
 */
export class Ids {
  private n = 0;
  constructor(public deterministic = false) {}
  reset(): void {
    this.n = 0;
  }
  next(prefix: string): string {
    if (this.deterministic) return `${prefix}${String(++this.n).padStart(4, "0")}`;
    return prefix + randomUUID().replace(/-/g, "").slice(0, 10);
  }
}
