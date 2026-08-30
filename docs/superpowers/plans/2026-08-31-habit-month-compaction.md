# Habit-Month Compaction Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development. Do not deploy or apply a live migration.

**Goal:** Preserve every habit-log day permanently while reducing cloud row growth from one row per day to one bounded row per habit-month.

**Architecture:** IndexedDB and all UI code keep the existing per-day `HabitLog` shape. The sync engine packs dirty log rows into partial `habitMonths` records and expands pulled complete months back into ordinary local rows. Postgres stores one JSONB month row and merges each day by its own timestamp; other sync kinds retain the current generic LWW path.

**Tech stack:** TypeScript, Dexie, Zod, Fastify, Hono, Drizzle/Postgres, PGlite, Vitest.

## Global constraints

- No production deploy, live migration, PSP call, or destructive production action.
- `backend/src` is canonical; regenerate Edge shared code with `npm run sync:edge`.
- Do not change the in-memory `Db`, local IndexedDB table shapes, UI behavior, payment flow, or device-local settings.
- All daily history remains reconstructable. Month packets may be partial on push but are complete on pull.
- Same-day conflicts use cell `updatedAt`; different-day edits must both survive regardless of packet order.
- The request remains below 48 KiB client-side and 64 KiB server-side.

---

### Task 1: Define and validate the protocol-v2 habit-month contract

**Files:**

- Create: `src/lib/sync/habit-month.ts`
- Create: `src/lib/sync/habit-month.test.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/services/sync-record-validation.ts`
- Modify: `backend/test/sync-record-validation.test.ts`

- [ ] Write failing tests for canonical month IDs, packing multiple days, bounded packet splitting, UTF-8 sizing, expansion, invalid month/day mismatches, more than 31 cells, tombstones, and malformed cell payloads.
- [ ] Implement the client pure pack/expand helpers.
- [ ] Replace cloud kind `logs` with `habitMonths` and add a strict server schema for partial month packets.
- [ ] Run the focused frontend and backend validator tests.
- [ ] Commit the contract unit.

### Task 2: Pack the client outbox and expand remote months

**Files:**

- Modify: `src/lib/api/sync.ts`
- Modify: `src/lib/sync/engine.ts`
- Modify: `src/lib/sync/engine.test.ts`
- Modify: `src/lib/sync/merge.ts`
- Modify: `src/lib/sync/merge.test.ts`

- [ ] Write failing tests proving dirty daily logs become month packets, accepted cells clear independently, rejected packets stay dirty, remote months expand into daily rows, deleted months clear only their local month, and concurrent newer edits remain dirty.
- [ ] Introduce outgoing packets with explicit source rows; chunk by actual UTF-8 bytes and never put duplicate month keys in one request.
- [ ] Expand `habitMonths` before the existing local LWW merge. Keep `logs` local-only and refuse raw cloud logs.
- [ ] Add required `protocolVersion: 2` to exchange requests.
- [ ] Run focused client tests and commit.

### Task 3: Merge month cells atomically on the server

**Files:**

- Modify: `backend/src/services/sync.ts`
- Modify: `backend/test/sync.test.ts`
- Modify: `backend/test/concurrency.test.ts`

- [ ] Write failing integration tests for different-day merge in both orders, same-day LWW, idempotent replay, partial packets, month tombstone precedence, and habit-delete cascade over month rows.
- [ ] Extend the single atomic upsert so `habitMonths` merges only incoming cells newer than the stored cell while ordinary kinds keep row-level LWW.
- [ ] Ensure one server sequence change per changed month packet and no sequence churn for fully stale replays.
- [ ] Run focused backend tests and commit.

### Task 4: Final schema, migration, adapters, and capacity evidence

**Files:**

- Modify: `backend/src/db/ddl.ts`
- Create: `supabase/migrations/20260831120000_compact_habit_logs_by_month.sql`
- Modify: `backend/src/routes/sync.ts`
- Modify: `supabase/functions/api/routes/sync.ts`
- Modify: relevant backend/Edge/quota tests
- Modify: affected `docs-fa/` guides

- [ ] Require `protocolVersion: 2` in both HTTP adapters and update all test clients.
- [ ] Add a data-preserving migration that converts legacy `logs` into `habitMonths`, advances per-user cursors safely, and tightens the kind constraint.
- [ ] Update fresh-install DDL and regenerate `supabase/setup.sql`; add migration/DDL tests.
- [ ] Re-measure the quota fixture so it proves row growth is monthly rather than daily.
- [ ] Run `npm run sync:edge`, all frontend/backend/Edge tests, both typechecks, lint, build, diff checks, and generated parity checks.
- [ ] Update only the affected Persian documentation and commit.
