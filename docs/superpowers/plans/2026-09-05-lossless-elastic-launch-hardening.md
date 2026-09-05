# Routino Lossless Elastic Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the current Routino release elastic and storage-efficient without losing users, valid product history, successful payments, or ambiguous payment recovery evidence.

**Architecture:** Keep Supabase Postgres and the existing local-first sync protocol. Replace backlog-producing schedules with indexed bounded jobs, replace fixed provider-wide business quotas with idempotency plus short-lived provider concurrency leases, and make schema/migration/generated Edge contracts identical. Every behavior change is test-first and production remains untouched.

**Tech Stack:** TypeScript, Fastify, Hono/Supabase Edge, Drizzle ORM, PostgreSQL/pg_cron, PGlite, Vitest, Vite.

## Global Constraints

- Never delete a user, successful payment, ambiguous payment, grant, entitlement, redemption, feedback, journal, habit history, incomplete task, or valid user-authored record for cost savings.
- Never retry an ambiguous PSP request blindly and never convert ambiguity into a terminal failure.
- No fixed global hourly or daily cap may reject legitimate checkout demand.
- Task source rows may be deleted only by the existing same-transaction semantic verification path.
- Tombstones younger than 90 days and all live records remain untouched.
- backend/src is canonical. Run npm run sync:edge after Backend changes; never hand-edit supabase/functions/api/shared.
- Keep src/lib/phone.ts byte-identical to backend/src/lib/phone.ts.
- No deploy, linked migration, real OTP, real PSP request, production stress test, cleanup, or secret change.

## File map

- backend/src/db/schema.ts: typed nullable payment owner and provider-capacity lease table.
- backend/src/db/ddl.ts: canonical fresh-schema SQL, indexes, maintenance functions, and provider-capacity lease schema.
- supabase/migrations/20260905140000_elastic_launch_hardening.sql: additive production migration; no data deletion.
- scripts/gen-setup-sql.mjs: pg_cron schedules and RLS list; generates supabase/setup.sql.
- backend/src/services/provider-capacity.ts: acquire/release short-lived bounded provider leases.
- backend/src/services/otp.ts: atomic phone/IP claim with no fixed global daily product-capacity gate.
- backend/src/routes/auth.ts and backend/src/routes/admin.ts: hold SMS provider lease only around the provider call.
- backend/src/services/payment-flow.ts: idempotent logical-checkout reuse and PSP initialization lease.
- backend/src/env.ts: validated configurable concurrency values.
- backend/src/services/admin-user-delete.ts: compiling delete-row check.
- backend/test and supabase/tests: red-green coverage for every invariant and Edge parity.
- scripts/load-smoke.mjs and its Vitest file: honest local load evidence.
- docs-fa/02-BACKEND.md, docs-fa/DEPLOY-SUPABASE-EDGE.md, docs-fa/LAUNCH-READINESS.md: current operational contract and remaining production gates.

---

### Task 1: Restore schema parity and green baseline gates

**Files:**
- Modify: backend/src/db/schema.ts
- Modify: backend/src/db/ddl.ts
- Modify: backend/src/services/admin-user-delete.ts
- Modify: backend/test/admin-user-delete.test.ts
- Modify: supabase/tests/helpers/harness.ts
- Test: backend/test/admin-user-delete.test.ts
- Test: backend/test/launch-ddl.test.ts
- Test: supabase/tests/subscriptions.test.ts

**Interfaces:**
- Produces: payments.userId typed as string | null and fresh DDL using nullable user_id with ON DELETE SET NULL.
- Produces: an admin-delete test helper that authenticates once per test and reuses its cookie/CSRF headers.
- Produces: Edge harness env LEGACY_IMPORT_CUTOFF defaulting to 2999-01-01T00:00:00.000Z while explicit cutoff tests override it.

- [ ] **Step 1: Add failing parity and behavior tests**

Add assertions equivalent to:

~~~ts
expect(SCHEMA_SQL).toMatch(/user_id uuid references users\(id\) on delete set null/i);
expect(SCHEMA_SQL).not.toMatch(/user_id uuid not null references users\(id\)/i);
expect(await preservedPayment(paymentId)).toEqual({ id: paymentId, user_id: null });
expect(h.env.LEGACY_IMPORT_CUTOFF.toISOString()).toBe("2999-01-01T00:00:00.000Z");
~~~

