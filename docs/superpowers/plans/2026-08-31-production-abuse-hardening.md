# Production Abuse Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove production-only amplification paths in configuration, sync, payment polling and PWA delivery without changing normal user data or UX.

**Architecture:** Keep shared business logic in canonical backend services and synchronize it to Edge. Move account-scale work into bounded SQL, bound pull responses by UTF-8 bytes, persist PSP cooldown state on existing payment rows, and generate Pages headers from the build.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle, PGlite, Hono, Fastify, Cloudflare Worker/Pages, Vite PWA, Vitest.

## Global Constraints

- No stress or destructive test runs against production.
- No automatic deletion or rewriting of real-user content or money/audit tables.
- Payment amount, result and grant remain server-authoritative and idempotent.
- Sync cursor ordering, LWW, delete-wins, quota accounting and offline durability remain unchanged.
- Frontend behavior and request shapes remain backward compatible.

---

### Task 1: Fail-closed Edge configuration and native quota errors

**Files:**
- Modify: `supabase/functions/api/index.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/src/services/sync.ts`
- Test: `backend/test/app.test.ts`
- Test: `backend/test/sync.test.ts`
- Test: `supabase/tests/sync.test.ts`

- [ ] **Step 1: Write failing tests**

Assert Edge defaults an absent `NODE_ENV` to production, missing `PROXY_SECRET` stops production startup, and a postgres-js cause shaped as `{code:'23514', constraint_name:'users_sync_data_bytes_bounds'}` becomes bounded `account_quota_exceeded` while unrelated constraints stay 500.

- [ ] **Step 2: Verify RED**

Run focused backend and Edge tests and confirm each fails for the missing guard/adapter shape.

- [ ] **Step 3: Implement minimal fixes**

Force production mode in the Deno entry unless explicitly test/development in a local harness. Accept `constraint` or `constraint_name` only with SQLSTATE 23514 and the two known budget constraint names.

- [ ] **Step 4: Verify GREEN and commit**

Commit message: `fix: fail closed in production edge`.

---

### Task 2: Set-based habit-delete cascade

**Files:**
- Modify: `backend/src/services/sync.ts`
- Test: `backend/test/sync.test.ts`
- Test: `backend/test/concurrency.test.ts`

- [ ] **Step 1: Write failing scale test**

Create thousands of month rows for one habit and another account, delete the habit once, and instrument the DB boundary to prove no `.select().from(records)` materializes month payloads or constructs an account-sized JavaScript values list.

- [ ] **Step 2: Verify RED**

Run the focused tests and observe the current `childMonthIds` select/materialization.

- [ ] **Step 3: Implement one set-based write statement**

Build `incoming`, `cascaded`, `deduped`, `numbered`, `sized`, `bump` and `upserted` CTEs. Cascade selects matching active month identifiers inside PostgreSQL, dedupes by `(kind,id)` using newest timestamp then tombstone, sizes the sequence block in SQL, and keeps the user row lock through the upsert.

- [ ] **Step 4: Verify sequence/delete/quota behavior and commit**

Commit message: `fix: bound habit deletion cascade`.

---

### Task 3: Byte-bounded pull pages

**Files:**
- Modify: `backend/src/services/sync.ts`
- Test: `backend/test/sync.test.ts`
- Test: `supabase/tests/quota.test.ts`

**Interfaces:**
- Produces: `PULL_RESPONSE_MAX_UTF8_BYTES = 512 * 1024`.
- Keeps: `pullRecords(db,userId,cursor,limit)` and response fields unchanged.

- [ ] **Step 1: Write failing response-size and pagination tests**

Insert near-maximum month rows and assert serialized response stays at or below 512 KiB, always returns at least one row, sets cursor to the final returned row, eventually returns every row once, and preserves 500-row pages for small records when they fit.

- [ ] **Step 2: Verify RED**

Confirm the current 500-row query exceeds the budget.

- [ ] **Step 3: Implement database-side cumulative-byte selection**

Use `octet_length` over the wire-shaped JSON in a windowed CTE, reserve fixed response metadata overhead, select only fitting rows (or the first row), and calculate `hasMore` from an indexed existence check after the chosen boundary. Do not fetch the excluded payloads into Edge memory.

- [ ] **Step 4: Verify GREEN and commit**

Commit message: `fix: bound sync pull bytes`.

---

