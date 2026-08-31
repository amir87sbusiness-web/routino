# Fast, Low-Load Admin Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make successful admin OTP login transition immediately and serve overview metrics through one API request backed by one aggregate SQL statement.

**Architecture:** Keep the existing Fastify/Edge route contract, but replace the eight-query overview fan-out with one parameterized aggregate statement. Decouple authentication success from overview loading, cache only the aggregate overview in same-tab `sessionStorage`, revalidate once in the background, and never poll or cache sensitive rows.

**Tech Stack:** TypeScript, Fastify, Supabase Edge/Hono shared modules, Drizzle SQL, PostgreSQL/PGlite, Vitest, JSDOM.

## Global Constraints

- `backend/src/` is canonical; generated `supabase/functions/api/shared/` files are changed only by `npm run sync:edge`.
- No schema migration, production data rewrite, new table, materialized view, cron job, realtime subscription, or new index.
- A dashboard refresh performs exactly one `GET /v1/admin/overview` request and `adminOverview` performs exactly one `db.execute()` call.
- No polling or automatic retry loop; only initial load, explicit refresh, and refresh after a successful relevant mutation.
- Cache only aggregate overview metrics in versioned `sessionStorage`; never cache phones, user/payment/discount rows, OTPs, CSRF values, cookies, or secrets.
- Preserve the existing owner phone, OTP rate limits, HttpOnly cookie lifetime/renewal, CSRF checks, Cloudflare proxy, and route response contract.
- Do not apply the legacy-table contract migration or remove production secrets as part of this change.

---

### Task 1: Replace overview fan-out with one aggregate SQL statement

**Files:**
- Modify: `backend/test/admin.test.ts`
- Modify: `backend/src/services/admin.ts`

**Interfaces:**
- Consumes: `adminOverview(db: Database, now: Date)` and the existing overview JSON contract.
- Produces: the same overview JSON contract using one call to `db.execute()` and `rowsOf()`.

- [ ] **Step 1: Write a failing one-execution behavior test**

Add `vi` and `adminOverview` imports, seed representative users/payment data using the existing helpers, spy on the injected PGlite database's public `execute` method, then call the service directly:

```ts
const execute = vi.spyOn(h.db, "execute");
const result = await adminOverview(h.db, new Date());

expect(execute).toHaveBeenCalledTimes(1);
expect(result.users.total).toBe(1);
expect(result.payments.paidTotal).toBe(1);
expect(result.payments.revenueToman).toBe(149000);
```

