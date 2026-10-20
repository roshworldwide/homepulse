import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db.js";
import { codeMatches, passInWindow, type Door, type VisitPass } from "mcp-streamable-guard";

export const WRONG_CODE_LIMIT = 5;

export interface PassRow {
  pass: VisitPass;
  uses: number;
  wrong_codes: number;
  revoked_at: string | null;
  revoked_reason: string | null;
}

interface Raw {
  pass_id: string;
  body: string;
  uses: number;
  wrong_codes: number;
  revoked_at: string | null;
  revoked_reason: string | null;
}

const toRow = (r: Raw): PassRow => ({
  pass: JSON.parse(r.body),
  uses: r.uses,
  wrong_codes: r.wrong_codes,
  revoked_at: r.revoked_at,
  revoked_reason: r.revoked_reason,
});

/** Signed passes. The guard re-verifies each pass's signature on every check. */
export class PassStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS passes (
        pass_id        TEXT PRIMARY KEY,
        door           TEXT NOT NULL,
        body           TEXT NOT NULL,   -- the signed pass, JSON
        max_uses       INTEGER NOT NULL,
        uses           INTEGER NOT NULL DEFAULT 0,
        wrong_codes    INTEGER NOT NULL DEFAULT 0,
        revoked_at     TEXT,
        revoked_reason TEXT,
        created_at     TEXT NOT NULL
      );
    `);
  }

  insert(pass: VisitPass, createdAtMs: number): void {
    this.db
      .prepare("INSERT INTO passes (pass_id, door, body, max_uses, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(pass.pass_id, pass.door, JSON.stringify(pass), pass.max_uses, new Date(createdAtMs).toISOString());
  }

  get(passId: string): PassRow | undefined {
    const r = this.db.prepare("SELECT * FROM passes WHERE pass_id = ?").get(passId) as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  all(): PassRow[] {
    return (this.db.prepare("SELECT * FROM passes ORDER BY created_at").all() as unknown as Raw[]).map(toRow);
  }

  /** Passes that could still be used today or later (not used up, not revoked, not expired). */
  active(nowMs: number): PassRow[] {
    return this.all().filter((p) => !p.revoked_at && p.uses < p.pass.max_uses && Date.parse(p.pass.not_after) >= nowMs);
  }

  /**
   * Find the pass a typed code belongs to, for a keypad or an agent that has
   * only a code. Only unexpired, unrevoked, unused passes for this door.
   */
  findByCode(door: Door, code: string, secret: string, nowMs: number): PassRow | undefined {
    return this.active(nowMs).find((p) => p.pass.door === door && passInWindow(p.pass, nowMs) && codeMatches(code, p.pass.code_hash, secret));
  }

  /**
   * Mark a pass used inside one transaction. Returns false when it was already
   * used or revoked, so a replayed or simultaneous request cannot use it twice.
   */
  consume(passId: string): boolean {
    const info = this.db
      .prepare("UPDATE passes SET uses = uses + 1 WHERE pass_id = ? AND uses < max_uses AND revoked_at IS NULL")
      .run(passId);
    return Number(info.changes) === 1;
  }

  /** Count a wrong code. Five wrong codes revoke the pass. Returns true when this call revoked it. */
  wrongCode(passId: string, nowMs: number): boolean {
    return transaction(this.db, () => {
      this.db.prepare("UPDATE passes SET wrong_codes = wrong_codes + 1 WHERE pass_id = ?").run(passId);
      const r = this.get(passId);
      if (r && !r.revoked_at && r.wrong_codes >= WRONG_CODE_LIMIT) {
        this.revoke(passId, `revoked after ${WRONG_CODE_LIMIT} wrong codes`, nowMs);
        return true;
      }
      return false;
    });
  }

  revoke(passId: string, reason: string, nowMs: number): void {
    this.db
      .prepare("UPDATE passes SET revoked_at = ?, revoked_reason = ? WHERE pass_id = ? AND revoked_at IS NULL")
      .run(new Date(nowMs).toISOString(), reason, passId);
  }
}
