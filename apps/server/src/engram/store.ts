import Database from "better-sqlite3";
import { canonicalJson, chainHash, GENESIS_HASH, trustOf, verifyChain, type ChainCheck, type ChainedRecord, type Source, type Trust } from "mcp-streamable-guard";
import type { Bus } from "../bus.js";
import type { Clock } from "../clock.js";

export type RecordKind = "input" | "tool_call" | "decision" | "effect" | "alert";

export interface EngramRecord {
  id: number;
  kind: RecordKind;
  source: Source;
  trust: Trust;
  payload: Record<string, unknown>;
  /** When it happened in the world (UTC ISO). */
  t_event: string;
  /** When HomePulse recorded it (UTC ISO). */
  t_known: string;
  prev_hash: string;
  hash: string;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT NOT NULL,      -- input | tool_call | decision | effect | alert
  source    TEXT NOT NULL,      -- homeowner | caregiver | system | agent | ring | visitor
  trust     TEXT NOT NULL,      -- trusted | untrusted
  payload   TEXT NOT NULL,      -- canonical JSON
  t_event   TEXT NOT NULL,      -- when it happened in the world
  t_known   TEXT NOT NULL,      -- when HomePulse recorded it
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS records_known ON records (t_known);
-- No UPDATE or DELETE on records anywhere in the code; corrections are new records.
`;

interface Row {
  id: number;
  kind: string;
  source: string;
  trust: string;
  payload: string;
  t_event: string;
  t_known: string;
  prev_hash: string;
  hash: string;
}

function fromRow(r: Row): EngramRecord {
  return { ...r, kind: r.kind as RecordKind, source: r.source as Source, trust: r.trust as Trust, payload: JSON.parse(r.payload) };
}

export interface AppendInput {
  kind: RecordKind;
  source: Source;
  payload: Record<string, unknown>;
  /** Defaults to now. A caregiver note written earlier and synced later carries its own t_event. */
  t_event?: number;
}

/**
 * Engram: an append-only, hash-chained log that answers "why did the door
 * open, or not?" using only what HomePulse knew at that moment.
 */
export class Engram {
  private insert: Database.Statement;
  private last: Database.Statement;
  private appendTx: (input: AppendInput) => EngramRecord;

  constructor(
    readonly db: Database.Database,
    private clock: Clock,
    private bus?: Bus,
  ) {
    db.exec(SCHEMA);
    this.insert = db.prepare(
      "INSERT INTO records (id, kind, source, trust, payload, t_event, t_known, prev_hash, hash) VALUES (@id, @kind, @source, @trust, @payload, @t_event, @t_known, @prev_hash, @hash)",
    );
    this.last = db.prepare("SELECT id, hash FROM records ORDER BY id DESC LIMIT 1");
    this.appendTx = db.transaction((input: AppendInput) => {
      const prev = this.last.get() as { id: number; hash: string } | undefined;
      const now = this.clock.now();
      const body = {
        id: (prev?.id ?? 0) + 1,
        kind: input.kind,
        source: input.source,
        trust: trustOf(input.source),
        payload: JSON.parse(canonicalJson(input.payload)) as Record<string, unknown>,
        t_event: new Date(input.t_event ?? now).toISOString(),
        t_known: new Date(now).toISOString(),
      };
      const prev_hash = prev?.hash ?? GENESIS_HASH;
      const hash = chainHash(prev_hash, body);
      this.insert.run({ ...body, payload: canonicalJson(body.payload), prev_hash, hash });
      return { ...body, prev_hash, hash } as EngramRecord;
    });
  }

  append(input: AppendInput): EngramRecord {
    const rec = this.appendTx(input);
    this.bus?.publish({ type: "record", record: rec });
    return rec;
  }

  all(): EngramRecord[] {
    return (this.db.prepare("SELECT * FROM records ORDER BY id").all() as Row[]).map(fromRow);
  }

  tail(n: number): EngramRecord[] {
    return (this.db.prepare("SELECT * FROM (SELECT * FROM records ORDER BY id DESC LIMIT ?) ORDER BY id").all(n) as Row[]).map(fromRow);
  }

  get(id: number): EngramRecord | undefined {
    const r = this.db.prepare("SELECT * FROM records WHERE id = ?").get(id) as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Exactly what HomePulse knew at time T: every record with t_known <= T. */
  asOf(tMs: number): EngramRecord[] {
    const T = new Date(tMs).toISOString();
    return (this.db.prepare("SELECT * FROM records WHERE t_known <= ? ORDER BY id").all(T) as Row[]).map(fromRow);
  }

  /** Records whose t_event falls in [fromMs, toMs] and that were known by toMs. */
  eventsBetween(fromMs: number, toMs: number, kind?: RecordKind, source?: Source): EngramRecord[] {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    let sql = "SELECT * FROM records WHERE t_event >= ? AND t_event <= ? AND t_known <= ?";
    const params: unknown[] = [a, b, b];
    if (kind) {
      sql += " AND kind = ?";
      params.push(kind);
    }
    if (source) {
      sql += " AND source = ?";
      params.push(source);
    }
    sql += " ORDER BY id";
    return (this.db.prepare(sql).all(...params) as Row[]).map(fromRow);
  }

  findDecision(decisionId: string): EngramRecord | undefined {
    const r = this.db
      .prepare("SELECT * FROM records WHERE kind = 'decision' AND json_extract(payload, '$.decision_id') = ? ORDER BY id DESC LIMIT 1")
      .get(decisionId) as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  verify(): ChainCheck {
    return verifyChain(this.all() as unknown as ChainedRecord[]);
  }
}

export function openDatabase(file: string | ":memory:"): Database.Database {
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  return db;
}