Change admin-user-delete.test.ts so beforeEach obtains one admin session after truncate and every delete/history call uses that session. The test must continue to assert that paid history survives with userId, phone, and username null.

- [ ] **Step 2: Run the focused tests and record the expected RED failures**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/admin-user-delete.test.ts test/launch-ddl.test.ts
cd ..
npm run test:edge -- --maxWorkers=1 supabase/tests/subscriptions.test.ts
~~~

Expected before implementation: DDL nullable assertion fails, Backend compilation still rejects returning({ id }), and Edge legacy import returns not_legacy_account.

- [ ] **Step 3: Make the smallest parity fixes**

Use a nullable Drizzle reference:

~~~ts
userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
~~~

Change fresh DDL to nullable ON DELETE SET NULL. Replace the driver-union-incompatible delete return selection with returning() and continue checking deleted.length. Reuse one authenticated admin session inside each test. Give the Edge harness the same far-future default cutoff as the Backend harness.

Audit payment queries: user-scoped reads must require a non-null matching user id; admin financial history must use a left join and retain anonymous rows.

- [ ] **Step 4: Verify focused GREEN and compiler gates**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/admin-user-delete.test.ts test/launch-ddl.test.ts
npm run typecheck
npm run build
cd ..
npm run test:edge -- --maxWorkers=1 supabase/tests/subscriptions.test.ts
~~~

Expected: all commands exit zero.

---

### Task 2: Make compaction and tombstone purge lossless, indexed, and faster than arrivals

**Files:**
- Modify: backend/src/db/ddl.ts
- Modify: scripts/gen-setup-sql.mjs
- Create: supabase/migrations/20260905140000_elastic_launch_hardening.sql
- Modify: backend/test/task-compaction.test.ts
- Modify: backend/test/tombstone-purge.test.ts
- Modify: backend/test/launch-ddl.test.ts
- Generated: supabase/setup.sql

**Interfaces:**
- Produces: routino_task_compaction_backlog(p_now timestamptz) returning eligible_tasks, candidate_owner_months, oldest_eligible_at.
- Produces: routino_purge_tombstones(p_now timestamptz, p_limit integer) returning purged_records and affected_users.
- Produces: indexed predicates used by both maintenance functions.

- [ ] **Step 1: Add failing task-backlog and throughput tests**

Add a fixture that inserts 10,000 safe cold completed tasks across owner-month groups, captures semantic tasks and exact user counters, executes enough bounded scheduler-equivalent runs for one day, and asserts:

~~~ts
expect(before.eligibleTasks).toBe(10_000);
expect(processed).toBe(10_000);
expect(after.eligibleTasks).toBe(0);
expect(await semanticTasks()).toEqual(beforeSemantics);
expect(await exactCounters()).toEqual(await recomputedCounters());
expect(theoreticalDailyCapacity).toBeGreaterThanOrEqual(100_000);
~~~

The capacity assertion uses the checked-in schedule and batch size, not a hardcoded two-runs-per-day model.

- [ ] **Step 2: Add failing bounded tombstone tests**

Insert more old tombstones than one batch, plus recent tombstones and live rows. Assert the first call removes exactly the batch, subsequent calls drain the old backlog, gc_seq reaches the highest actually deleted sequence for each user, and a pull below gc_seq returns reset=true.

~~~ts
expect(first.purgedRecords).toBe(batchSize);
expect(await oldTombstoneCount()).toBe(totalOld - batchSize);
expect(await liveRecordCount()).toBe(liveBefore);
expect(await recentTombstoneCount()).toBe(recentBefore);
expect((await pullFromOldCursor()).reset).toBe(true);
~~~

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/task-compaction.test.ts test/tombstone-purge.test.ts test/launch-ddl.test.ts
~~~

Expected: backlog/purge functions and indexes do not yet exist, and schedule-capacity assertions fail.

- [ ] **Step 4: Implement bounded indexed SQL**

Add an eligibility index that matches kind=tasks, deleted=false, completed=true, cold date/month, and updated-at ordering without unsafe JSON casts. Keep the existing archive verification and deletion transaction unchanged.

Add a tombstone partial index ordered by updated_at and seq where deleted=true. Implement routino_purge_tombstones with a limited ordered CTE, row locking with SKIP LOCKED, deletion returning user_id/seq, and same-transaction gc_seq update.

