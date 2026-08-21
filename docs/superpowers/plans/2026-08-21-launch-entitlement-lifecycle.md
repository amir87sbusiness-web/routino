# Launch Entitlement Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one explicit seven-day server trial available exactly once while making resolved server entitlement authoritative on every vault.

**Architecture:** Serialize trial activation by locking the existing user row and checking both grant and entitlement history inside one transaction. Resolve the legacy client bridge with one vault-local metadata bit and a tested resolver that preserves access only across temporary import failures.

**Tech Stack:** TypeScript, Fastify, Hono, Drizzle/Postgres/PGlite, React, Dexie/localStorage, Vitest.

## Global Constraints

- `backend/src/` remains canonical; never edit generated Edge shared files by hand.
- Keep custom JWT/device revocation, generic `records` sync, Dexie, grants, payments and owner bootstrap semantics.
- Trial duration is exactly seven days and is never computed by the client.
- `hasSettledGrant()` remains payment-and-migration-only.
- Prompt 5 owns activation UI; this plan adds no activation screen.

---

### Task 1: Remove account-creation grants

**Files:**
- Modify: `backend/test/auth.test.ts`
- Modify: `backend/test/password-auth.test.ts`
- Create: `backend/test/owner-bootstrap.test.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/services/admin.ts`
- Modify: `supabase/functions/api/routes/auth.ts`
- Modify: `supabase/tests/auth.test.ts`

**Interfaces:**
- Consumes: existing `readEntitlement`, admin password route, and `ensureOwner`.
- Produces: new OTP/admin accounts with `{status:"none"}` and zero grants; unchanged owner grant.

- [ ] **Step 1: Write failing signup/admin/owner assertions**

Assert literal `none`, `expiresAt: null`, zero new-account grants, and an owner-bootstrap result with entitlement `planId="owner"` plus one `source="admin"` ledger row.

- [ ] **Step 2: Run RED tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/auth.test.ts test/password-auth.test.ts test/owner-bootstrap.test.ts`

Expected: signup/admin tests fail because current code inserts automatic grants; owner bootstrap passes.

- [ ] **Step 3: Remove only automatic grant calls**

Delete `TRIAL_DAYS` and `grantInterval` use from both auth adapters, and delete the new-account grant branch from `adminSetPassword`; do not edit `owner-bootstrap.ts`.

- [ ] **Step 4: Run GREEN tests**

Run the same backend command and `npx vitest run -c vitest.edge.config.ts --maxWorkers=1 supabase/tests/auth.test.ts`.

### Task 2: Add transaction-safe trial activation

**Files:**
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/services/entitlement.ts`
- Modify: `backend/src/routes/subscriptions.ts`
- Modify: `backend/test/entitlement.test.ts`
- Modify: `backend/test/subscriptions.test.ts`
- Modify: `supabase/functions/api/routes/subscriptions.ts`
- Modify: `supabase/tests/subscriptions.test.ts`

**Interfaces:**
- Produces: `startTrialOnce(db, userId, now): Promise<{entitlement: Entitlement; started: boolean; reason?: "previous_grant" | "entitlement_exists"}>`.
- Produces: authenticated `POST /v1/subscriptions/trial/start` on both HTTP adapters.

- [ ] **Step 1: Write failing service and route tests**

Cover first start, retry expiry equality, `Promise.all` starts producing one grant, second-device reuse, expired trial, each prior source, and a manually inserted entitlement without ledger history.

- [ ] **Step 2: Run RED tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/entitlement.test.ts test/subscriptions.test.ts`

Expected: imports/routes for `startTrialOnce` are missing.

- [ ] **Step 3: Implement typed transactional service**

Export a shared executor type covering database and both Drizzle transaction types. In `startTrialOnce`, call `db.transaction`, execute `select id from users where id = ${userId} for update`, inspect any `grants` row and any `entitlements` row, then call `grantInterval(tx, userId, {planId:"trial", days:7, source:"trial"}, now)` only when both are absent.

- [ ] **Step 4: Add thin routes and run GREEN tests**

Fastify returns `startTrialOnce(db, requireUser(req).id, now())`; Hono mirrors it with the existing auth middleware. Run backend and Edge subscription tests.

### Task 3: Make client entitlement resolution explicit

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/lib/db/local.ts`
- Modify: `src/lib/logic.ts`
- Modify: `src/lib/wipe.ts`
- Create: `src/lib/entitlement-migration.ts`
- Create: `src/lib/entitlement-migration.test.ts`
- Modify: `src/lib/logic.test.ts`
- Modify: `src/lib/wipe.test.ts`
- Modify: `src/lib/api/auth.ts`

