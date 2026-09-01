# Task Archive and Annual Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every task indefinitely while transparently compacting cold completed tasks and limiting each account to 10 MiB of positive sync-data growth per account-owned 365-day period.

**Architecture:** Clients continue to send and receive ordinary `tasks` under sync protocol v2. PostgreSQL stores cold completed tasks in immutable internal `taskMonths` rows; archive-aware pull code expands them before returning a response. Annual usage is constant-size state on `users` and is reserved atomically inside the existing push SQL, so normal sync remains one request and internal compaction does not consume the user's allowance.

**Tech Stack:** TypeScript 5, Fastify, Hono/Supabase Edge, Drizzle SQL templates, PostgreSQL 17/PGlite, pg_cron, Dexie, Vitest.

## Global Constraints

- Existing production content is grandfathered and annual usage starts at zero at migration time.
- Annual positive growth is exactly `10 * 1024 * 1024` bytes per account-owned 365-day period.
- The existing 50,000 cloud-row cap remains; the 128 MiB lifetime byte ceiling is removed while the exact non-negative lifetime byte counter remains.
- Only completed tasks whose calendar month ended at least seven days ago and whose last modification is at least seven days old are eligible.
- Incomplete tasks, journals, timer sessions, and habit history are never archived by this release.
- Clients never send or receive raw `taskMonths`; protocol version remains 2.
- One archive chunk must fit completely after expansion under the 512 KiB pull-response ceiling.
- Archives are immutable. Later task edits/deletes remain ordinary newer `tasks` overrides.
- No polling, public endpoint, Edge invocation, R2 dependency, queue, or append-only usage ledger is added.
- `backend/src` is canonical; never hand-edit `supabase/functions/api/shared/`.
- Every production mutation requires a verified backup, restored dry-run, bounded canary, and separate production approval.

---

## File Structure

- Create `backend/src/services/task-month-archive.ts`: versioned internal archive types, strict decoder, expansion, and response-byte measurement.
- Create `backend/test/task-month-archive.test.ts`: lossless codec and malformed-version tests.
- Modify `backend/src/db/schema.ts`: separate client-accepted sync kinds from database-stored kinds.
- Modify `backend/src/services/sync.ts`: atomic annual reservation, per-record quota rejection metadata, and archive-aware byte-bounded pull.
- Modify `backend/src/services/sync-record-validation.ts`: add optional quota retry metadata without accepting the internal kind.
- Modify `backend/test/sync.test.ts`: API compatibility, quota, override, pagination, and isolation tests.
- Modify `backend/test/sync-budget.test.ts`: exact lifetime and annual counter tests.
- Modify `backend/src/db/ddl.ts`: new DB-only annual fields, constraints, internal kind, and bounded compaction function.
- Modify `backend/test/launch-ddl.test.ts`: fresh bootstrap and old-schema expand compatibility tests.
- Create `backend/test/task-compaction.test.ts`: transactional compactor, rollback, retry, concurrency, and inverse reconstruction tests.
- Create `supabase/migrations/20260901150000_task_archive_quota_expand.sql`: internal-kind allowance, annual fields, and lifetime-limit loosening.
- Create `supabase/migrations/20260901151000_task_month_compactor.sql`: bounded archive function without enabling its production schedule.
- Modify `scripts/gen-setup-sql.mjs`: idempotent bounded pg_cron schedule.
- Modify `scripts/sync-edge-shared.mjs`: copy the new canonical archive module.
- Regenerate `supabase/setup.sql` and `supabase/functions/api/shared/` with repository scripts.
- Modify `src/lib/api/sync.ts`: optional `retryAt` on quota rejections.
- Modify `src/lib/db/dexie.ts`: persistent `dirty: 2` quota-blocked state and `quotaRetryAt` cursor metadata.
- Modify `src/lib/sync/engine.ts`: stop retrying the exact rejected version until its period resets.
- Modify `src/lib/sync/engine.test.ts`: quota-block lifecycle tests.
- Modify `supabase/tests/sync.test.ts` and `supabase/tests/quota.test.ts`: Edge parity plus realistic task-history capacity evidence.
- Create `supabase/manual-production/20260901_task_archive_precheck.sql`: secret-safe invariant/count/hash precheck.
- Create `supabase/manual-production/20260901_task_archive_postcheck.sql`: canary and rollout invariant checks.
- Create `supabase/manual-production/20260901_task_archive_restore.sql`: inverse archive expansion for an approved recovery.
- Modify `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, and `docs-fa/CODEBASE_GUIDE.md`: active storage, quota, retry, and rollout contracts.

---

### Task 1: Versioned Lossless Archive Codec and Kind Boundary

**Files:**
- Create: `backend/src/services/task-month-archive.ts`
- Create: `backend/test/task-month-archive.test.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/services/sync-record-validation.ts`
- Test: `backend/test/sync-record-validation.test.ts`

**Interfaces:**
- Consumes: existing ordinary task envelopes `{ kind: "tasks", id, data, updatedAt, deleted, seq }`.
- Produces: `TASK_MONTH_ARCHIVE_KIND`, `TaskMonthArchiveV1`, `isTaskMonthArchiveKind(kind)`, and `expandTaskMonthArchive(record): ArchivedTaskPullRecord[]`.
- Invariant: `SYNC_KINDS` remains the client allow-list; `STORED_SYNC_KINDS` includes the internal archive kind only for the database check.

- [ ] **Step 1: Write failing codec and boundary tests**

```ts
const archive = {
  kind: "taskMonths",
  id: "2026-01|0001",
  data: {
    v: 1,
    monthKey: "2026-01",
    count: 2,
    checksum: "9a17d18c4f06c7b86034020c9714db8b",
    items: [
      ["t-1", 1000, task("t-1", "2026-01-02", "الف")],
      ["t-2", 2000, task("t-2", "2026-01-03", "ب")],
    ],
  },
  updatedAt: 2000,
  deleted: false,
  seq: 9,
};