Both maintenance entrypoints take an advisory lock and return no work rather than overlap.

- [ ] **Step 5: Make schedules frequent and bounded**

Generate setup SQL with:

~~~sql
select cron.schedule(
  'routino-task-month-compaction',
  '* * * * *',
  $$select * from routino_run_task_month_compaction(now(), 1000)$$
);
select cron.schedule(
  'routino-tombstone-purge',
  '*/5 * * * *',
  $$select * from routino_purge_tombstones(now(), 2000)$$
);
~~~

Theoretical compaction capacity is 1,440,000 source tasks/day while every transaction stays at 1,000 tasks or less. Empty runs must perform no table mutation.

The additive migration creates functions/indexes and replaces schedules, but it does not execute compaction or purge against existing data during migration.

- [ ] **Step 6: Generate and verify GREEN**

Run:

~~~powershell
node scripts/gen-setup-sql.mjs
cd backend
npm test -- --maxWorkers=1 test/task-compaction.test.ts test/tombstone-purge.test.ts test/launch-ddl.test.ts
cd ..
~~~

Expected: losslessness, bounded batches, watermark safety, schedule capacity, and setup generation all pass.

---

### Task 3: Add reusable provider-concurrency leases and atomic OTP dimensions

**Files:**
- Modify: backend/src/db/schema.ts
- Modify: backend/src/db/ddl.ts
- Modify: backend/src/env.ts
- Create: backend/src/services/provider-capacity.ts
- Modify: backend/src/services/otp.ts
- Modify: backend/src/routes/auth.ts
- Modify: backend/src/routes/admin.ts
- Modify: supabase/migrations/20260905140000_elastic_launch_hardening.sql
- Test: backend/test/provider-capacity.test.ts
- Modify: backend/test/concurrency.test.ts
- Modify: backend/test/otp-abuse-limits.test.ts
- Modify: backend/test/env.test.ts

**Interfaces:**
- Produces: acquireProviderLease(db, kind, maxConcurrent, now, ttlMs) returning { leaseId } | null.
- Produces: releaseProviderLease(db, kind, leaseId) returning Promise<void>.
- Produces: Env.SMS_PROVIDER_MAX_CONCURRENCY default 32 and Env.PSP_PROVIDER_MAX_CONCURRENCY default 64, each integer 1..1000.
- Produces: claimSendSlot atomically enforcing phone and IP windows without a fixed global-day rejection.

- [ ] **Step 1: Write failing provider-lease tests**

Tests must prove:

~~~ts
expect((await claimMany("sms", 32)).filter(Boolean)).toHaveLength(32);
expect(await acquireProviderLease(db, "sms", 32, now, 30_000)).toBeNull();
await releaseProviderLease(db, "sms", first.leaseId);
expect(await acquireProviderLease(db, "sms", 32, now, 30_000)).not.toBeNull();
advanceClock(30_001);
expect(await acquireProviderLease(db, "sms", 32, now, 30_000)).not.toBeNull();
~~~

Also assert the table never contains more than maxConcurrent live leases per kind and expired crash leases are reclaimed.

- [ ] **Step 2: Write failing OTP concurrency tests**

Use real Postgres concurrency coverage when available plus PGlite service coverage. Parallel different-phone requests sharing one IP must not exceed ipPerHour. Remove the old test that expects the 2,001st globally distributed identity to be permanently rejected; replace it with a test that many unique legitimate identities are not blocked by a fixed global-day quota.

Repeated same-phone requests must still send one code. Saturating the SMS lease pool must return temporary Retry-After, create no OTP row for the rejected provider attempt, and allow the same user after a lease releases.

- [ ] **Step 3: Run tests and confirm RED**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/provider-capacity.test.ts test/concurrency.test.ts test/otp-abuse-limits.test.ts test/env.test.ts
~~~

Expected: provider-capacity module/table/env fields do not exist and shared-IP concurrency overshoots.

- [ ] **Step 4: Implement fixed-size provider leases**

Create provider_capacity_leases with kind, lease_id, expires_at, and created_at; primary key kind+lease_id and an expiry index. Acquisition uses one short transaction/advisory lock per kind: delete expired leases for that kind, count live rows, insert only below maxConcurrent. Release deletes exactly its lease. No user, phone, IP, attempt id, or secret is stored in this table.