**Interfaces:**
- Produces: vault-local `db.meta.legacyEntitlementMigrationResolved: boolean`.
- Produces: `resolveServerEntitlement(db, entitlement, importLegacy, now): Promise<Db>`.
- Produces: typed `startTrial(): Promise<TrialStartResult>` client API.

- [ ] **Step 1: Write failing explicit-null and migration tests**

Assert `loginAs(db, phone, null)` clears, resolved `none` clears and heals clock state, unresolved active legacy import failure preserves, success resolves, and later `none` does not import again.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- --maxWorkers=1 src/lib/wipe.test.ts src/lib/logic.test.ts src/lib/entitlement-migration.test.ts`

- [ ] **Step 3: Implement minimal resolver and API types**

Use `serverSubscription === undefined ? db.subscription : serverSubscription`; apply null authoritatively; on unresolved `none`, import only an unexpired local subscription and mark resolved only after a definitive response. Add `POST /subscriptions/trial/start` without local date arithmetic.

- [ ] **Step 4: Run GREEN tests**

Run the same frontend test command.

### Task 4: Integrate resolver into login, sync and refresh

**Files:**
- Modify: `src/routes/auth.tsx`
- Modify: `src/state/app.tsx`
- Modify: `src/routes/-auth.test.tsx`
- Modify: `src/state/app-sync.test.tsx`

**Interfaces:**
- Consumes: complete `ServerEntitlement` and `resolveServerEntitlement`.
- Produces: every authoritative login/sync/refresh answer goes through the same migration and clock policy.

- [ ] **Step 1: Write failing lifecycle tests**

Assert login switches/hydrates the target vault before evaluating legacy access, transient import failure retries on a later server answer, resolved migration never imports again, and sync `none` clears stale cached access.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- --maxWorkers=1 src/routes/-auth.test.tsx src/state/app-sync.test.tsx`

- [ ] **Step 3: Route full entitlement objects through AppProvider**

Change `switchAccount` to accept `ServerEntitlement`, resolve after target-vault hydrate, preserve `undefined` only for genuinely absent sync answers, and make explicit `none` flow through live and hydrated state. Make `SKIP_SMS` call `loginAs(d, canonical, d.subscription)`.

- [ ] **Step 4: Run GREEN tests**

Run the same frontend test command.

### Task 5: Preserve payment semantics, sync generated Edge code, and verify

**Files:**
- Modify: `backend/test/payments.test.ts`
- Modify: other payment tests only where they explicitly depend on trial stacking
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Generate: `supabase/functions/api/shared/*` through `npm run sync:edge`

**Interfaces:**
- Consumes: authenticated trial-start route and unchanged payment grant logic.
- Produces: current docs, generated parity and complete regression evidence.

- [ ] **Step 1: Start a trial explicitly in the one stacking payment test**

Call `/v1/subscriptions/trial/start` before checkout only where the expected result includes remaining trial time; keep payment implementation unchanged.

- [ ] **Step 2: Update the three Persian architecture guides**

Document signup `none`, explicit one-time activation, authoritative resolved `none`, temporary legacy preservation and the vault-local resolution bit.

- [ ] **Step 3: Generate and verify Edge parity**

Run: `npm run sync:edge` then `npm run test:edge -- --maxWorkers=1`.

- [ ] **Step 4: Run final checks**

Run targeted backend auth/entitlement/subscription/payment tests, targeted frontend auth/entitlement tests, `cd backend && npm run typecheck`, root `npx tsc --noEmit`, parity tests, and `git diff --check`.
