// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Database types.
 *
 * The app is written against `Database`, a union of the real node-postgres
 * driver and PGlite. That union is the entire reason the backend is testable on
 * a machine with no Docker: tests inject PGlite (real Postgres, compiled to
 * WASM) and exercise the same SQL production runs.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { schema } from "./schema.ts";

type S = typeof schema;

type NodePgTransaction = Parameters<Parameters<NodePgDatabase<S>["transaction"]>[0]>[0];
type PgliteTransaction = Parameters<Parameters<PgliteDatabase<S>["transaction"]>[0]>[0];

export type Database = NodePgDatabase<S> | PgliteDatabase<S>;

/** Query-builder surface shared by a root database and a transaction callback.
 * Services that may participate in a larger atomic operation accept this type;
 * services that open a transaction themselves still require `Database`. */
export type DatabaseExecutor = Database | NodePgTransaction | PgliteTransaction;

/**
 * Normalises the result of a raw `db.execute()`.
 *
 * The two drivers disagree: PGlite returns `{ rows, fields, affectedRows }`
 * while node-postgres returns a `QueryResult`. Destructuring the result as an
 * array works on neither reliably and throws "not iterable" on PGlite.
 *
 * Prefer the query builder — it returns a plain array on both. Use this only
 * where raw SQL is genuinely required (e.g. `make_interval`, which has no
 * builder equivalent and whose calendar-month semantics we actually need).
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] })?.rows ?? [];
}
