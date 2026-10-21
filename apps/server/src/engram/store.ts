import { createRequire } from "node:module";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { quietSqliteWarning, transaction } from "../db.js";
import { canonicalJson, chainHash, GENESIS_HASH, trustOf, type ChainCheck, type Source, type Trust } from "mcp-streamable-guard";
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

/** A Ring event that means a person is at the door: a bell press, or motion with sub_type human. */
const PERSON_EVENT = `kind = 'input' AND source = 'ring' AND (json_extract(payload, '$.event.type') = 'button_press' OR (json_extract(payload, '$.event.type') = 'motion_detected' AND json_extract(payload, '$.event.sub_type') = 'human'))`;
const RING_EVENT = `kind = 'input' AND source = 'ring' AND json_extract(payload, '$.type') = 'ring_event'`;
const OUTSIDE_TEXT = `kind = 'input' AND trust = 'untrusted' AND json_type(payload, '$.outside_text') = 'array' AND json_array_length(payload, '$.outside_text') > 0`;

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
CREATE INDEX IF NOT EXISTS records_kind_event ON records (kind, t_event);
-- Targeted indexes for the guard's hot queries, so a busy or long-lived log stays fast.
CREATE INDEX IF NOT EXISTS records_rate ON records (json_extract(payload, '$.bucket'), t_event) WHERE kind = 'tool_call';
CREATE INDEX IF NOT EXISTS records_person ON records (t_event) WHERE ${PERSON_EVENT};
CREATE INDEX IF NOT EXISTS records_ring ON records (t_event) WHERE ${RING_EVENT};
CREATE INDEX IF NOT EXISTS records_ring_id ON records (json_extract(payload, '$.event.event_id')) WHERE ${RING_EVENT};
DROP INDEX IF EXISTS records_outside;
CREATE INDEX IF NOT EXISTS records_outside_text ON records (t_event) WHERE ${OUTSIDE_TEXT};
CREATE INDEX IF NOT EXISTS records_decision_id ON records (json_extract(payload, '$.decision_id'));
CREATE INDEX IF NOT EXISTS records_pass_id ON records (json_extract(payload, '$.pass_id')) WHERE kind = 'effect';
CREATE INDEX IF NOT EXISTS records_decisions ON records (id) WHERE kind = 'decision';
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
  private insert: StatementSync;
  private last: StatementSync;
  private appendTx: (input: AppendInput) => EngramRecord;
  private stmts = new Map<string, StatementSync>();

  /**
   * Prepared statements are cached: preparing on every call was a measurable cost under load.
   * Hot queries name their partial index (INDEXED BY): without ANALYZE statistics SQLite
   * otherwise preferred the generic (kind, t_event) index and scanned the whole time window.
   */
  private q(sql: string): StatementSync {
    let st = this.stmts.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.stmts.set(sql, st);
    }
    return st;
  }

  constructor(
    readonly db: DatabaseSync,
    private clock: Clock,
    private bus?: Bus,
  ) {
    db.exec(SCHEMA);
    this.insert = db.prepare(
      "INSERT INTO records (id, kind, source, trust, payload, t_event, t_known, prev_hash, hash) VALUES (@id, @kind, @source, @trust, @payload, @t_event, @t_known, @prev_hash, @hash)",
    );
    this.last = db.prepare("SELECT id, hash FROM records ORDER BY id DESC LIMIT 1");
    this.appendTx = (input: AppendInput) => transaction(db, () => {
      const prev = this.last.get() as unknown as { id: number; hash: string } | undefined;
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
      this.insert.run({ ...body, payload: canonicalJson(body.payload), prev_hash, hash } as Record<string, string | number>);
      return { ...body, prev_hash, hash } as EngramRecord;
    });
  }

  append(input: AppendInput): EngramRecord {
    const rec = this.appendTx(input);
    this.bus?.publish({ type: "record", record: rec });
    return rec;
  }

  all(): EngramRecord[] {
    return (this.q("SELECT * FROM records ORDER BY id").all() as unknown as Row[]).map(fromRow);
  }

  count(): number {
    return Number((this.q("SELECT COUNT(*) AS n FROM records").get() as { n: number }).n);
  }

  tail(n: number): EngramRecord[] {
    return (this.q("SELECT * FROM (SELECT * FROM records ORDER BY id DESC LIMIT ?) ORDER BY id").all(n) as unknown as Row[]).map(fromRow);
  }

  get(id: number): EngramRecord | undefined {
    const r = this.q("SELECT * FROM records WHERE id = ?").get(id) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Exactly what HomePulse knew at time T: every record with t_known <= T. */
  asOf(tMs: number): EngramRecord[] {
    const T = new Date(tMs).toISOString();
    return (this.q("SELECT * FROM records WHERE t_known <= ? ORDER BY id").all(T) as unknown as Row[]).map(fromRow);
  }

  /** The most recent `limit` records known at time T (for the console's as-of view). */
  asOfTail(tMs: number, limit: number): EngramRecord[] {
    const T = new Date(tMs).toISOString();
    return (this.q("SELECT * FROM (SELECT * FROM records WHERE t_known <= ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(T, limit) as unknown as Row[]).map(fromRow);
  }

  /** Records whose t_event falls in [fromMs, toMs] and that were known by toMs. */
  eventsBetween(fromMs: number, toMs: number, kind?: RecordKind, source?: Source): EngramRecord[] {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    let sql = "SELECT * FROM records WHERE t_event >= ? AND t_event <= ? AND t_known <= ?";
    const params: string[] = [a, b, b];
    if (kind) {
      sql += " AND kind = ?";
      params.push(kind);
    }
    if (source) {
      sql += " AND source = ?";
      params.push(source);
    }
    sql += " ORDER BY id";
    return (this.q(sql).all(...params) as unknown as Row[]).map(fromRow);
  }

  /** Physical requests from one caller bucket in [fromMs, toMs], known by toMs, not counting record `excludeId`. */
  countPhysicalCalls(bucket: string, fromMs: number, toMs: number, excludeId = -1): number {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    const r = this.q(
      "SELECT COUNT(*) AS n FROM records INDEXED BY records_rate WHERE kind = 'tool_call' AND json_extract(payload, '$.bucket') = ? AND t_event >= ? AND t_event <= ? AND t_known <= ? AND json_extract(payload, '$.physical') = 1 AND id != ?",
    ).get(bucket, a, b, b, excludeId) as { n: number };
    return Number(r.n);
  }

  /** The latest Ring event meaning a person is at the door, in [fromMs, toMs] and known by toMs. */
  latestPersonEvent(fromMs: number, toMs: number): EngramRecord | undefined {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    const r = this.q(`SELECT * FROM records INDEXED BY records_person WHERE ${PERSON_EVENT} AND t_event >= ? AND t_event <= ? AND t_known <= ? ORDER BY t_event DESC, id DESC LIMIT 1`).get(a, b, b) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Ring events in [fromMs, toMs], newest `limit`, oldest first. */
  ringEvents(fromMs: number, toMs: number, limit: number): EngramRecord[] {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    return (this.q(`SELECT * FROM (SELECT * FROM records INDEXED BY records_ring WHERE ${RING_EVENT} AND t_event >= ? AND t_event <= ? AND t_known <= ? ORDER BY t_event DESC, id DESC LIMIT ?) ORDER BY t_event, id`).all(a, b, b, limit) as unknown as Row[]).map(fromRow);
  }

  findRingEvent(eventId: string): EngramRecord | undefined {
    const r = this.q(`SELECT * FROM records INDEXED BY records_ring_id WHERE ${RING_EVENT} AND json_extract(payload, '$.event.event_id') = ? ORDER BY id DESC LIMIT 1`).get(eventId) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Untrusted outside text recorded in [fromMs, toMs] (newest `limit` records). Explanation only. */
  outsideTexts(fromMs: number, toMs: number, limit = 200): string[] {
    const a = new Date(fromMs).toISOString();
    const b = new Date(toMs).toISOString();
    const rows = this.q(`SELECT json_extract(payload, '$.outside_text') AS t FROM records INDEXED BY records_outside_text WHERE ${OUTSIDE_TEXT} AND t_event >= ? AND t_event <= ? AND t_known <= ? ORDER BY t_event DESC LIMIT ?`).all(a, b, b, limit) as Array<{ t: string }>;
    const out: string[] = [];
    for (const r of rows) {
      try {
        for (const s of JSON.parse(r.t) as unknown[]) if (typeof s === "string" && s.trim()) out.push(s);
      } catch {
        /* not an array of strings */
      }
    }
    return out;
  }

  findDecision(decisionId: string, knownBy?: number): EngramRecord | undefined {
    // ISO strings compare as text; years past 9999 get a "+" prefix and would sort first, so use a fixed ceiling.
    const T = knownBy === undefined ? "9999-12-31T23:59:59.999Z" : new Date(knownBy).toISOString();
    const r = this.q("SELECT * FROM records WHERE json_extract(payload, '$.decision_id') = ? AND kind = 'decision' AND t_known <= ? ORDER BY id DESC LIMIT 1").get(decisionId, T) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Records about one decision (approvals, effects), known by T. */
  aboutDecision(decisionId: string, knownBy: number): EngramRecord[] {
    const T = new Date(knownBy).toISOString();
    return (this.q("SELECT * FROM records WHERE json_extract(payload, '$.decision_id') = ? AND t_known <= ? ORDER BY id").all(decisionId, T) as unknown as Row[]).map(fromRow);
  }

  latestDecision(knownBy: number, allowedOnly = false): EngramRecord | undefined {
    const T = new Date(knownBy).toISOString();
    const sql = allowedOnly
      ? "SELECT * FROM records WHERE kind = 'decision' AND json_extract(payload, '$.allow') = 1 AND t_known <= ? ORDER BY id DESC LIMIT 1"
      : "SELECT * FROM records WHERE kind = 'decision' AND t_known <= ? ORDER BY id DESC LIMIT 1";
    const r = this.q(sql).get(T) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  passIssued(passId: string, knownBy: number): EngramRecord | undefined {
    const T = new Date(knownBy).toISOString();
    const r = this.q("SELECT * FROM records WHERE kind = 'effect' AND json_extract(payload, '$.pass_id') = ? AND json_extract(payload, '$.type') = 'pass_issued' AND t_known <= ? ORDER BY id DESC LIMIT 1").get(passId, T) as unknown as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Walk the chain one row at a time (constant memory, any log size). */
  verify(): ChainCheck {
    let prev = GENESIS_HASH;
    let count = 0;
    for (const raw of this.q("SELECT * FROM records ORDER BY id").iterate() as Iterable<unknown>) {
      const r = fromRow(raw as Row);
      count++;
      if (r.prev_hash !== prev) return { ok: false, count, brokenAt: r.id, index: count - 1, why: "prev_hash does not match the previous record's hash" };
      const { prev_hash: _p, hash: _h, ...body } = r;
      if (chainHash(r.prev_hash, body) !== r.hash) return { ok: false, count, brokenAt: r.id, index: count - 1, why: "record contents do not match its hash" };
      prev = r.hash;
    }
    return { ok: true, count, head: prev };
  }
}

export function openDatabase(file: string | ":memory:"): DatabaseSync {
  quietSqliteWarning();
  // Loaded lazily so the one-time ExperimentalWarning filter is already in place.
  const { DatabaseSync: Db } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new Db(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  return db;
}
