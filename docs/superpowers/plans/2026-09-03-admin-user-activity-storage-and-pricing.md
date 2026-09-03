# Admin User Activity, Storage, and Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-write user activity counters, existing storage counters, username search, reusable inline user details, and safe plan-price editing to the admin panel without adding client network requests.

**Architecture:** Store only `active_days` and `last_active_at` on each user and touch them atomically from the existing authenticated sync exchange. Read activity plus the existing `sync_record_count`/`sync_data_bytes` counters with bounded admin queries, cache on-demand user detail in the panel, and expose a CSRF-protected admin price mutation that leaves checkout server-authoritative.

**Tech Stack:** TypeScript, Fastify, Hono/Supabase Edge, Drizzle SQL, PostgreSQL/PGlite, Vitest, JSDOM, framework-free admin HTML/CSS/JavaScript.

## Global Constraints

- Do not add any client ping, polling, heartbeat request, or new app request; activity rides on `POST /v1/sync/exchange`.
- A Tehran calendar day is counted at most once per user; `last_active_at` records the latest successful exchange.
- Display `sync_data_bytes` as «حجم داده همگام‌شده», not total physical PostgreSQL disk usage.
- Do not scan `records` to populate admin user lists or details; use existing per-user counters.
- Discounts, discount codes, public offers, device controls, account blocking, token revoke, and cloud-only settings remain unchanged.
- Only `plans.price_toman` is editable; plan IDs, names, durations, active flags, old payments, and grants remain unchanged.
- Keep `backend/src/` canonical; regenerate only `supabase/functions/api/shared/` with `npm run sync:edge` and manually mirror route adapters.
- Never hand-edit `src/routeTree.gen.ts`, `www/`, `dist/`, or `supabase/functions/api/shared/`.
- Do not deploy, apply the production migration, or change a live price without separate user approval.

---

## File Map