expect(expandTaskMonthArchive(archive)).toEqual([
  { kind: "tasks", id: "t-1", data: task("t-1", "2026-01-02", "الف"), updatedAt: 1000, deleted: false, seq: 9 },
  { kind: "tasks", id: "t-2", data: task("t-2", "2026-01-03", "ب"), updatedAt: 2000, deleted: false, seq: 9 },
]);
expect(() => expandTaskMonthArchive({ ...archive, data: { ...archive.data, v: 2 } })).toThrow("unsupported_task_archive_version");
expect(validateSyncRecord({ ...archive, seq: undefined } as never)).toMatchObject({ ok: false, code: "bad_kind" });
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
cd backend
npx vitest run test/task-month-archive.test.ts test/sync-record-validation.test.ts --maxWorkers=1
```

Expected: failure because the archive module and stored-kind boundary do not exist.

- [ ] **Step 3: Add the minimal strict archive module**

```ts
export const TASK_MONTH_ARCHIVE_KIND = "taskMonths" as const;
export const TASK_MONTH_ARCHIVE_VERSION = 1 as const;

export interface TaskMonthArchiveV1 {
  v: 1;
  monthKey: string;
  count: number;
  checksum: string;
  items: [id: string, updatedAt: number, data: unknown][];
}

export interface StoredTaskMonthRecord {
  kind: "taskMonths";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface ArchivedTaskPullRecord {
  kind: "tasks";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: false;
  seq: number;
}

export function isTaskMonthArchiveKind(kind: string): kind is "taskMonths" {
  return kind === TASK_MONTH_ARCHIVE_KIND;
}
```

Validate `v`, `monthKey`, archive id prefix, `count`, 32-character lowercase checksum, item tuple length, task id, integer `updatedAt`, complete task payload, unique item ids, and item `dateKey` month before returning ordinary task envelopes. Reuse the canonical task schema by exporting a `validateTaskPayload(id, data)` helper from `sync-record-validation.ts`; do not duplicate task limits.

- [ ] **Step 4: Split client kinds from stored kinds**

```ts
export const SYNC_KINDS = [
  "categories", "habits", "habitMonths", "tasks", "timerSessions", "journal",
] as const;
export const STORED_SYNC_KINDS = [...SYNC_KINDS, "taskMonths"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];
export type StoredSyncKind = (typeof STORED_SYNC_KINDS)[number];
```

Keep `validateSyncRecord()` bound to `SYNC_KINDS`. Change only the Drizzle `records_kind_valid` expression to include `taskMonths`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
cd backend
npx vitest run test/task-month-archive.test.ts test/sync-record-validation.test.ts --maxWorkers=1
npm run typecheck
```

Expected: all selected tests pass and TypeScript reports zero errors.

- [ ] **Step 6: Commit the codec boundary**

```powershell
git add backend/src/services/task-month-archive.ts backend/test/task-month-archive.test.ts backend/src/db/schema.ts backend/src/services/sync-record-validation.ts backend/test/sync-record-validation.test.ts
git commit -m "feat: add lossless task archive codec"
```

---

### Task 2: Archive-Aware Byte-Bounded Pull

**Files:**
- Modify: `backend/src/services/sync.ts`
- Modify: `backend/test/sync.test.ts`

**Interfaces:**
- Consumes: `expandTaskMonthArchive()` from Task 1.
- Produces: `expandStoredPullRecord(record): PullRecord[]` and `selectPullPage(candidates, safeLimit, byteBudget): PullResult` as deterministic helpers used by Fastify and generated Edge code.

- [ ] **Step 1: Add failing pull compatibility tests**

Add tests that directly seed an internal archive plus a newer ordinary override and assert:

```ts
expect(body.records).toEqual([
  expect.objectContaining({ kind: "tasks", id: "t-archived", updatedAt: 1000 }),
  expect.objectContaining({ kind: "tasks", id: "t-archived", updatedAt: 2000, deleted: true }),
]);
expect(body.records.some((row) => row.kind === "taskMonths")).toBe(false);
expect(Buffer.byteLength(response.body, "utf8")).toBeLessThanOrEqual(PULL_RESPONSE_MAX_UTF8_BYTES);
```

Also cover a fresh cursor, an existing cursor, multiple bounded chunks, a version-2 archive, cross-account isolation, and a page where the next archive does not fit.

Because this task runs before the production expand migration, its database fixture installs only the future kind constraint before seeding an archive:

```sql
alter table records drop constraint records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));
```

- [ ] **Step 2: Run the focused sync test and verify RED**

Run:

```powershell
cd backend
npx vitest run test/sync.test.ts -t "task archive" --maxWorkers=1
```

Expected: raw `taskMonths` is returned or the new internal kind cannot be inserted.

- [ ] **Step 3: Replace raw-SQL byte accounting with bounded candidate selection**

Keep the SQL query bounded to `safeLimit` stored rows and ordered by `seq`. Map each candidate through:

```ts
export function expandStoredPullRecord(record: PullRecord): PullRecord[] {
  return isTaskMonthArchiveKind(record.kind)
    ? expandTaskMonthArchive(record as StoredTaskMonthRecord)
    : [record];
}
```

Build the final page by stored row, not by expanded item:

```ts
for (const stored of candidates) {
  const expanded = expandStoredPullRecord(stored);
  const nextBytes = utf8Bytes(JSON.stringify(expanded)) + 1;
  if (selectedStoredRows > 0 && (publicRecords.length + expanded.length > safeLimit || usedBytes + nextBytes > PULL_RECORDS_BYTE_BUDGET)) break;
  if (nextBytes > PULL_RECORDS_BYTE_BUDGET) throw new Error("task_archive_chunk_exceeds_pull_budget");
  publicRecords.push(...expanded);
  usedBytes += nextBytes;
  selectedStoredRows += 1;
  cursor = stored.seq;
}
```

The database `exists` check plus unselected candidates determines `hasMore`. Never advance past a stored archive row unless every expanded item from that row is returned.

- [ ] **Step 4: Verify malformed/unknown archives fail closed**

Run:

```powershell
cd backend
npx vitest run test/sync.test.ts -t "task archive|UTF-8 bytes|pages a large history" --maxWorkers=1
```

Expected: all selected tests pass; an unsupported archive returns a server error and leaves the caller's cursor unchanged.

- [ ] **Step 5: Run the complete backend sync suite**

Run:

```powershell
cd backend
npx vitest run test/sync.test.ts test/task-month-archive.test.ts --maxWorkers=1
```

Expected: all tests pass, including habit-month merging and tombstone reset.

- [ ] **Step 6: Commit archive-aware pull**

```powershell
git add backend/src/services/sync.ts backend/test/sync.test.ts
git commit -m "feat: expand task archives during sync pull"
```

---

### Task 3: Backward-Compatible Annual Fields and Atomic 10 MiB Growth Reservation

**Files:**
- Modify: `backend/src/services/sync.ts`
- Modify: `backend/src/services/sync-record-validation.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/test/sync.test.ts`
- Modify: `backend/test/sync-budget.test.ts`
- Modify: `backend/test/launch-ddl.test.ts`
- Create: `supabase/migrations/20260901150000_task_archive_quota_expand.sql`

**Interfaces:**
- Produces DB-only `users.sync_growth_period_started_at` and `users.sync_growth_bytes` before the push implementation consumes them.
- Produces: per-record `{ kind, id, updatedAt, code: "account_quota_exceeded", retryAt }` rejections and atomic reservation of positive final JSON growth.
- Normal-path database round trips remain one push statement plus the existing pull.

- [ ] **Step 1: Add failing annual-budget tests**

Cover these exact cases:

```ts
expect(exactlyTenMiB.applied).toBe(1);
expect(oneByteBeyond.rejectedRecords[0]).toMatchObject({
  code: "account_quota_exceeded",
  retryAt: Date.parse("2027-09-01T00:00:00.000Z"),
});
expect(shrinkAtCeiling.applied).toBe(1);
expect(deleteAtCeiling.applied).toBe(1);
expect(deleteThenRecreate.rejectedRecords[0]?.code).toBe("account_quota_exceeded");
```

Add a concurrency test using two database connections that submit the last available bytes simultaneously; exactly one succeeds and `sync_growth_bytes <= 10485760` always holds. Add a fixed-clock test that resets once after 365 days and not one millisecond before.

- [ ] **Step 2: Run budget tests and verify RED**

Run:

```powershell
cd backend
npx vitest run test/sync-budget.test.ts test/sync.test.ts -t "annual|quota|concurrent" --maxWorkers=1
```

Expected: missing annual columns/retry metadata and the current all-or-nothing batch behavior fail.

- [ ] **Step 3: Add the compatible annual fields and expand migration**

Add the fields only to raw DDL/migration, not the broad Drizzle `users` projection:

```sql
alter table users add column if not exists
  sync_growth_period_started_at timestamptz not null default now();
alter table users add column if not exists
  sync_growth_bytes bigint not null default 0;

alter table users drop constraint if exists users_sync_data_bytes_bounds;
alter table users add constraint users_sync_data_bytes_nonnegative
  check (sync_data_bytes >= 0);
alter table users add constraint users_sync_growth_bytes_bounds
  check (sync_growth_bytes between 0 and 10485760);
```

Extend `records_kind_valid` to include internal `taskMonths`. Existing rows are not rewritten, and existing accounts retain `sync_growth_bytes = 0`.

- [ ] **Step 4: Refactor the existing push CTE to calculate final stored values once**

Add CTEs in this order:

```sql
incoming -> cascaded -> deduped -> current_state -> prepared -> ranked -> accepted -> budget_rejected -> sized -> bump -> upserted
```

`prepared` must compute the same final data that the upsert stores, including the complete merged `habitMonths` payload. It also computes:

```sql
greatest(
  coalesce(octet_length(final_data::text), 0) -
  coalesce(octet_length(existing.data::text), 0),
  0
)::bigint as positive_growth
```

Stale LWW rows have `will_apply = false`, consume zero allowance, and remain `skipped`, not quota-rejected. Tombstones consume zero data bytes. Rank `will_apply` rows in deterministic incoming order and accept the rows whose cumulative positive growth fits the remaining allowance.

- [ ] **Step 5: Reserve bytes and sequence numbers under the same user-row lock**

`current_state` locks the owner row. `bump` atomically resets an expired period, adds only accepted positive growth, and increments `seq` only by accepted stored changes:

```sql
update users u
   set seq = u.seq + accepted.total,
       sync_growth_period_started_at = period.period_start,
       sync_growth_bytes = period.base_used + accepted.positive_growth
  from accepted_totals accepted cross join effective_period period
 where u.id = $user_id
 returning u.seq, u.sync_growth_period_started_at + interval '365 days' as retry_at
```

Return a bounded JSON array from `budget_rejected`; never return payload data. Merge these rows with validator rejections in `PushResult`.

- [ ] **Step 6: Preserve existing account-cap error behavior**

Set `SYNC_QUOTA_CONSTRAINTS` to exactly `users_sync_record_count_bounds` and `users_sync_growth_bytes_bounds`. The lifetime nonnegative constraint signals an accounting defect and must remain a 500 rather than being mislabeled as user quota. Retain the postgres-js `constraint_name` contract. A 50,000-row constraint failure may still roll back the whole physical statement, but it must return bounded `account_quota_exceeded` metadata and the pull must continue.

- [ ] **Step 7: Run annual, bootstrap, habit-month, and cross-driver tests**

Run:

```powershell
cd backend
npx vitest run test/launch-ddl.test.ts test/sync-budget.test.ts test/sync.test.ts test/concurrency.test.ts --maxWorkers=1
npm run typecheck
```

Expected: all pass; different-day habit-month merges remain lossless and equal replays do not consume growth.

- [ ] **Step 8: Commit annual quota behavior**

```powershell
git add backend/src/services/sync.ts backend/src/services/sync-record-validation.ts backend/src/db/ddl.ts backend/test/sync.test.ts backend/test/sync-budget.test.ts backend/test/launch-ddl.test.ts supabase/migrations/20260901150000_task_archive_quota_expand.sql
git commit -m "feat: enforce annual sync growth allowance"
```

---

### Task 4: Bounded Transactional Compactor

**Files:**
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/test/launch-ddl.test.ts`
- Create: `backend/test/task-compaction.test.ts`
- Create: `supabase/migrations/20260901151000_task_month_compactor.sql`
- Modify: `scripts/gen-setup-sql.mjs`

**Interfaces:**
- Produces SQL function `routino_compact_task_months(p_now timestamptz, p_max_tasks integer)` returning `(owner_id uuid, month_key text, archived_tasks integer, archive_rows integer)`.
- Produces SQL predicate `routino_task_archive_candidate_valid(p_id text, p_data jsonb)` whose fixture corpus agrees with the canonical TypeScript task validator.
- Produces scheduled job name `routino-task-month-compaction`.

- [ ] **Step 1: Add failing compactor bootstrap tests**

Test the function on both schema paths:

```ts
// fresh bootstrap
await h.raw(SCHEMA_SQL);
expect(await columns("users")).toContain("sync_growth_bytes");

// archive-aware code on expanded schema
await h.raw(EXPAND_MIGRATION_SQL);
expect((await archiveAwarePull()).records.every((r) => r.kind !== "taskMonths")).toBe(true);
```

Assert installing the compactor function does not modify existing rows, sequence counters, or annual usage.

- [ ] **Step 2: Add failing compaction transaction tests**

Seed eligible completed tasks, recent completed tasks, incomplete tasks, Persian/emoji/max-size tasks, malformed legacy rows, and a newer override. Assert:

```ts
expect(result).toMatchObject({ archived_tasks: 32, archive_rows: expect.any(Number) });
expect(await semanticTasks(owner)).toEqual(before);
expect(await rawKindCount(owner, "tasks")).toBe(beforeGranular - 32);
expect(await rawKindCount(owner, "taskMonths")).toBeGreaterThan(0);
expect(await annualUsed(owner)).toBe(0);
```

Force a checksum mismatch and statement timeout; both must leave every selected source task present and no archive committed. Retry the same operation twice and assert no duplicate logical task.

- [ ] **Step 3: Implement deterministic bounded SQL compaction**

First implement `routino_task_archive_candidate_valid` to check JSON object type, exact allowed keys, `data.id = p_id`, a real ISO date, title length 1..256, type enum, finite non-negative numeric target/value, boolean done, bounded optional note/reminder/color/icon, optional unit enum, and at most 20 KiB JSON. Run the same valid/invalid fixture corpus through this SQL predicate and `validateTaskPayload`; every result must match.

The function then selects at most `greatest(1, least(p_max_tasks, 500))` eligible ordinary task rows with `FOR UPDATE SKIP LOCKED`. Eligibility uses UTC calendar strings and requires:

```sql
kind = 'tasks'
and deleted = false
and data->>'done' = 'true'
and routino_task_archive_candidate_valid(id, data)
and left(data->>'dateKey', 7) < to_char(p_now - interval '7 days', 'YYYY-MM')
and to_timestamp(updated_at / 1000.0) <= p_now - interval '7 days'
and not exists (
  select 1 from records a
  cross join lateral jsonb_array_elements(a.data->'items') item
  where a.user_id = source.user_id and a.kind = 'taskMonths' and item->>0 = source.id
)
```

Order by owner, month, id. Bound each archive chunk by 32 tasks and at most 96 KiB of estimated expanded envelopes. Derive archive ids from month plus `md5(string_agg(task_id, E'\\n' order by task_id))`; store `v`, `monthKey`, `count`, `checksum`, and ordered `[id, updatedAt, data]` tuples.

Within one transaction, lock the owner row, reserve one fresh `seq` per archive row, insert archives, reconstruct selected task tuples from the inserted JSON, compare ids/timestamps/payloads/count/checksum with `EXCEPT`, and delete only the verified source primary keys. Any discrepancy raises an exception before commit.

- [ ] **Step 4: Keep lifetime counters exact without annual double-counting**

Leave the existing statement-level insert/update/delete triggers responsible only for `sync_record_count` and `sync_data_bytes`. Annual usage is owned exclusively by authenticated push SQL from Task 3. The compactor's archive inserts and source deletes therefore update exact physical counters but never `sync_growth_bytes`.

- [ ] **Step 5: Add the low-impact database schedule**

Generate this Supabase-only cron entry:

```sql
select cron.schedule(
  'routino-task-month-compaction',
  '17 4 * * *',
  $$select * from routino_compact_task_months(now(), 500)$$
);
```

Make setup generation idempotent by unscheduling an existing same-name job before scheduling. A no-work run returns zero rows and performs no user-row update.

- [ ] **Step 6: Run migration and compactor tests**

Run:

```powershell
cd backend
npx vitest run test/launch-ddl.test.ts test/task-compaction.test.ts test/sync-budget.test.ts --maxWorkers=1
npm run typecheck
```

Expected: fresh bootstrap, old/new compatibility, compaction rollback, idempotency, counters, and period fields all pass.

- [ ] **Step 7: Commit DDL, migration, and compactor**

```powershell
git add backend/src/db/ddl.ts backend/test/launch-ddl.test.ts backend/test/task-compaction.test.ts supabase/migrations/20260901151000_task_month_compactor.sql scripts/gen-setup-sql.mjs
git commit -m "feat: add bounded task compaction migration"
```

---

### Task 5: Stop Quota Retry Storms Without Losing Local Data

**Files:**
- Modify: `src/lib/api/sync.ts`
- Modify: `src/lib/db/dexie.ts`
- Modify: `src/lib/sync/engine.ts`
- Modify: `src/lib/sync/engine.test.ts`

**Interfaces:**
- Consumes: optional rejection `retryAt` from Task 3.
- Produces: `dirty: 2` for the exact quota-rejected local version and `syncMeta.quotaRetryAt` for the owner.
- An ordinary edit writes `dirty: 1`, immediately unblocking that newer version.

- [ ] **Step 1: Add failing engine tests**

```ts
server.reject([{ kind: "tasks", id: "t1", updatedAt: 1000, code: "account_quota_exceeded", retryAt }]);
await syncNow(owner);
expect((await db.tasks.get("t1"))!.dirty).toBe(2);
expect(await hasPendingChanges()).toBe(false);

await persistEditedTask({ ...task, title: "نسخه جدید" }, 2000);
expect((await db.tasks.get("t1"))!.dirty).toBe(1);

clock.set(retryAt);
await syncNow(owner, { pullRequired: true });
expect(server.lastPushIds()).toContain("t1");
```

Also assert only the exact `(kind,id,updatedAt)` is blocked, account switching cannot reuse another owner's retry timestamp, and a rejection without `retryAt` is blocked only for the current run so old servers cannot wedge data forever.

- [ ] **Step 2: Run the focused engine tests and verify RED**

Run:

```powershell
npx vitest run src/lib/sync/engine.test.ts -t "quota" --maxWorkers=1
```

Expected: `dirty: 2` and `quotaRetryAt` are not yet supported.

- [ ] **Step 3: Extend local operational metadata without a Dexie version bump**

```ts
export interface RecordRow<T> {
  key: string;
  data: T | null;
  updatedAt: number;
  deleted: 0 | 1;
  dirty: 0 | 1 | 2;
  seq: number;
}

export interface SyncMetaRow {
  key: "cursor";
  owner: string | null;
  cursor: number;
  lastSyncedAt: number;
  quotaRetryAt?: number;
}
```

The stored values remain valid in the existing Dexie schema and dirty index; no IndexedDB table/index migration is needed.

- [ ] **Step 4: Block only exact rejected versions and wake them at reset**

After each response, group quota rejections by local table. In one Dexie transaction, re-read each row and set `dirty: 2` only when `updatedAt` still equals the rejected version. Persist the earliest valid `retryAt` for the current owner.

At the start of `collectOutbox`, when `quotaRetryAt <= Date.now()`, bulk-update current owner's `dirty: 2` rows to `dirty: 1`, clear `quotaRetryAt`, and continue through the existing chunker. Normal persistence already writes edited rows with `dirty: 1`, so an edit unblocks itself. If an older server omits `retryAt`, leave the row at `dirty: 1`; the current run does not resend that batch, while a later lifecycle sync remains able to recover.

- [ ] **Step 5: Verify retry and ordinary sync behavior**

Run:

```powershell
npx vitest run src/lib/sync/engine.test.ts src/lib/sync/merge.test.ts --maxWorkers=1
npx tsc --noEmit
```

Expected: quota tests pass; ordinary dirty clearing, account switching, reset, habit-month expansion, and offline retry stay green.

- [ ] **Step 6: Commit local quota backoff**

```powershell
git add src/lib/api/sync.ts src/lib/db/dexie.ts src/lib/sync/engine.ts src/lib/sync/engine.test.ts
git commit -m "fix: pause quota-rejected sync versions"
```

---

### Task 6: Edge Parity, Realistic Capacity Evidence, and Documentation

**Files:**
- Modify: `scripts/sync-edge-shared.mjs`
- Generate: `supabase/functions/api/shared/services/task-month-archive.ts`
- Generate: `supabase/functions/api/shared/services/sync.ts`
- Generate: `supabase/functions/api/shared/services/sync-record-validation.ts`
- Generate: `supabase/functions/api/shared/db/schema.ts`
- Generate: `supabase/functions/api/shared/db/ddl.ts`
- Generate: `supabase/setup.sql`
- Modify: `supabase/tests/sync.test.ts`
- Modify: `supabase/tests/quota.test.ts`
- Modify: `src/lib/analytics.test.ts`
- Modify: `src/lib/backup.test.ts`
- Modify: `src/components/tasks.test.tsx`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`

**Interfaces:**
- Produces byte-identical canonical/generated Edge behavior after the `.js` to `.ts` import transform.
- Produces measured rows/user-year, bytes/user-year, fresh-sync pages, expanded egress, and invocation count for the stated 15 habits + 10 tasks/day + 7 journal lines/day workload.

- [ ] **Step 1: Add the archive module to the generated dependency manifest**

```js
"services/task-month-archive.ts",
```

Keep the manifest-closure parity test green so every relative dependency of `sync.ts` is copied.

- [ ] **Step 2: Add failing Edge archive/quota tests**

Port the Fastify contract cases to `supabase/tests/sync.test.ts`: raw internal kind never appears, archived task plus newer override converges, expanded response stays byte-bounded, annual rejection includes `retryAt`, and postgres-js-shaped quota errors remain bounded.

- [ ] **Step 3: Replace the capacity fixture with the approved real workload**

For each synthetic account-year generate:

```ts
const HABITS_PER_USER = 15;
const TASKS_PER_DAY = 10;
const JOURNAL_LINES_PER_DAY = 7;
const ANNUAL_GROWTH_LIMIT = 10 * 1024 * 1024;
```

Store habits as bounded `habitMonths`, daily journal as one bounded day entry, and tasks as ordinary rows; run compaction; then report physical table+index bytes, raw records before/after, annual positive JSON growth, five-year first-sync pages/bytes, and two normal exchanges/day. Add a 20-year synthetic archive round-trip that compares every task id/timestamp/payload without requiring a 20-year physical load benchmark. Assert semantic task equality before/after and annual normal use below 10 MiB.

- [ ] **Step 4: Prove yearly analytics, search, and export are representation-neutral**

Use the same one-year task fixture before compaction and after archive expansion. Build two `Db` values that differ only by the origin of their identical ordinary task arrays and assert the actual local operations remain equal:

```ts
expect(afterDb.tasks).toEqual(beforeDb.tasks);
expect(afterDb.tasks.filter((task) => task.title.includes("مطالعه")))
  .toEqual(beforeDb.tasks.filter((task) => task.title.includes("مطالعه")));
expect(buildBackup(afterDb)).toEqual(buildBackup(beforeDb));
expect(dayScore(afterDb, "2026-09-01", "gregorian"))
  .toBe(dayScore(beforeDb, "2026-09-01", "gregorian"));
```

`dayScore` uses habits/logs rather than tasks, so this last assertion explicitly proves replacing task transport representation cannot perturb the annual analytics input. Keep production client code unchanged; these are compatibility tests, not a new client archive layer.

- [ ] **Step 5: Regenerate canonical artifacts**

Run:

```powershell
npm run sync:edge
node scripts/gen-setup-sql.mjs
```

Do not edit anything below `supabase/functions/api/shared/` manually.

- [ ] **Step 6: Run Edge and capacity tests**

Run:

```powershell
npm run test:edge -- --maxWorkers=1
```

Expected: all Edge tests pass; quota output prints measured capacity without asserting a marketing promise.

- [ ] **Step 7: Update Persian architecture documentation**

Document:

- `taskMonths` is internal-only and expands to ordinary `tasks` before API output;
- chart/search/export/offline remain local individual-task operations;
- annual accounting is 10 MiB positive JSON growth per account period, existing data grandfathered;
- `dirty: 2` is a local quota wait state, not data deletion;
- old completed-task compaction creates zero application requests;
- 128 MiB lifetime limit is removed, 50,000-row cap remains;
- deploy code first, then backup/dry-run/additive migration/canary, then cron.

- [ ] **Step 8: Commit generated parity, tests, and docs**

```powershell
git add scripts/sync-edge-shared.mjs supabase/functions/api/shared supabase/setup.sql supabase/tests/sync.test.ts supabase/tests/quota.test.ts src/lib/analytics.test.ts src/lib/backup.test.ts src/components/tasks.test.tsx docs-fa/02-BACKEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md docs-fa/CODEBASE_GUIDE.md
git commit -m "test: verify archived task scale and edge parity"
```

---

### Task 7: Recovery SQL and Full Local Release Gate

**Files:**
- Create: `supabase/manual-production/20260901_task_archive_precheck.sql`
- Create: `supabase/manual-production/20260901_task_archive_postcheck.sql`
- Create: `supabase/manual-production/20260901_task_archive_restore.sql`
- Test: all source and generated suites

**Interfaces:**
- Precheck returns counts and hashes only; it never prints task/journal content or credentials.
- Postcheck returns invariant failures as counts; every healthy count is zero.
- Restore reconstructs ordinary task rows with original ids/data/updated timestamps and new safe sequence values before deleting verified archive rows.

- [ ] **Step 1: Write the secret-safe precheck SQL**

Return a raw backup hash plus a representation-independent task hash. The task hash normalizes ordinary and archived task tuples, resolves same-id versions by greatest `updatedAt` with tombstone tie priority, and hashes ordered `(user_id,id,updatedAt,deleted,data)` values. Return these named raw fields without selecting private payloads:

```sql
select
  count(*) filter (where kind = 'tasks') as ordinary_task_rows,
  count(*) filter (where kind = 'taskMonths') as archive_rows,
  count(*) filter (where kind = 'tasks' and deleted = false and data is null) as malformed_live_tasks,
  md5(string_agg(user_id::text || E'\n' || kind || E'\n' || id || E'\n' || updated_at::text || E'\n' || coalesce(data::text, 'null'), E'\n' order by user_id, kind, id)) as records_raw_backup_hash
from records;
```

Add `task_semantic_hash`, exact counter mismatch, and annual-field bounds queries. Do not select `data` as an output column.

- [ ] **Step 2: Write postcheck and inverse restore SQL**

Postcheck expands every version-1 archive through `jsonb_array_elements`, reports duplicate archived ids, malformed tuple counts, checksum/count mismatches, ordinary/archive same-id relationships, lifetime counter mismatches, annual overages, and archive rows whose expanded byte estimate exceeds 96 KiB.

Restore must:

1. refuse unknown versions or malformed archives;
2. lock one owner and its archive rows;
3. reserve one fresh sequence per reconstructed ordinary task;
4. upsert only when the archived `updatedAt` is newer than an existing ordinary row;
5. compare all reconstructed ids/timestamps/payloads;
6. delete only verified archives in the same transaction;
7. leave annual usage unchanged while lifetime triggers reflect the physical representation.

- [ ] **Step 3: Test the recovery SQL against a local compacted copy**

Run the sequence: seed five years → record semantic hash → compact → run postcheck → restore → compare the original semantic hash and every task tuple. Force one corrupt archive and assert restore aborts without deleting it.

Run:

```powershell
cd backend
npx vitest run test/task-compaction.test.ts -t "restore|checksum|corrupt" --maxWorkers=1
```

Expected: valid restoration is exact; corrupt restoration rolls back.

- [ ] **Step 4: Run the complete local verification matrix from fresh commands**

Run:

```powershell
npm test -- --maxWorkers=1
npm run lint
npx tsc --noEmit
npm run build
cd backend
npm test -- --maxWorkers=1
npm run typecheck
npm run build
cd ..
npm run sync:edge
npm run test:edge -- --maxWorkers=1
git diff --check
```

Expected: every command exits 0. Record test counts, measured storage/egress output, and generated parity evidence separately.

- [ ] **Step 5: Review the complete feature diff**

Inspect only this feature's commits against its parent and verify:

```powershell
git diff --stat 0ab6f55..HEAD
git diff --check 0ab6f55..HEAD
git log --oneline 0ab6f55..HEAD
```

Confirm no payment/auth/admin behavior, real credentials, production dumps, generated hand-edits, or unrelated cleanup entered the diff.

- [ ] **Step 6: Commit recovery tooling**

```powershell
git add supabase/manual-production/20260901_task_archive_precheck.sql supabase/manual-production/20260901_task_archive_postcheck.sql supabase/manual-production/20260901_task_archive_restore.sql
git commit -m "ops: add task archive verification and restore SQL"
```

---

### Task 8: Production Staged Rollout (Separate Approval Gate)

**Files:**
- Read: `docs-fa/DEPLOY-SUPABASE-EDGE.md`
- Read: `supabase/manual-production/20260901_task_archive_precheck.sql`
- Read: `supabase/manual-production/20260901_task_archive_postcheck.sql`
- Read: `supabase/manual-production/20260901_task_archive_restore.sql`
- Apply only after approval: `supabase/migrations/20260901150000_task_archive_quota_expand.sql`
- Apply only after approval: `supabase/migrations/20260901151000_task_month_compactor.sql`

**Interfaces:**
- Production project identity must be reverified immediately before action.
- Archive-aware Edge code is the compatibility floor once any archive row exists.

- [ ] **Step 1: Stop and request production approval with exact evidence**

Present the commit range, full local test counts, migration filename, backup method, canary owner type, abort criteria, and recovery command. Do not deploy or mutate production in the same message that requests approval.

- [ ] **Step 2: Verify project and obtain a non-empty scoped backup**

Verify the Routino project ref, current Edge version, migration history, and readiness routes. Create an encrypted scoped backup of `records`, `users` sequence/accounting fields, and migration state. Validate non-zero size, row counts, and semantic hashes without printing secrets or user content. Restore it locally and run the precheck.

- [ ] **Step 3: Deploy archive-aware code while the old schema is still active**

Run canonical generation and Edge tests once more, deploy the API only, then verify `/health/ready`, `/v1/plans`, unauthenticated sync `401`, direct-function bypass `403`, and one revocable test-account protocol-v2 sync. No archive exists yet, so code rollback remains safe at this stage.

- [ ] **Step 4: Apply only the reviewed migration and keep cron disabled for canary**

Apply `20260901150000_task_archive_quota_expand.sql` and then `20260901151000_task_month_compactor.sql` without any unrelated pending migration. Verify new columns, constraints, internal kind allowance, function definition, zero annual usage for existing accounts, unchanged semantic hash, and exact lifetime counters. Do not create the production cron job yet.

- [ ] **Step 5: Compact one controlled test owner-month**

Invoke `routino_compact_task_months` only for the controlled test fixture or a function variant scoped to that owner. Run postcheck, perform a cursor-zero sync in an old protocol-v2 client shape, edit and delete an archived task, and verify fresh-device reconstruction. Abort on any invariant count above zero, response above 512 KiB, 5xx increase, lock timeout, or semantic mismatch.

- [ ] **Step 6: Enable bounded schedule and observe initial batches**

Enable `routino-task-month-compaction` at `17 4 * * *` with 500 tasks/run. After each initial batch inspect postcheck counts, database load, function errors, sync latency, response bytes, record/byte counters, and annual usage. Unschedule immediately on any abort condition; do not roll Edge below the archive-aware commit while archive rows remain.

- [ ] **Step 7: Prove recovery before declaring completion**

Against the restored production backup, run the inverse restore and prove exact task id/timestamp/payload hashes. Record the deployed Edge version, migration version, cron id/schedule, backup identifier, canary evidence, and remaining unarchived backlog. Only then mark the rollout live-verified.