The existing route-level overview test remains to protect the HTTP response contract.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
Push-Location backend
npm test -- --run test/admin.test.ts --maxWorkers=1
Pop-Location
```

Expected: FAIL because the current implementation does not call `db.execute()` once; it issues eight query-builder operations.

- [ ] **Step 3: Implement the single aggregate statement**

Change `backend/src/services/admin.ts` to import `rowsOf` and replace the `Promise.all` block with one parameterized statement shaped like:

```ts
const result = await db.execute(sql`
  with user_stats as (
    select
      count(*) as total,
      count(*) filter (where ${users.createdAt} > ${dayAgo.toISOString()}::timestamptz) as last_24h
    from ${users}
  ), subscription_stats as (
    select count(*) filter (
      where ${entitlements.expiresAt} > ${now.toISOString()}::timestamptz
    ) as active
    from ${entitlements}
  ), payment_stats as (
    select
      count(*) filter (where ${payments.status} = 'paid') as paid_total,
      coalesce(sum(${payments.amountToman}) filter (where ${payments.status} = 'paid'), 0) as revenue,
      count(*) filter (
        where ${payments.status} = 'paid'
          and ${payments.createdAt} > ${dayAgo.toISOString()}::timestamptz
      ) as paid_last_24h,
      coalesce(sum(${payments.amountToman}) filter (
        where ${payments.status} = 'paid'
          and ${payments.createdAt} > ${dayAgo.toISOString()}::timestamptz
      ), 0) as revenue_last_24h,
      count(*) filter (where ${payments.status} = 'redirected') as pending,
      count(*) filter (where ${payments.status} = 'verify_failed') as verify_failed
    from ${payments}
  ), otp_stats as (
    select count(*) filter (
      where ${otpCodes.createdAt} > ${dayAgo.toISOString()}::timestamptz
    ) as sent_last_24h
    from ${otpCodes}
  )
  select * from user_stats, subscription_stats, payment_stats, otp_stats
`);
```

Read the single row with `rowsOf<OverviewRow>(result)[0]`, convert driver-dependent `bigint`/string numerics with `Number(value ?? 0)`, and return the unchanged nested response with `serverTime: now.toISOString()`.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run the same Task 1 command. Expected: all `admin.test.ts` tests PASS and the execution spy reports exactly one call.

- [ ] **Step 5: Commit the backend query change**

```powershell
git add -- backend/src/services/admin.ts backend/test/admin.test.ts
git commit -m "perf: aggregate admin overview in one query"
```

---

### Task 2: Make OTP entry immediate and overview loading request-bounded

**Files:**
- Modify: `backend/test/admin-page.test.ts`
- Modify: `backend/src/lib/admin-page.ts`

**Interfaces:**
- Consumes: existing `/v1/admin/auth/session`, `/otp/request`, `/otp/verify`, `/logout`, and `/v1/admin/overview` routes.
- Produces: `loadOverview(): Promise<void>` with an in-flight coalescing guard and unchanged HTML route output.

- [ ] **Step 1: Write failing immediate-transition and coalescing tests**

Use an unresolved Promise for only the overview response. After OTP verification resolves—but before resolving overview—assert:

```ts
expect((document.querySelector("#panel") as HTMLElement).style.display).toBe("");
expect((document.querySelector("#login") as HTMLElement).style.display).toBe("none");
expect(document.querySelector("#pageStatus")?.textContent).toContain("به‌روزرسانی");
expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);
```

Call `window.loadOverview()` twice while the first request is unresolved and assert the overview fetch count remains one. Resolve the deferred response and assert the aggregate cards render.

- [ ] **Step 2: Run the page test and verify RED**

Run:

```powershell
Push-Location backend
npm test -- --run test/admin-page.test.ts --maxWorkers=1
Pop-Location
```

Expected: FAIL because `showPanel(await api("/overview"))` keeps the login screen visible until overview completes and concurrent refreshes are not coalesced.

- [ ] **Step 3: Implement immediate panel entry and bounded requests**

In the page script:

```js
const OVERVIEW_CACHE_KEY = "routino_admin_overview_v1";
const REQUEST_TIMEOUT_MS = 8000;
let overviewRequest = null;
```

Use `AbortController` and `setTimeout` inside a shared request helper. Always clear the timer in `finally`; do not automatically retry. Keep `credentials: "same-origin"`, mutation CSRF, and current error-message parsing.

After OTP verification:

```js
await authApi("/otp/verify", { method: "POST", body: { phone, code } });
showPanel(readOverviewCache());
void loadOverview();
```

`showPanel()` must display the shell immediately, render a supplied cached overview when present, and otherwise render skeletons. It must not wait for network I/O.

`loadOverview()` must return the active Promise when one exists, preserve rendered metrics during refresh, issue one API request, render/save the result, and clear the in-flight guard in `finally`. On failure, preserve any existing metrics and show a non-blocking stale/error status; show the retry state only when no metrics exist.

- [ ] **Step 4: Run the focused page tests and verify GREEN**

Run the same Task 2 command. Expected: PASS, with the panel visible before the deferred overview resolves and only one overview fetch in flight.

- [ ] **Step 5: Commit the immediate-login behavior**

```powershell
git add -- backend/src/lib/admin-page.ts backend/test/admin-page.test.ts
git commit -m "fix: enter admin panel before overview loads"
```

---

### Task 3: Add safe same-tab aggregate caching and practical dashboard states

**Files:**
- Modify: `backend/test/admin-page.test.ts`
- Modify: `backend/src/lib/admin-page.ts`
- Modify: `docs-fa/02-BACKEND.md`

**Interfaces:**
- Consumes: the unchanged overview response.
- Produces: versioned `{ version: 1, savedAt: number, data: Overview }` session snapshot and grouped overview presentation.

- [ ] **Step 1: Write failing cache-boundary tests**

Add tests that pre-seed `sessionStorage` in JSDOM and prove the snapshot is not rendered until `/auth/session` succeeds. Then assert it renders while the live overview Promise is pending. Add invalid-session and logout assertions:

```ts
expect(window.sessionStorage.getItem("routino_admin_overview_v1")).toBeNull();
```

Also retain the existing assertion that `ADMIN_PAGE` contains no `localStorage`, `ADMIN_TOKEN`, or `x-admin-token`.

- [ ] **Step 2: Run the focused page test and verify RED**

Run the Task 2 page-test command. Expected: FAIL because no versioned aggregate snapshot helpers exist yet.

- [ ] **Step 3: Implement validated snapshot helpers and grouped status UI**

Add `readOverviewCache`, `writeOverviewCache`, and `clearOverviewCache`. Parsing must be wrapped in `try/catch`; require `version === 1`, a finite `savedAt`, and numeric overview fields before rendering. Clear invalid payloads immediately.

The boot sequence becomes:

```js
await authApi("/session");
showPanel(readOverviewCache());
void loadOverview();
```

Clear the snapshot after logout and when any admin API returns 401. Do not clear it for a transient network timeout.

Refine the existing overview without adding endpoints: group cards under `امروز`, `کسب‌وکار`, and `نیاز به توجه`; show last-updated/refreshing/stale text; keep users, payments, and discounts lazy. Preserve responsive, keyboard, RTL, reduced-motion, and accessible live-region behavior.

Update `docs-fa/02-BACKEND.md` to state that overview is one SQL execution, login no longer waits for metrics, aggregate caching is same-tab only, and there is no polling.

- [ ] **Step 4: Run page tests and inspect the rendered page**

Run the focused page tests. Then run `Push-Location backend; npm run dev` against the existing local development configuration, open `http://localhost:3000/admin` at mobile and desktop widths, and verify no overflow, console errors, inaccessible controls, or blocked login transition. Use only the local console SMS provider if exercising OTP; do not send a production SMS during this inspection. Stop the development process and run `Pop-Location` when inspection finishes.

