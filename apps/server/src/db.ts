import type { DatabaseSync } from "node:sqlite";

/** BEGIN IMMEDIATE ... COMMIT around fn; rolls back on any error. Nested calls join the outer transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

let quieted = false;
/** Node's built-in SQLite prints an ExperimentalWarning once; keep the console clean, pass every other warning through. */
export function quietSqliteWarning(): void {
  if (quieted) return;
  quieted = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const msg = typeof warning === "string" ? warning : warning?.message;
    if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) return;
    return (original as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
