# Sync v2 Validation and Edge Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sync payloads semantically typed, partially reject malformed records without wedging valid data, and enforce the same 64 KiB JSON-body ceiling in the production Edge adapter as in Fastify.

**Architecture:** Keep the existing local-first delta protocol and generic `records` table for this release unit. Add one canonical backend validator copied to Edge, return bounded per-record rejection results, and parse Edge JSON through a streaming byte limiter before any route schema. Client outbox rows are cleared only when the server accepted or skipped that exact row version.

**Tech Stack:** TypeScript, Zod, Fastify, Hono, Drizzle/Postgres, Dexie, Vitest.

## Global Constraints

- No production deploy, migration, PSP request, or live data mutation.
- `backend/src` is canonical for shared backend logic; run `npm run sync:edge` before Edge tests.
- Never hand-edit `supabase/functions/api/shared/`, `src/routeTree.gen.ts`, `www/`, or `dist/`.
- `src/lib/phone.ts` and `backend/src/lib/phone.ts` remain byte-identical.
- Existing local IndexedDB shapes and user-visible behavior remain unchanged.
- Journal content is retained; invalid server payloads remain durable and dirty locally.

---

### Task 1: Canonical per-kind sync validator

**Files:**
- Create: `backend/src/services/sync-record-validation.ts`
- Create: `backend/test/sync-record-validation.test.ts`
- Modify: `backend/src/services/sync.ts`

**Interfaces:**
- Produces: `validateSyncRecord(record: PushRecord): { ok: true; record: PushRecord } | { ok: false; code: SyncRejectionCode }`
- Produces: `SyncRejectionCode` as a closed union of stable client-safe codes.
- Consumes: current entity shapes in `src/lib/store.ts`, mirrored as strict server schemas without importing frontend code.

- [ ] **Step 1: Write failing validator tests**

Cover one valid fixture for every sync kind and literal expectations for: malformed natural IDs, unknown keys, non-finite numbers, invalid enums, overlong strings, journal text above 4,000 characters, journal UTF-8 above 16 KiB, mismatched IDs/date keys, and a tombstone carrying no required data.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && npm test -- --maxWorkers=1 test/sync-record-validation.test.ts`

Expected: FAIL because `sync-record-validation.ts` does not exist.

- [ ] **Step 3: Implement the strict schemas and stable result type**

Use `z.object(...).strict()` for live rows, `TextEncoder` for UTF-8 measurement, finite-number refinements, and key/payload cross-checks. Tombstones validate `kind`, `id`, `updatedAt`, and `deleted` but do not require entity data.

The result type must be:

```ts
export type SyncRejectionCode =
  | "bad_kind"
  | "bad_id"
  | "bad_updated_at"
  | "invalid_record"
  | "record_too_large";

export type RecordValidation =
  | { ok: true; record: PushRecord }
  | { ok: false; code: SyncRejectionCode };
```

- [ ] **Step 4: Replace throw-first validation in `pushRecords` with the canonical validator**

Keep request-count validation at the route/service boundary. Partition records into valid and rejected lists before database work. Do not include attacker-controlled values or Zod issue text in the response.

- [ ] **Step 5: Run validator and existing backend sync tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/sync-record-validation.test.ts test/sync.test.ts test/concurrency.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the validator unit**

```bash
git add backend/src/services/sync-record-validation.ts backend/src/services/sync.ts backend/test/sync-record-validation.test.ts
git commit -m "feat: validate sync records by domain"
```

### Task 2: Per-record acceptance contract

**Files:**
- Modify: `backend/src/services/sync.ts`
- Modify: `backend/test/sync.test.ts`
- Modify: `backend/test/concurrency.test.ts`
- Modify: `src/lib/api/sync.ts`
- Modify: `src/lib/sync/engine.ts`
- Modify: `src/lib/sync/engine.test.ts`

**Interfaces:**
- Produces: `RejectedSyncRecord { kind: string; id: string; updatedAt: number; code: SyncRejectionCode }`.
- Extends: `PushResult` and `ExchangeResult` with `rejectedRecords`.
- Client consumes `rejectedRecords` and clears only settled rows.

- [ ] **Step 1: Write failing backend partial-acceptance tests**

Send one valid habit and one invalid journal in the same exchange. Assert HTTP 200, the habit is stored/pulled, the journal is absent, and the response contains exactly one bounded rejection with no journal text echoed.

- [ ] **Step 2: Verify backend RED**

Run: `cd backend && npm test -- --maxWorkers=1 test/sync.test.ts`

Expected: FAIL because the current service throws one 400 for the whole batch.

- [ ] **Step 3: Implement partial acceptance in the service**

Return rejection metadata for invalid rows. If every row is invalid, return the user's current cursor without entering the upsert path. Valid/stale records retain the existing sequence, LWW, clock clamp, cascade, and concurrency guarantees.

- [ ] **Step 4: Write failing client settlement tests**

Cover a mixed batch where the accepted row becomes clean, the rejected row stays dirty, a newer edit made during the request stays dirty, pull still applies, and the outcome rejection count equals the server list length.

- [ ] **Step 5: Verify client RED**

Run: `npm test -- --maxWorkers=1 src/lib/sync/engine.test.ts`

Expected: FAIL because the client currently clears the whole sent batch.

- [ ] **Step 6: Implement exact settlement**

Add a stable key of `kind + id + updatedAt` for rejected rows. Pass only non-rejected sent rows to `clearDirty`; preserve the existing re-read timestamp guard. Remove the catch-and-skip behavior for semantic 4xx batches because semantic record errors now arrive as HTTP 200 results; retain 401 and transport handling.

- [ ] **Step 7: Run focused backend and frontend suites**

Run: `cd backend && npm test -- --maxWorkers=1 test/sync.test.ts test/concurrency.test.ts`

Run: `npm test -- --maxWorkers=1 src/lib/sync/engine.test.ts src/lib/sync/merge.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the contract unit**