- Create `backend/src/services/user-activity.ts`: one atomic, framework-free activity update.
- Create `backend/test/user-activity.test.ts`: Tehran-day and concurrency coverage.
- Create `supabase/migrations/20260903122000_user_activity_counters.sql`: additive production schema.
- Modify `backend/src/db/ddl.ts`: local/PGlite schema parity.
- Modify `backend/src/services/admin.ts`: bounded user metadata/search and plan read/update operations.
- Modify `backend/src/routes/sync.ts` and `supabase/functions/api/routes/sync.ts`: call activity update from existing exchange.
- Modify `backend/src/routes/admin.ts` and `supabase/functions/api/routes/admin.ts`: plan endpoints and validation.
- Modify `backend/src/lib/admin-page.ts`: design refresh, inline accordion, shared detail cache, price editor.
- Modify `backend/test/admin.test.ts`, `backend/test/admin-page.test.ts`, and relevant Edge tests: API/UI contracts.
- Modify `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, and `docs-fa/CODEBASE_GUIDE.md`: keep architecture guides current.
- Regenerate `supabase/functions/api/shared/` and `supabase/setup.sql` through project scripts only.

---

### Task 1: Add Atomic Activity Counters

**Files:**
- Create: `backend/src/services/user-activity.ts`
- Create: `backend/test/user-activity.test.ts`
- Create: `supabase/migrations/20260903122000_user_activity_counters.sql`
- Modify: `backend/src/db/ddl.ts`

**Interfaces:**
- Consumes: `Database` and an authenticated `userId` plus server `Date`.
- Produces: `touchUserActivity(db: Database, userId: string, now: Date): Promise<void>` and DB columns `users.active_days integer`, `users.last_active_at timestamptz`.

- [ ] **Step 1: Write failing activity tests**

Add tests which create one user, call the service at `2026-09-03T20:29:59Z`, `2026-09-03T20:30:01Z`, and again within the second Tehran day, then assert `active_days = 2` and `last_active_at` equals the newest instant. Add a `Promise.all` case for two calls on the same Tehran day and assert the count rises once.

```ts
await touchUserActivity(h.db, user.id, new Date("2026-09-03T20:29:59.000Z"));
await touchUserActivity(h.db, user.id, new Date("2026-09-03T20:30:01.000Z"));
await touchUserActivity(h.db, user.id, new Date("2026-09-04T08:00:00.000Z"));
expect(await activityRow(user.id)).toMatchObject({ active_days: 2 });
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd backend; npm test -- --run test/user-activity.test.ts --maxWorkers=1`

Expected: FAIL because the service and columns do not exist.

- [ ] **Step 3: Add the additive schema**

Add to both initial and upgrade sections of `SCHEMA_SQL`:

```sql
active_days integer not null default 0,
last_active_at timestamptz,
constraint users_active_days_nonnegative check (active_days >= 0)
```

Add equivalent idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and constraint creation to the migration. Do not backfill guessed activity for old users; they start at zero and `NULL`.

- [ ] **Step 4: Implement one atomic update**

Use one SQL statement whose row lock serializes concurrent updates:

```ts
export async function touchUserActivity(db: Database, userId: string, now: Date): Promise<void> {
  await db.execute(sql`
    update users
       set active_days = active_days + case
             when last_active_at is null
               or (last_active_at at time zone 'Asia/Tehran')::date
                  < (${now.toISOString()}::timestamptz at time zone 'Asia/Tehran')::date
             then 1 else 0 end,
           last_active_at = greatest(coalesce(last_active_at, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)
     where id = ${userId}::uuid
  `);
}
```

- [ ] **Step 5: Run activity and DDL tests**

Run: `cd backend; npm test -- --run test/user-activity.test.ts test/ddl.test.ts --maxWorkers=1`

Expected: PASS, including the Tehran-midnight and concurrent-update assertions.

- [ ] **Step 6: Commit the activity unit**

```powershell
git add backend/src/services/user-activity.ts backend/test/user-activity.test.ts backend/src/db/ddl.ts supabase/migrations/20260903122000_user_activity_counters.sql
git commit -m "feat: track daily user activity on sync"
```

---

### Task 2: Attach Activity to Existing Sync and Expose Lightweight User Metadata

**Files:**
- Modify: `backend/src/routes/sync.ts`
- Modify: `supabase/functions/api/routes/sync.ts`
- Modify: `backend/src/services/admin.ts`
- Modify: `backend/test/admin.test.ts`
- Modify: `backend/test/sync.test.ts`

**Interfaces:**
- Consumes: `touchUserActivity`, `sync_record_count`, `sync_data_bytes`, `active_days`, `last_active_at`.
- Produces: enriched user summaries/details with `username`, `activeDays`, `lastActiveAt`, `syncRecordCount`, `syncDataBytes`.

- [ ] **Step 1: Write failing route and admin-query tests**

Extend the sync route test to inject `POST /v1/sync/exchange` twice for an authenticated user and read activity columns directly. Extend admin tests to seed username and sync counters and assert list/detail responses expose camelCase fields. Search once by `0912` and once by a lowercase username fragment.

```ts
expect(list.json().users[0]).toMatchObject({
  username: "amir",
  activeDays: 3,
  syncRecordCount: 8,
  syncDataBytes: 2048,
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend; npm test -- --run test/sync.test.ts test/admin.test.ts --maxWorkers=1`

Expected: FAIL because sync does not touch activity and admin responses omit metadata/username search.

- [ ] **Step 3: Touch activity only after a successful exchange**

In both Fastify and Edge `POST /sync/exchange` adapters, call `touchUserActivity` after `exchangeRecords` resolves and before returning its page. Do not call it on authentication, validation, or exchange failures. Do not change the request or response shape.

- [ ] **Step 4: Replace the admin user list with one bounded SQL query**

Select the user, entitlement, activity, and accounting columns in one statement, retain `ORDER BY users.created_at DESC LIMIT n`, and search phone or lowercased username. Convert bigint/string counters with a safe nonnegative numeric helper before returning them.

```ts
return rows.map((row) => ({
  ...identityAndEntitlement,
  activeDays: metric(row.active_days),
  lastActiveAt: row.last_active_at,
  syncRecordCount: metric(row.sync_record_count),
  syncDataBytes: metric(row.sync_data_bytes),
}));
```

Use the same lightweight metadata projection in `adminUserDetail`; do not expose record contents.

- [ ] **Step 5: Run focused backend tests**

Run: `cd backend; npm test -- --run test/sync.test.ts test/admin.test.ts --maxWorkers=1`

Expected: PASS; query-count assertions show no per-user fan-out for the list.

- [ ] **Step 6: Commit sync/admin metadata**

```powershell
git add backend/src/routes/sync.ts supabase/functions/api/routes/sync.ts backend/src/services/admin.ts backend/test/admin.test.ts backend/test/sync.test.ts
git commit -m "feat: expose lightweight user activity metadata"
```

---

### Task 3: Add Safe Admin Plan Price Management

**Files:**
- Modify: `backend/src/services/admin.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `supabase/functions/api/routes/admin.ts`
- Modify: `backend/test/admin.test.ts`

**Interfaces:**
- Produces: `adminListPlans(db: Database)` and `adminUpdatePlanPrice(db: Database, id: string, priceToman: number)`.
- Produces HTTP: `GET /v1/admin/plans` and `POST /v1/admin/plans/:id` with `{ priceToman }`.

- [ ] **Step 1: Write failing admin plan tests**

Cover authenticated listing, CSRF-protected update, unknown plan 404, decimal/zero/negative/out-of-range 400, and a checkout created after the update using the new server price while an existing payment retains its stored amount.

```ts
const changed = await h.app.inject({
  method: "POST",
  url: "/v1/admin/plans/m1",
  headers: admin,
  payload: { priceToman: 69000 },
});
expect(changed.json().plan.priceToman).toBe(69000);
```

- [ ] **Step 2: Run the admin tests and confirm RED**

Run: `cd backend; npm test -- --run test/admin.test.ts --maxWorkers=1`

Expected: FAIL with missing admin plan routes.

- [ ] **Step 3: Implement plan service functions**

List plans ordered by `months`; update only `priceToman`; return 404 for unknown IDs. Keep all checkout/quote math in `services/pricing.ts` unchanged.

- [ ] **Step 4: Add identical Fastify and Hono route validation**

Use an integer schema with `min(1_000)` and `max(1_000_000_000)`. Register GET under admin session protection and POST under existing session plus CSRF protection. The POST body is exactly:

```ts
const adminPlanPriceBody = z.object({
  priceToman: z.number().int().min(1_000).max(1_000_000_000),
});
```

- [ ] **Step 5: Run admin and payment tests**

Run: `cd backend; npm test -- --run test/admin.test.ts test/payment-flow.test.ts test/pricing.test.ts --maxWorkers=1`

Expected: PASS; no payment-flow source changes.

- [ ] **Step 6: Commit price management**

```powershell
git add backend/src/services/admin.ts backend/src/routes/admin.ts supabase/functions/api/routes/admin.ts backend/test/admin.test.ts
git commit -m "feat: manage plan prices from admin"
```

---

### Task 4: Replace Dialog Details with a Shared Inline Accordion

**Files:**
- Modify: `backend/src/lib/admin-page.ts`
- Modify: `backend/test/admin-page.test.ts`

**Interfaces:**
- Consumes: enriched user list/detail responses and admin plan endpoints.
- Produces: `toggleUserDetails(source, userId, anchorKey)`, a shared per-user promise/data cache, and inline expandable rows for users/payments.

- [ ] **Step 1: Write failing JSDOM behavior tests**

Assert the page has no user dialog and no «جزئیات» button; user and payment rows have keyboard-capable toggles with `aria-expanded`; only one inline panel per table stays open; repeated opening of the same user triggers one `/users/:id` fetch; payment rows reuse the same cached detail; retry clears only the failed cache entry; plan save requires confirmation and posts `priceToman` with CSRF.

- [ ] **Step 2: Run the panel tests and confirm RED**

Run: `cd backend; npm test -- --run test/admin-page.test.ts --maxWorkers=1`

Expected: FAIL against the dialog-based page.

- [ ] **Step 3: Load the admin design context and quality floor**

Run once from the repo root:

```powershell
node C:\Users\User\.agents\skills\impeccable\scripts\context.mjs --target backend/src/lib/admin-page.ts
```

Then read `C:\Users\User\.agents\skills\impeccable\reference\polish.md` and `C:\Users\User\.agents\skills\impeccable\reference\craft-floor.md` before editing the UI.

- [ ] **Step 4: Build the shared detail cache and accordion renderer**

Use a `Map` keyed by user ID. Cache the in-flight promise immediately so simultaneous user/payment clicks coalesce. On rejection delete that key so retry works. Render detail inside a companion `<tr class="detail-row">` with a single spanning cell. Make the summary row operable with click, Enter, and Space, maintain `aria-expanded`, and ignore clicks originating from inputs/buttons inside the expanded content.

- [ ] **Step 5: Redesign the user and payment lists**

Show username, activity days, last activity, record count, and formatted bytes in the user summary. Make the payment phone/username identity clearly clickable and reveal the same user detail renderer below the payment. Preserve grant mutation behavior inside the expanded panel and refresh/cache invalidation after a successful grant.

- [ ] **Step 6: Add the plans tab and price editor**

Load `/plans` only when that tab is opened. Display immutable plan name/months and an editable Toman price. Disable save until the integer is valid and changed. Confirm with text containing both formatted old and new prices, POST the mutation, then replace that row with the returned plan. State that the public purchase page can take up to five minutes to reflect the change.

- [ ] **Step 7: Apply the visual and responsive system**

Load Vazirmatn through a stable font stylesheet with a safe system fallback; align colors/radii with the current app; add a quiet summary grid, clear expanded surface, strong focus-visible states, 44px interactive targets, mobile stacked user/payment cards, controlled horizontal history tables, and reduced-motion overrides. Do not add decorative metrics or fabricated data.

- [ ] **Step 8: Run panel tests and formatting**

Run: `cd backend; npm test -- --run test/admin-page.test.ts --maxWorkers=1`

Run: `npx prettier --check backend/src/lib/admin-page.ts backend/test/admin-page.test.ts`

Expected: PASS with no dialog contract and no extra repeated detail fetch.

- [ ] **Step 9: Commit the admin UI**

```powershell
git add backend/src/lib/admin-page.ts backend/test/admin-page.test.ts
git commit -m "feat: add inline admin user insights"
```

---

### Task 5: Synchronize Edge, Update Guides, and Verify the Full Change

**Files:**
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Regenerate: `supabase/functions/api/shared/**`
- Regenerate: `supabase/setup.sql`
- Test: relevant backend and Edge suites

**Interfaces:**
- Consumes: completed backend/activity/admin/UI behavior.
- Produces: deployable local source parity and current Persian architecture documentation.

- [ ] **Step 1: Update the Persian guides**

Document the precise activity definition, no-new-request property, Tehran day boundary, logical storage-byte meaning, accordion cache, username search, price endpoint, five-minute public cache delay, and deployment boundary. Remove the stale dialog description if present.

- [ ] **Step 2: Regenerate shared Edge code and setup SQL**

Run: `npm run sync:edge`

Run: `node scripts/gen-setup-sql.mjs`

Do not edit `supabase/setup.sql` directly.

- [ ] **Step 3: Run targeted backend and Edge verification**

Run: `cd backend; npm test -- --run test/user-activity.test.ts test/sync.test.ts test/admin.test.ts test/admin-page.test.ts test/payment-flow.test.ts test/pricing.test.ts --maxWorkers=1`

Run: `npm run test:edge -- --maxWorkers=1`

Run: `cd backend; npm test -- --run test/edge-parity.test.ts --maxWorkers=1`

Expected: all focused backend, Edge, and parity tests pass.

- [ ] **Step 4: Run static and build verification**

Run: `npm run lint`

Run: `cd backend; npm run typecheck; npm run build`

Run: `npm run build`

Expected: all commands exit zero.

- [ ] **Step 5: Perform bounded visual QA**

Start the local backend, sign into `/admin`, and capture desktop and narrow-mobile screenshots in one pass. Check typography, focus, accordion placement, table/card responsiveness, loading/error states, and plan-edit confirmation. Fix all observed defects in one batch, rebuild, then use at most one final screenshot pass.

- [ ] **Step 6: Inspect final scope and commit**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff HEAD~4 --stat`

Confirm no discount, payment-flow, generated hand-edit, secret, deployment, or unrelated file change. Commit docs/generated parity:

```powershell
git add docs-fa backend/src supabase/functions/api/shared supabase/setup.sql
git commit -m "docs: document admin activity and pricing"
```

- [ ] **Step 7: Report evidence and release boundary**

Report separately: source changed, migration prepared but unapplied, tests/builds passed, visual QA performed, and production deploy/migration/price changes not performed.
