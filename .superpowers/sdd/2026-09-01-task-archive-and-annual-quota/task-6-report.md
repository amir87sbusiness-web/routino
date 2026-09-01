# Task 6 report — Edge parity and capacity evidence

## Result

- Commit: `27cc14b test: verify archived task scale and edge parity`
- No deploy, live Supabase migration, production DB connection, or production network mutation was performed.
- Canonical backend sources were not hand-edited in this task. Edge shared copies were produced only with `npm run sync:edge`; `supabase/setup.sql` was produced only with `node scripts/gen-setup-sql.mjs`.

## TDD evidence

RED, before regeneration:

```text
npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1
Test Files 1 failed (1)
Tests 4 failed | 7 passed (11)
```

The four expected failures were:

1. the generated Edge DDL rejected internal `taskMonths`;
2. the generated Edge DDL lacked annual quota columns;
3. the generated Edge sync did not expand archives;
4. postgres-js-shaped annual quota errors were not recognised.

GREEN after adding the archive module to the manifest and running both generators:

```text
npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1
Test Files 1 passed (1)
Tests 11 passed (11)
```

## Final verification

```text
npm run test:edge -- --maxWorkers=1
Test Files 11 passed (11)
Tests 110 passed (110)
Duration 68.77s

npx vitest run src/lib/analytics.test.ts src/lib/backup.test.ts src/components/tasks.test.tsx --maxWorkers=1
Test Files 3 passed (3)
Tests 39 passed (39)

npx tsc --noEmit
PASS

npm --prefix backend run typecheck
PASS

npm --prefix backend test -- test/edge-parity.test.ts --maxWorkers=1
Test Files 1 passed (1)
Tests 28 passed (28)

npm --prefix backend test -- test/launch-ddl.test.ts test/task-compaction.test.ts --maxWorkers=1
Test Files 2 passed (2)
Tests 32 passed (32)

git diff --check
PASS
```

Focused capacity suite:

```text
npx vitest run -c vitest.edge.config.ts supabase/tests/quota.test.ts --maxWorkers=1 --reporter=verbose
Test Files 1 passed (1)
Tests 7 passed (7)
Duration 52.36s
```

## Capacity measurements

Fixture per account-year: 15 habits, 10 completed tasks/day, one seven-line journal entry/day. Four account-years were sent through the real Edge API and the real SQL compactor was run to convergence.

- Annual positive JSON growth: `1,101,751 B` average, below the hard `10,485,760 B` allowance.
- Raw records across four users: `16,840 -> 2,734` after compaction.
- Average post-compaction counter: about `684 rows/account-year`, below the 50,000-row hard cap.
- Physical `records` table bytes: `5,201,920 -> 5,701,632 B`.
- Physical `records` index bytes: `2,957,312 -> 3,080,192 B`.
- One-year fresh sync after transparent expansion: `9 pages / 1,464,222 B`.
- Five-year synthetic fresh sync after transparent expansion: `44 pages / 7,367,486 B`.
- Normal steady state: `2 exchanges/day`, `331 response B/day` in this fixture.
- Invocation arithmetic at 500,000/month: about `8,333 DAU`; egress arithmetic is higher (`540,655 DAU`) and therefore not the binding fixture ceiling.
- Twenty-year synthetic archive round-trip compared every task id, timestamp, and payload and passed.

The physical relation size increases after ordinary `VACUUM ANALYZE` despite the row reduction. This is expected PostgreSQL behavior: deleted pages become reusable but ordinary vacuum does not shrink the relation file. The test reports this honestly and does not claim immediate billed-byte shrinkage.

## Changed files

- Manifest/generation: `scripts/sync-edge-shared.mjs`, `supabase/functions/api/shared/{db/ddl.ts,db/schema.ts,services/sync-record-validation.ts,services/sync.ts,services/task-month-archive.ts}`, `supabase/setup.sql`.
- Edge/capacity tests: `supabase/tests/sync.test.ts`, `supabase/tests/quota.test.ts`.
- Representation-neutral client tests: `src/lib/analytics.test.ts`, `src/lib/backup.test.ts`, `src/components/tasks.test.tsx`.
- Persian docs: `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, `docs-fa/CODEBASE_GUIDE.md`.

## Deferred production gates / risks

- Real PostgreSQL two-connection quota contention remains a rollout gate from Task 3; PGlite cannot prove native concurrent lock scheduling.
- Native PostgreSQL `SKIP LOCKED`, statement timeout, pg_cron ownership/permissions, and production-size vacuum/reuse behavior remain rollout gates from Task 4/7.
- No production backup, migration dry-run, canary, cron activation, or deployed endpoint verification has occurred. Required order remains: code first, then backup/dry-run/additive migration/canary, then cron.
- Capacity figures are reproducible test measurements, not a marketing or Supabase plan promise.

## Fix Round 1 — rollout compatibility and bounded pull pressure

### Result

- No deploy, production DB connection, migration, cron change, secret change, or real payment was performed.
- Commit follows this report section: `fix: bound archive pull and preserve rollout compatibility`.
- Generated Edge shared files were changed only by `npm run sync:edge`; `supabase/setup.sql` did not need regeneration because no canonical DDL input changed.

### RED → GREEN evidence

RED cases recorded before their corresponding minimal repair:

```text
npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1 --reporter=verbose
Test Files 1 failed (1)
Tests 1 failed | 14 passed (15)
Failure: isLegacyAccountQuotaError is not a function
```

This was the generated Edge copy before `npm run sync:edge`; regeneration was the only repair and then the same suite was green.

```text
npm --prefix backend test -- test/sync.test.ts --maxWorkers=1 --reporter=verbose
Test Files 1 failed (1)
Tests 1 failed | 31 passed (32)
Failure: exact-256 KiB prefix returned hasMore=false
```

The root cause was the SQL prefix predicate excluding the next row when its
predecessor ended exactly at the DB byte boundary. Changing that predicate to
include the one boundary lookahead made the regression and full focused suite
green.

GREEN verification:

```text
npm --prefix backend test -- test/sync.test.ts --maxWorkers=1
Test Files 1 passed (1)
Tests 32 passed (32)

npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1
Test Files 1 passed (1)
Tests 15 passed (15)

npx vitest run src/lib/analytics.test.ts src/lib/backup.test.ts src/components/tasks.test.tsx --maxWorkers=1
Test Files 3 passed (3)
Tests 39 passed (39)

npx vitest run -c vitest.edge.config.ts supabase/tests/quota.test.ts --maxWorkers=1 --reporter=verbose
Test Files 1 passed (1)
Tests 7 passed (7)
Duration 53.69s

npm --prefix backend test -- test/edge-parity.test.ts --maxWorkers=1
Test Files 1 passed (1)
Tests 28 passed (28)

npm --prefix backend test -- test/launch-ddl.test.ts test/task-compaction.test.ts test/tombstone-purge.test.ts --maxWorkers=1
Test Files 3 passed (3)
Tests 36 passed (36)

npm run test:edge -- --maxWorkers=1
Test Files 11 passed (11)
Tests 114 passed (114)
Duration 68.71s

npm --prefix backend run typecheck
npx tsc --noEmit
git diff --check
PASS
```

### Pull/query evidence

- `pullRecords` now uses one owner+records SQL statement per page and no follow-up `exists` query.
- Test-only optional metrics are never returned through HTTP. Every tested page asserts at most `500 + 1` stored candidates, raw prefix at most `262,144 B`, and at most one archive lookahead.
- The exact-boundary regression records a prefix of exactly `262,144 B` plus one lookahead and requires `hasMore=true`.
- Five archive years completed in `40` pull queries/pages with `19,200` expanded task ids, with no skip or duplicate.
- PGlite executes the complete SQL path. postgres-js-shaped nested errors are separately covered for normal and legacy quota constraints; native two-connection/trigger scheduling remains a PostgreSQL rollout check.

### Measured fixture output

- Annual positive JSON growth: `1,101,751 B` of the hard `10,485,760 B` product allowance.
- Raw rows: `16,840 -> 2,734`; compacted average `684` rows/account-year of `50,000`.
- Records relation: table `5,201,920 -> 5,701,632 B`; indexes `2,621,440 -> 2,727,936 B` after ordinary vacuum/reuse.
- Fresh expanded sync: one year `10 pages / 1,464,277 B`; five years `44 pages / 7,367,486 B`.
- Normal fixture output: `2 exchanges/day`, `331 response B/day`; this is measurement only, with no provider-plan or DAU assertion.

### Scoped changes

- `backend/src/services/sync.ts` and generated `supabase/functions/api/shared/services/sync.ts`: exact nested old-function fallback, legacy quota recognition, fail-closed partial annual schema guard, single bounded pull query, and test-only pull metrics.
- `backend/test/sync.test.ts`, `supabase/tests/sync.test.ts`, and `supabase/tests/quota.test.ts`: old-schema Edge, boundary/no-skip/query-bound, codec/annual, and measurement-only assertions.
- `test/helpers/task-archive-compat.ts` plus the three frontend compatibility tests: the task array comes from the real archive expansion codec; no test helper remains under production `src/lib`.
- `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, `docs-fa/CODEBASE_GUIDE.md`, and `docs-fa/DEPLOY-SUPABASE-EDGE.md`: no free-tier/DAU guarantee; documented code-first, backup/restore, dry-run, additive migration, canary, and cron-last sequence.

### Remaining rollout caveats

- PGlite cannot prove native PostgreSQL trigger scheduling or two-connection contention for the old legacy row/data-byte checks; the strict error shape and Edge old-schema fallback are covered locally, but production rollout still needs the documented clone/canary validation.
- No provider plan capacity, billed storage result, DAU ceiling, deploy, backup, dry-run, migration, cron activation, or live endpoint is claimed by these tests.
