# Restore Admin User Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing admin panel list, search, detail, and grant workflow for every user row while leaving Trial retention unchanged.

**Architecture:** Remove only the retention-era visibility predicate from the shared admin query service. Prove the restored behavior through Fastify and Edge integration tests, regenerate the Edge mirror from canonical backend source, then run the full retention and application verification matrix. Production backup and aggregate dry-run are release gates; no migration, cron change, cleanup call, or deletion is part of this implementation.

**Tech Stack:** TypeScript, Fastify, Hono/Supabase Edge, Drizzle ORM, PostgreSQL/PGlite, Vitest, React/Vite.

## Global Constraints

- Trial remains exactly seven days.
- Deletion remains based on the later of `users.created_at + 30 days` and the active Trial expiry; activity never extends it.
- Any non-Trial/admin grant, payment row, redemption, referenced financial artifact, or inconsistent state remains fail-closed and ineligible.
- Do not modify payment, sync, archive, quota, `records`, `taskMonths`, customer UI, retention SQL, migration, or cron behavior.
- Do not install or run a migration or cron, invoke cleanup, or delete production data without separate approval after backup and dry-run evidence.
- Work on current `main`; generated `supabase/functions/api/shared/` files change only through `npm run sync:edge`.

---

### Task 1: Restore every existing user to admin list and detail

**Files:**
- Modify: `backend/test/admin.test.ts`
- Modify: `backend/src/services/admin.ts`

**Interfaces:**
- Consumes: `adminListUsers(db, { q, limit }, now)` and `adminUserDetail(db, id, now)`.
- Produces: unchanged response contracts; only the set of visible existing users returns to all `users` rows.

- [ ] **Step 1: Write failing integration tests for the restored contract**

Replace the tests that expect hidden registration/Trial accounts with behavior assertions that:

```ts
const registration = await signIn("09123334444");
const trial = await signIn("09124445566");
await h.app.inject({
  method: "POST",
  url: "/v1/subscriptions/trial/start",
  headers: { authorization: `Bearer ${trial.access}` },
});

const searched = await h.app.inject({
  method: "GET",
  url: "/v1/admin/users?q=0912",
  headers: admin,
});
expect(searched.json().users.map((user: { id: string }) => user.id).sort()).toEqual(
  [registration.user.id, trial.user.id].sort(),
);

const detail = await h.app.inject({
  method: "GET",
  url: `/v1/admin/users/${trial.user.id}`,
  headers: admin,
});
expect(detail.statusCode).toBe(200);
expect(detail.json().entitlement.planId).toBe("trial");
```

Add the remaining categories with existing public flows and a controlled expiry update:

```ts
const expired = await signIn("09125556677");
await h.app.inject({
  method: "POST",
  url: "/v1/subscriptions/trial/start",
  headers: { authorization: `Bearer ${expired.access}` },
});
await h.query(`
  update entitlements set expires_at = '2026-01-08T00:00:00Z'
   where user_id = '${expired.user.id}';
  update grants set expires_after = '2026-01-08T00:00:00Z'
   where user_id = '${expired.user.id}' and source = 'trial'
`);

const granted = await signIn("09126667788");
await h.app.inject({
  method: "POST",
  url: `/v1/admin/users/${granted.user.id}/grant`,
  headers: admin,
  payload: { months: 1, note: "visibility fixture" },
});

const financial = await signIn("09127778899");
await h.app.inject({
  method: "POST",
  url: "/v1/payments/checkout",
  headers: { authorization: `Bearer ${financial.access}` },
  payload: { planId: "m1", attemptId: crypto.randomUUID() },
});

const all = (await h.app.inject({
  method: "GET",
  url: "/v1/admin/users",
  headers: admin,
})).json().users as { id: string }[];
expect(all.map((user) => user.id).sort()).toEqual([
  registration.user.id,
  trial.user.id,
  expired.user.id,
  granted.user.id,
  financial.user.id,
].sort());
```

This test catches any predicate that hides a still-existing category.

- [ ] **Step 2: Run the focused backend tests and verify RED**

Run:

```powershell
Push-Location backend
npm test -- admin.test.ts --maxWorkers=1
Pop-Location
```

Expected: the new list/detail expectations fail because `adminUserIsVisible()` still excludes registration-only and Trial-only rows.

- [ ] **Step 3: Remove only the visibility predicate**

In `backend/src/services/admin.ts`:

- Remove `adminUserIsVisible()`.
- Remove imports used only by that predicate.
- In `adminListUsers`, use `ilike(users.phone, ...)` for searched requests and no `where` clause for unfiltered requests.
- In `adminUserDetail`, use only `eq(users.id, id)`.
- Keep ordering, limit, response fields, `subscriptionActive`, overview metrics, and grant code unchanged.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run the same command and require all `admin.test.ts` tests to pass.

- [ ] **Step 5: Commit the backend behavior**

```powershell
git add backend/src/services/admin.ts backend/test/admin.test.ts
git commit -m "fix: restore all users in admin panel"
```

---

### Task 2: Prove Edge parity and preserve the panel UI

**Files:**
- Modify: `supabase/tests/admin.test.ts`
- Generated: `supabase/functions/api/shared/services/admin.ts`
- Verify unchanged: `backend/src/lib/admin-page.ts`
- Verify unchanged: `backend/test/admin-page.test.ts`

**Interfaces:**
- Consumes: Edge `GET /v1/admin/users`, `GET /v1/admin/users/:id`, and `POST /v1/admin/users/:id/grant`.
- Produces: the same visible-user behavior in the deployed Edge runtime without a new query parameter or control.