- [ ] **Step 5: Run the frontend mechanical design detector once**

```powershell
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json backend/src/lib/admin-page.ts
```

Review every reported issue, fix only genuine problems within the admin panel scope, and rerun the focused page test after any edit.

- [ ] **Step 6: Commit cache, UI states, and documentation**

```powershell
git add -- backend/src/lib/admin-page.ts backend/test/admin-page.test.ts docs-fa/02-BACKEND.md
git commit -m "perf: keep admin overview ready without polling"
```

---

### Task 4: Synchronize Edge and run the production-safety verification set

**Files:**
- Regenerate: `supabase/functions/api/shared/lib/admin-page.ts`
- Regenerate: `supabase/functions/api/shared/services/admin.ts`
- Verify only: all other files.

**Interfaces:**
- Consumes: canonical backend changes from Tasks 1–3.
- Produces: Edge copies that pass the repository parity contract.

- [ ] **Step 1: Regenerate Edge shared files**

```powershell
npm run sync:edge
```

Review the generated diff and verify the two intended shared modules are the only semantic changes caused by this feature.

- [ ] **Step 2: Run focused and full verification**

```powershell
Push-Location backend
npm run typecheck
npm test -- --maxWorkers=1
Pop-Location
npm run test:edge -- --maxWorkers=1
npm test -- --run backend/test/admin-page.test.ts backend/test/edge-parity.test.ts --maxWorkers=1
npm run build
```

Expected: all commands exit 0 with no parity drift. If an unrelated dirty-worktree change causes a failure, diagnose it without resetting or overwriting the user's change.

- [ ] **Step 3: Review the complete feature diff and commit generated parity**

```powershell
git diff --check
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- backend/src/services/admin.ts backend/src/lib/admin-page.ts backend/test/admin.test.ts backend/test/admin-page.test.ts docs-fa/02-BACKEND.md supabase/functions/api/shared/services/admin.ts supabase/functions/api/shared/lib/admin-page.ts
git add -- supabase/functions/api/shared/services/admin.ts supabase/functions/api/shared/lib/admin-page.ts
git commit -m "chore: sync fast admin overview to edge"
```

- [ ] **Step 4: Verify branch state**

Confirm every committed file belongs to this feature and list pre-existing unstaged files separately. Do not stage `skill-observations/log.md` or unrelated user changes wholesale.

---

### Task 5: Deploy only the Edge code and verify production read-only

**Files:**
- Deploy artifact: `supabase/functions/api/`
- No database migration.

**Interfaces:**
- Consumes: a fully passing Task 4 commit and access to the already-confirmed Supabase project.
- Produces: a new `api` Edge function version; Cloudflare proxy configuration remains unchanged.

- [ ] **Step 1: Reconfirm target and release scope**

Verify the Supabase project reference matches the Routino production project, the diff contains no migration, and no production row mutation is required. Do not create, print, or store a new access token if an authenticated deployment path is unavailable.

- [ ] **Step 2: Deploy the Edge function**

```powershell
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```

Use the authenticated environment/dashboard path without echoing credentials. A deployment command exit 0 proves only upload success, not application correctness.

- [ ] **Step 3: Run read-only production smoke checks**

Check `/health`, `/health/ready`, `/v1/plans`, `/admin`, allowed/blocked CORS behavior, and that the retired `x-admin-token` remains rejected. Do not create a payment, grant, discount, user, or data record.

- [ ] **Step 4: Verify one real owner login without mutation**

With the owner's explicit OTP interaction, verify that the panel becomes visible immediately after code acceptance, the browser sends exactly one overview request, the request completes successfully, refresh does not duplicate in-flight calls, and no console error occurs. Do not expose the phone or OTP in logs/output.

- [ ] **Step 5: Report release boundaries**

Report separately: committed code, local test evidence, deployed Edge version, live read-only evidence, and any still-pending Cloudflare/main/legacy-secret or migration work. Never describe pending work as completed.