Wrap only sms.send in a try/finally lease. If no lease is available, return the existing generic auth response with Retry-After and do not claim/send a new OTP. Provably-unsent SMS still refunds the OTP slot; ambiguous SMS failure still consumes it.

- [ ] **Step 5: Make OTP shared dimensions atomic**

Acquire advisory transaction locks in deterministic order for global claim coordination, IP when present, and phone before evaluating counts and inserting the OTP row. Remove globalPerDay and reason=global_day. Retain phone minute/hour/day and IP hour protections.

- [ ] **Step 6: Verify focused GREEN**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/provider-capacity.test.ts test/concurrency.test.ts test/otp-abuse-limits.test.ts test/env.test.ts test/sms-failure.test.ts
npm run typecheck
~~~

Expected: all commands exit zero and no real provider is contacted.

---

### Task 4: Make checkout elastic without duplicating payments or losing ambiguity

**Files:**
- Modify: backend/src/services/payment-flow.ts
- Modify: backend/src/routes/payments.ts
- Modify: backend/src/db/schema.ts
- Modify: backend/src/db/ddl.ts
- Modify: supabase/migrations/20260905140000_elastic_launch_hardening.sql
- Modify: src/lib/api/payments.ts
- Modify: src/routes/subscribe.tsx
- Modify: src/routes/-subscribe.test.tsx
- Modify: backend/test/payment-burst.test.ts
- Modify: backend/test/payment-recovery.test.ts
- Modify: backend/test/payments.test.ts
- Modify: supabase/tests/payments.test.ts

**Interfaces:**
- Consumes: acquireProviderLease and releaseProviderLease from Task 3.
- Produces: checkout retry response { error: "provider_busy", retryAfter: number, paymentId: string } with HTTP 503 and Retry-After.
- Preserves: existing CheckoutResult success union, attemptId idempotency, authority recovery, verify backoff, and exactly-once entitlement grants.

- [ ] **Step 1: Write failing elastic-checkout tests**

Add tests proving:

~~~ts
expect(await checkoutCountForAttempt(attemptId)).toBe(1);
expect(fakePsp.requestCallsFor(attemptId)).toBe(1);
expect(uniqueAccounts.filter((r) => r.statusCode === 200)).toHaveLength(uniqueAccounts.length);
expect(await paidPayment(paymentId)).toMatchObject({ status: "paid", appliedAt: expect.any(Date) });
expect(await ambiguousPayment(paymentId)).toMatchObject({ status: "provider_unknown" });
~~~

Saturate the 64 PSP leases with controllable fake provider promises. The 65th logical checkout must receive provider_busy plus Retry-After, retain one recoverable requesting payment, make zero extra PSP calls, and succeed later with the same attemptId after a lease releases.

Add a migration precheck test that duplicate nonterminal logical purchases abort constraint creation without deleting or merging any payment row.

- [ ] **Step 2: Run tests and confirm RED**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/payment-burst.test.ts test/payment-recovery.test.ts test/payments.test.ts
cd ..
npm run test:edge -- --maxWorkers=1 supabase/tests/payments.test.ts
~~~

Expected: fixed MAX_CHECKOUTS_PER_HOUR rejects legitimate attempts and PSP capacity saturation is not represented.

- [ ] **Step 3: Replace the fixed hourly business cap**

Remove MAX_CHECKOUTS_PER_HOUR and its count query. Preserve the unique user_id+attempt_id idempotency path.

Atomically serialize creation/ownership for one nonterminal logical purchase fingerprint: user, priced plan, authoritative amount, normalized discount, platform, and configured PSP. Existing redirected/verifying/paid states return their existing result. Existing requesting/provider_unknown states remain recoverable and are never re-sent blindly.

Do not create a uniqueness migration that mutates existing rows. The additive migration must abort with a clear precheck error if conflicting nonterminal rows already exist.

- [ ] **Step 4: Hold a PSP lease only around provider initialization**

After durable payment creation/claim and before psp.request, acquire a psp lease. On saturation, release the payment request ownership lease, retain the payment row, return provider_busy with Retry-After, and allow the same attemptId to resume. Always release provider-capacity lease in finally. Existing ambiguous exception handling remains authoritative.