- [ ] **Step 1: Write the failing Edge test**

Change the Edge test that expects an empty search result so it asserts registration-only and Trial-only accounts are returned. Open the Trial-only detail and grant it one admin month, then assert the response is active and the grant ledger contains `source = 'admin'`.

- [ ] **Step 2: Run the focused Edge test and verify RED before syncing**

```powershell
npm run test:edge -- supabase/tests/admin.test.ts --maxWorkers=1
```

Expected: failure because the generated Edge mirror still contains the old visibility predicate.

- [ ] **Step 3: Regenerate Edge shared source**

```powershell
npm run sync:edge
```

Do not hand-edit generated files.

- [ ] **Step 4: Run focused Edge and panel tests and verify GREEN**

```powershell
npm run test:edge -- supabase/tests/admin.test.ts --maxWorkers=1
Push-Location backend
npm test -- admin-page.test.ts admin.test.ts --maxWorkers=1
Pop-Location
```

Confirm the current HTML has no new selector, request, or visual change and still exposes search, detail, and grant controls.

- [ ] **Step 5: Commit Edge parity and tests**

```powershell
git add supabase/tests/admin.test.ts supabase/functions/api/shared/services/admin.ts
git commit -m "test: cover admin visibility on edge"
```

---

### Task 3: Refresh documentation and run complete verification

**Files:**
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Verify unchanged: `supabase/migrations/20260903120000_trial_account_retention.sql`
- Verify unchanged: `supabase/migrations/20260903121000_trial_account_cleanup_cron.sql`
- Verify unchanged: `supabase/precheck/20260902_trial_account_cleanup_dry_run.sql`

**Interfaces:**
- Consumes: project test/build scripts and retention SQL test suites.
- Produces: current operator documentation and a local release-evidence report.

- [ ] **Step 1: Update stale admin documentation**

State that the ordinary list/detail includes every existing account, Trial users remain grantable, and the anonymous Trial-start counter is an additional metric rather than a replacement for user visibility. Preserve the separate retention safety and release gates.

- [ ] **Step 2: Run retention-specific regression suites**

```powershell
Push-Location backend
npm test -- account-retention.test.ts account-retention-sql.test.ts account-retention-postgres-concurrency.test.ts deleted-account-token.test.ts admin.test.ts --maxWorkers=1
Pop-Location
```

Require the deadline, active-Trial deferral, admin/payment protection, concurrent purchase priority, complete cascade, archive/quota consistency, token rejection, and re-registration cases to pass.

- [ ] **Step 3: Run the full local matrix**

```powershell
npm test -- --maxWorkers=1
npm run test:edge -- --maxWorkers=1
npm run lint
npx tsc --noEmit
npm run build
Push-Location backend
npm test -- --maxWorkers=1
npm run typecheck
npm run build
Pop-Location
npm run sync:edge
git diff --exit-code -- supabase/functions/api/shared
git diff --check
```

- [ ] **Step 4: Verify the exact change boundary**

Use `git diff --stat 87d51e1..HEAD` and file-level diffs to confirm no retention SQL, payment, sync, archive, quota, customer UI, or admin HTML behavior changed. Confirm `main` is based on the latest known production retention commit.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs-fa/02-BACKEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md
git commit -m "docs: clarify admin visibility and retention boundary"
```

---

### Task 4: Production release gate without cleanup mutation

**Files:**
- Read only: `supabase/precheck/20260902_trial_account_cleanup_dry_run.sql`
- No repository mutation required unless a verified deployment record is intentionally added.

**Interfaces:**
- Consumes: the correct production Supabase project, recoverable backup tooling, aggregate dry-run SQL, Edge deployment tooling, and Cloudflare Pages deployment tooling.
- Produces: backup verification, anonymous dry-run totals, deployment evidence for backend/frontend only, and live smoke checks.

- [ ] **Step 1: Stop if production identity or backup authority is uncertain**

Resolve the exact production project/account from existing authenticated tooling without printing secrets. Do not infer production readiness from local tests.

- [ ] **Step 2: Take and verify a recoverable production backup**

Create a timestamped database dump outside the repository, compute its SHA-256, restore it into an isolated local database, and run read-only row/schema checks. A non-empty file alone is not sufficient proof.

- [ ] **Step 3: Run only the aggregate production dry-run**

Execute `supabase/precheck/20260902_trial_account_cleanup_dry_run.sql` read-only. Report only aggregate counts. Stop if any `selected_with_payment`, `selected_with_non_trial_grant`, `selected_with_used_redemption`, `selected_with_used_discount`, or `selected_with_referenced_private_discount` value is nonzero.

- [ ] **Step 4: Report the release gate and stop on any safety overlap**

Record backup restore evidence, dry-run totals, test counts, exact diff, and commit IDs. The user has authorized deployment of compatible application code, but not a migration, cron installation/change, cleanup invocation, manual deletion, or any other production retention mutation. Stop before application deployment if the backup or dry-run gate fails.

- [ ] **Step 5: Deploy only the already-authorized compatible application code**

Deploy the Edge backend through its existing channel, then verify `/health/ready`, `/v1/plans`, admin login/list/detail/grant availability, ordinary login, sync authentication, payment route safety, and the already-deployed deletion warning. Do not redeploy unchanged frontend assets merely to create a deployment, and do not perform a real grant or payment without explicit authorization.