### Task 4: Persisted payment verification cooldown

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Create: `supabase/migrations/20260831142000_payment_verify_backoff.sql`
- Test: `backend/test/payment-recovery.test.ts`
- Test: `backend/test/payments.test.ts`

**Interfaces:**
- Adds nullable `next_verify_at` and nonnegative `verify_attempts` to `payments`.
- `verifyAndApplyPayment` accepts `{ bypassBackoff?: boolean }`; callback uses true, poll/recovery false.
- Cooldown starts at 5 seconds, doubles conservatively, and caps at 5 minutes.

- [ ] **Step 1: Write failing fake-clock tests**

Prove twelve polls in one window make one provider call, eligibility returns after time advances, callback bypasses poll cooldown once, races grant exactly once, and network/unknown results remain nonterminal.

- [ ] **Step 2: Verify RED**

Run focused payment tests and observe repeated provider calls.

- [ ] **Step 3: Implement atomic claim/backoff**

Gate the lease update on `next_verify_at <= now`, increment attempts in the same claim, set the next retry time atomically, preserve it when releasing a pending/unknown lease, clear it on paid/terminal outcomes, and include cooldown eligibility in recovery selection so ineligible rows cannot starve eligible ones.

- [ ] **Step 4: Verify GREEN and migration safety, then commit**

Assert existing paid rows and grants are unchanged through the additive migration. Commit message: `fix: throttle payment verification polls`.

---

### Task 5: Pages/PWA security and cache policy

**Files:**
- Modify: `scripts/build-landing.mjs`
- Modify: `functions/app/[[path]].js`
- Test: `test/pages-app-fallback.test.ts`
- Test: `test/landing-build.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Build the site and assert landing/legal/app receive HSTS, nosniff, frame denial and explicit referrer policy; app HTML/SW/manifest are no-cache; hashed `/app/assets/*` are one-year immutable; the fallback preserves shell headers and forces no-cache.

- [ ] **Step 2: Verify RED**

Run the focused root tests and inspect generated `dist/_headers`.

- [ ] **Step 3: Implement generated policies**

Generate path-scoped CSP from the actual artifact requirements: app scripts self-only, inline styles only where the built output requires them; landing/legal retain only the inline allowances their templates require. Re-wrap the fallback with copied shell headers before overriding content type/cache.

- [ ] **Step 4: Verify browser/PWA behavior and commit**

Run build/tests, then one bounded desktop+mobile browser pass for CSP errors, service-worker activation/update and offline reload. Commit message: `fix: harden pages delivery`.

---

### Task 6: Shared parity, docs and full verification

**Files:**
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/DEPLOY-SUPABASE-EDGE.md`

- [ ] **Step 1: Synchronize canonical backend**

Run `npm run sync:edge`, regenerate `supabase/setup.sql`, and verify generated parity.

- [ ] **Step 2: Update exact architecture/operations docs**

Document byte limit, SQL cascade, cross-driver quota handling, payment cooldown and cache headers.

- [ ] **Step 3: Run full local gate**

Run root tests/lint/build, backend typecheck/tests/build, Edge tests, migration fixtures, `npm audit --omit=dev --audit-level=high` in root/backend, secret scans, and `git diff --check`.

- [ ] **Step 4: Commit docs/parity**

Commit message: `docs: record production hardening`.

---

### Task 7: Production release and bounded adversarial verification

- [ ] **Step 1: Back up and record invariants**

Before payment migration or Edge deployment, save affected-table backups and record counts for users/records/payments/grants/entitlements/redemptions/feedback plus the invariant that each paid payment has at most one payment grant.

- [ ] **Step 2: Apply additive migrations**

Apply auth bucket expand and payment backoff migrations only after exact dry-run review. Do not apply the auth contract/drop migration yet.

- [ ] **Step 3: Deploy Edge, Worker and Pages**

Deploy the reviewed SHA/configs and record versions. Verify `/health/ready` plus a function-backed route; `/health` alone is insufficient.

- [ ] **Step 4: Bounded live checks**

Check headers/cache, unknown CORS, direct Supabase rejection, private-route 401, normal plans/auth/sync behavior, and repeat payment status reads only against a controlled non-money fixture if one already exists. Run all amplification/stress scenarios locally, never against live users.

- [ ] **Step 5: Recheck invariants and rollback boundary**

Compare post-release counts and money invariants to preflight. On failure, roll back code first; never blind-restore or truncate production tables.
