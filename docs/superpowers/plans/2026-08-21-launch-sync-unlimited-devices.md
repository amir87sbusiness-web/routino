# Launch Sync and Unlimited Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore authenticated personal-data sync, remove product device quotas, and retain session-level security in Fastify and Supabase Edge.

**Architecture:** Keep the records-based delta protocol unchanged and remove only its environment/HTTP kill switch. Device installations remain durable session rows keyed by installation key, but new installations no longer evict or lock other installations. Shared backend modules are edited only under `backend/src/`, regenerated into Edge shared code, while Edge HTTP adapters mirror the new contracts.

**Tech Stack:** TypeScript, Fastify, Hono, Drizzle, PGlite, Vitest, Supabase setup SQL.

## Global Constraints

- Do not change the records schema/protocol, custom JWT, token rotation, entitlement rules, pricing, or trial behavior.
- Sync is authenticated but never subscription-gated.
- Do not hand-edit `supabase/functions/api/shared/`; run `npm run sync:edge` after canonical backend edits.
- Keep RLS enabled with zero policies; do not apply generated setup SQL to production.
- Keep deprecated user security columns and historical device security events; clear only `device_switch_limit` locks through idempotent DDL.

---

### Task 1: Make sync available by default

**Files:**
- Modify: `backend/src/env.ts`, `backend/src/routes/sync.ts`, `supabase/functions/api/routes/sync.ts`
- Modify: `backend/test/helpers/pglite.ts`, `backend/test/local-only.test.ts`, `supabase/tests/helpers/harness.ts`, `supabase/tests/sync.test.ts`

**Interfaces:**
- Produces: authenticated `POST /v1/sync/push` and `GET /v1/sync/pull` responses from the existing sync service, independent of environment flags.

- [ ] **Step 1: Write failing tests**

Replace the tests expecting HTTP 410 with tests that use ordinary test env and assert an authenticated empty push returns `200` with `{ applied: 0 }`, while unauthenticated calls remain `401`.

- [ ] **Step 2: Run the focused tests and confirm their expected failure**

Run: `npm --prefix backend test -- --maxWorkers=1 test/local-only.test.ts` and `npm run test:edge -- --maxWorkers=1 supabase/tests/sync.test.ts`

Expected: failures because the route still returns `sync_disabled`.

- [ ] **Step 3: Implement the minimal route/configuration removal**

Delete `LEGACY_PERSONAL_SYNC_ENABLED` validation and the production prohibition. Remove both adapter-level 410 branches, leaving their existing auth middleware, parser, push/pull, payment recovery, and final-page entitlement behavior untouched. Remove flag overrides from test harnesses.

- [ ] **Step 4: Re-run the focused tests**

Run the commands from Step 2 and confirm each assertion passes.

### Task 2: Replace device-quota behavior with unlimited protected sessions

**Files:**
- Modify: `backend/src/services/tokens.ts`, `backend/src/plugins/auth.ts`, `backend/src/routes/devices.ts`, `src/lib/api/devices.ts`
- Modify: `backend/test/device-security.test.ts`, `backend/test/device-limit.test.ts`, `backend/test/devices.test.ts`, `backend/test/concurrency.test.ts`

**Interfaces:**
- Produces: `issueForDevice()` that preserves one device row per installation and rotates that installation's refresh token without revoking sibling installations.
- Produces: `/v1/devices` response `{ devices }` without former quota/lock metrics.

- [ ] **Step 1: Write failing session behavior tests**

Replace eviction/replacement tests with a test that signs in Device A, B, C, and D and proves each refresh token remains valid; keep separate tests for same-installation reuse, manual revoke, rotation, blocked accounts, and password-change revocation.

- [ ] **Step 2: Run the focused backend device tests and confirm expected failures**

Run: `npm --prefix backend test -- --maxWorkers=1 test/devices.test.ts test/device-security.test.ts test/device-limit.test.ts test/concurrency.test.ts`

Expected: the unlimited-session test fails because the old capacity/replacement branch revokes a device or locks the account.

- [ ] **Step 3: Implement the minimal token and response changes**

Remove device quota constants, quota event reads/writes, capacity eviction, and quota locking from `issueForDevice()`. Retain user-row serialization, installation-key lookup/unique constraint, token hashing, rotation, expiry, manual revoke, and all-device/other-device revocation. Remove the orphan security-lock rejection from Fastify auth. Simplify the device overview and client type to only devices.

- [ ] **Step 4: Re-run the focused tests**

Run the command from Step 2 and confirm all session-security behavior passes.

### Task 3: Remove device-policy administration and match Edge behavior