The frontend retries provider_busy with the same attemptId using bounded exponential delays while the checkout screen remains active. It must never generate a new attempt id for the retry.

- [ ] **Step 5: Verify payment GREEN and losslessness**

Run:

~~~powershell
cd backend
npm test -- --maxWorkers=1 test/payment-burst.test.ts test/payment-recovery.test.ts test/payment-atomicity.test.ts test/payments.test.ts
cd ..
npm run sync:edge
npm run test:edge -- --maxWorkers=1 supabase/tests/payments.test.ts
~~~

Expected: all fake-provider tests pass, paid/grant counts remain exactly once, and no ambiguous row becomes terminal.

---

### Task 5: Replace misleading load evidence, update operations docs, and close every local gate

**Files:**
- Modify: scripts/load-smoke.mjs
- Test: scripts/load-smoke.test.mjs
- Modify: docs-fa/02-BACKEND.md
- Modify: docs-fa/DEPLOY-SUPABASE-EDGE.md
- Modify: docs-fa/LAUNCH-READINESS.md
- Modify: formatting-only files reported by npm run lint
- Generated: supabase/functions/api/shared
- Generated: supabase/setup.sql

**Interfaces:**
- Produces: runLoadSmoke reporting p50, p95, p99, response bytes, status histogram, unexpectedResponses, and errors.
- Produces: an explicit local-only scenario contract; remote execution still requires ALLOW_REMOTE_LOAD=true and is not used in this task.

- [ ] **Step 1: Write failing load-smoke tests**

Use a fake fetch implementation and assert:

~~~js
expect(calledPaths).not.toContain("/v1/devices/ping");
expect(report.errors).toBe(1);
expect(report.unexpectedResponses).toEqual([{ path: "/v1/plans", status: 404 }]);
expect(report.latencyMs).toHaveProperty("p99");
expect(report).toHaveProperty("responseBytes");
~~~

Expected status is path-specific: health and plans are 200; authenticated scenarios supply their own setup/token and exact accepted status set. Every other 4xx is an error.

- [ ] **Step 2: Run load test and confirm RED**

Run:

~~~powershell
npm test -- --maxWorkers=1 scripts/load-smoke.test.mjs
~~~

Expected: removed path, 404 classification, p99, and byte metrics fail.

- [ ] **Step 3: Implement honest reporting and documentation**

Remove /v1/devices/ping. Record path/status/bytes for every request. Count transport failures, all 5xx, and path-unexpected 4xx as errors. Keep remote load disabled by default.

Document exact SQL backlog queries, pg_cron run-history checks, provider concurrency env variables, customer/payment preservation rules, migration order, rollback boundary, and the fact that local green gates are not deployment proof.

Run Prettier/ESLint fixes only on files in scope or already reported by the baseline lint. Do not refactor unrelated UI.

- [ ] **Step 4: Regenerate canonical artifacts**

Run:

~~~powershell
node scripts/gen-setup-sql.mjs
npm run sync:edge
~~~

Never edit generated Edge shared files or supabase/setup.sql by hand.

- [ ] **Step 5: Run the complete verification matrix**

Run fresh:

~~~powershell
npm test -- --maxWorkers=1
cd backend
npm test -- --maxWorkers=1
npm run typecheck
npm run build
cd ..
npm run test:edge -- --maxWorkers=1
deno check --no-lock supabase/functions/api/index.ts
npm run lint
npm run build
npm run build:mobile
npx cap sync
npm audit --omit=dev --audit-level=high
cd backend
npm audit --omit=dev --audit-level=high
cd ..
git diff --check
~~~

Expected: every test/typecheck/lint/build command exits zero. Dependency audits may be reported as environment-blocked only with the exact fresh network error. Capacitor may report unavailable native iOS tooling; asset sync must still succeed and physical-device testing remains a separate gate.

- [ ] **Step 6: Report before/after evidence and stop before production**

Report:

- original versus final test counts and gate status;
- modeled arrival versus checked-in scheduled capacity;
- maintenance backlog before/after fixture runs;
- same-attempt provider calls and payment-row counts under concurrency;
- database contract parity;
- exact files/commits changed;
- explicitly unverified production migration, WAF, provider, backup, and physical-device items.

Do not deploy or enable production cron.