```bash
git add backend/src/services/sync.ts backend/test/sync.test.ts backend/test/concurrency.test.ts src/lib/api/sync.ts src/lib/sync/engine.ts src/lib/sync/engine.test.ts
git commit -m "feat: settle sync records independently"
```

### Task 3: Production Edge JSON body ceiling

**Files:**
- Modify: `backend/src/lib/http-errors.ts`
- Modify: `supabase/functions/api/deps.ts`
- Modify: `supabase/functions/api/app.ts`
- Modify: `supabase/tests/app.test.ts`

**Interfaces:**
- Produces: `payloadTooLarge(code?: string, msg?: string): HttpError` with status 413.
- Produces: `readJson(c, maxBytes = 64 * 1024): Promise<unknown>` that limits bytes before JSON parsing.

- [ ] **Step 1: Write failing Edge tests**

Test a declared `Content-Length` above 64 KiB and a chunked/undeclared body above 64 KiB. Assert status 413 and `{ error: "payload_too_large" }`. Also assert malformed JSON below the cap remains the existing clean 400 path and a valid sync payload below the cap succeeds.

- [ ] **Step 2: Verify Edge RED**

Run: `npm run test:edge -- --maxWorkers=1 supabase/tests/app.test.ts supabase/tests/sync.test.ts`

Expected: FAIL because Hono currently calls `c.req.json()` without a byte bound.

- [ ] **Step 3: Add the shared 413 error helper**

Add:

```ts
export const payloadTooLarge = (
  code = "payload_too_large",
  msg = "Request body is too large",
) => new HttpError(413, code, msg);
```

Then run `npm run sync:edge`; do not edit the generated copy manually.

- [ ] **Step 4: Implement bounded streaming JSON parsing**

Reject an oversized numeric `Content-Length` before reading. Otherwise consume `c.req.raw.body.getReader()` incrementally, cancel immediately once the accumulated byte count exceeds the cap, concatenate only bounded chunks, decode once, and `JSON.parse`. Preserve the current `{}` fallback only for malformed JSON, not for the deliberate 413 error.

- [ ] **Step 5: Run Edge tests**

Run: `npm run test:edge -- --maxWorkers=1 supabase/tests/app.test.ts supabase/tests/sync.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the Edge parity unit**

```bash
git add backend/src/lib/http-errors.ts supabase/functions/api/deps.ts supabase/functions/api/app.ts supabase/functions/api/shared/lib/http-errors.ts supabase/tests/app.test.ts
git commit -m "fix: bound edge request bodies"
```

### Task 4: Edge parity, documentation, and full verification

**Files:**
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`

**Interfaces:**
- Documents: semantic validation, per-record rejection, and production body-limit parity.

- [ ] **Step 1: Synchronize canonical backend code to Edge**

Run: `npm run sync:edge`

- [ ] **Step 2: Update only the affected Persian guide sections**

Record that malformed rows no longer block valid rows, rejected rows stay dirty locally, and both Fastify and Edge reject JSON above 64 KiB.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```bash
npm test -- --maxWorkers=1
cd backend && npm test -- --maxWorkers=1
cd backend && npm run typecheck
npm run test:edge -- --maxWorkers=1
npm run lint
npm run build
```

Expected: every command exits 0 with no test failures.

- [ ] **Step 4: Verify generated parity and repository scope**

Run: `npm run sync:edge` a second time, then `git diff --exit-code -- supabase/functions/api/shared`.

Run: `git status --short` and inspect the full branch diff. Confirm no payment-flow, generated route tree, `dist`, `www`, or secret file changed.

- [ ] **Step 5: Commit documentation and any generated parity updates**

```bash
git add docs-fa/01-FRONTEND.md docs-fa/02-BACKEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md docs-fa/CODEBASE_GUIDE.md supabase/functions/api/shared
git commit -m "docs: explain bounded sync acceptance"
```