**Files:**
- Modify: `backend/src/services/admin.ts`, `backend/src/routes/admin.ts`, `backend/src/lib/admin-page.ts`
- Modify: `supabase/functions/api/deps.ts`, `supabase/functions/api/routes/devices.ts`, `supabase/functions/api/routes/admin.ts`
- Modify: `backend/test/admin.test.ts`, `backend/test/admin-page.test.ts`, `supabase/tests/devices.test.ts`, `supabase/tests/admin.test.ts`

**Interfaces:**
- Produces: admin user detail retaining device visibility and `blocked`, with no limit, replacement-count, or unlock controls.
- Produces: Edge auth that rejects blocked/revoked sessions but not deprecated device-switch locks.

- [ ] **Step 1: Write failing parity tests**

Replace the device-policy endpoint tests with requests proving the endpoint is absent, update overview shape assertions, and set a legacy `device_switch_limit` lock before a protected Fastify/Edge request to prove it does not block the valid device session.

- [ ] **Step 2: Run focused Fastify and Edge tests and confirm expected failures**

Run: `npm --prefix backend test -- --maxWorkers=1 test/admin.test.ts test/admin-page.test.ts test/devices.test.ts` and `npm run test:edge -- --maxWorkers=1 supabase/tests/devices.test.ts supabase/tests/admin.test.ts`

Expected: tests fail until device-policy routes/UI and legacy lock checks are removed.

- [ ] **Step 3: Implement the matching adapter/UI removal**

Delete `adminSetDevicePolicy` and both route bindings/schema bodies. Remove policy fields and controls from the admin page. Remove security-lock rejections from Edge auth and quota-derived values/imports from Edge devices.

- [ ] **Step 4: Re-run the focused tests**

Run the commands from Step 2 and confirm Fastify and Edge contracts match.

### Task 4: Add the database repair and complete PostgREST lockdown

**Files:**
- Modify: `backend/src/db/ddl.ts`, `scripts/gen-setup-sql.mjs`, `supabase/setup.sql`
- Modify: `supabase/tests/quota.test.ts`

**Interfaces:**
- Produces: idempotent schema bootstrap that clears only `security_lock_reason = 'device_switch_limit'` and generated zero-policy RLS for every server-owned table, including `device_security_events`.

- [ ] **Step 1: Write a failing database/setup behavior test**

Update quota coverage to push one sync record, assert it remains stored and retrievable, and calculate capacity including `records`; add a DDL test assertion that an affected lock clears while `blocked=true` remains unchanged.

- [ ] **Step 2: Run focused tests and confirm expected failures**

Run: `npm run test:edge -- --maxWorkers=1 supabase/tests/quota.test.ts` and `npm --prefix backend test -- --maxWorkers=1 test/tombstone-purge.test.ts`

Expected: the sync budget/repair coverage fails until the new setup behavior exists.

- [ ] **Step 3: Implement and regenerate**

Append the guarded user-row update to canonical DDL. Add `device_security_events` to `RLS_TABLES`; verify the list covers every table in `backend/src/db/schema.ts`; run `node scripts/gen-setup-sql.mjs` to regenerate `supabase/setup.sql`.

- [ ] **Step 4: Re-run focused tests**

Run the commands from Step 2 and confirm database behavior and quota coverage pass.

### Task 5: Regenerate shared backend and verify release-facing contracts

**Files:**
- Regenerate: `supabase/functions/api/shared/*`, `supabase/setup.sql`
- Modify only if stale: `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, `docs-fa/CODEBASE_GUIDE.md`

- [ ] **Step 1: Generate shared canonical modules**

Run: `npm run sync:edge`

- [ ] **Step 2: Check parity and type safety**

Run: `npm --prefix backend run typecheck`, `npm --prefix backend test -- --maxWorkers=1 test/edge-parity.test.ts`, and `npm run test:edge -- --maxWorkers=1 supabase/tests/sync.test.ts supabase/tests/devices.test.ts supabase/tests/admin.test.ts supabase/tests/quota.test.ts`.

- [ ] **Step 3: Run affected backend suites**

Run: `npm --prefix backend test -- --maxWorkers=1 test/sync.test.ts test/devices.test.ts test/device-security.test.ts test/device-limit.test.ts test/concurrency.test.ts test/admin.test.ts test/admin-page.test.ts test/tombstone-purge.test.ts`.

- [ ] **Step 4: Update stale architecture documentation and inspect generated diffs**

Describe cloud sync, unlimited devices, retained session security, and default-deny RLS accurately. Inspect `git diff --check` and generated output; do not apply SQL to production.

## Self-Review

- Sync, unlimited devices, orphan lock removal, admin/API/UI cleanup, SQL repair, RLS lockdown, Edge regeneration, and required parity tests each have an implementation task.
- No trial, entitlement gate, pricing, record protocol, or destructive column/table change is included.
- The plan keeps tests first for every behavior change and isolates generated files to documented generators.
