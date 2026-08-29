# Low-Usage Lifecycle Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync only product content through one exchange request, batching edits for 10 seconds and flushing on background/close without periodic polling.

**Architecture:** All settings move to device-local storage. A new `POST /v1/sync/exchange` endpoint atomically applies dirty rows then returns changes after the caller's original cursor; account-state reads are opt-in. The client saves immediately to IndexedDB and schedules exchange on boot/login, a trailing 10-second edit window, background/close, failed-sync recovery, or relevant foreground.

**Tech Stack:** React, TypeScript, Dexie/IndexedDB, Capacitor App/HTTP, Fastify, Hono/Supabase Edge, Drizzle/Postgres, Vitest/PGlite.

## Global Constraints

- Product data is locally durable before any network call.
- Cloud-synced kinds are exactly categories, habits, logs, tasks, timer sessions, and journal entries.
- All settings, notifications, auth, entitlement cache, metadata, and sync bookkeeping are device-local.
- Push-before-pull, cursor safety, owner binding, LWW, tombstones, reset, and chunk limits remain unchanged.
- Edit batching is a trailing 10,000 ms window; background/close overrides it immediately.
- No periodic one-minute or ten-minute request and no realtime socket.
- No payment semantics, live deployment, or live migration change.

---

### Task 1: Make Every Setting Device-Local

**Files:**
- Modify: `src/lib/db/local.ts`
- Modify: `src/lib/db/dexie.ts`
- Modify: `src/lib/db/diff.ts`
- Modify: `src/lib/db/hydrate.ts`
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/lib/sync/merge.ts`
- Test: `src/lib/db/diff.test.ts`
- Test: `src/lib/db/migrate.test.ts`
- Test: `src/lib/sync/merge.test.ts`

**Interfaces:**
- `LocalState.settings: Settings` becomes the single persisted settings object.
- `SYNCABLE_TABLES` excludes `settings`.
- Dexie version 3 drops the obsolete `settings` object store.

- [ ] **Step 1: Write failing tests for the local-only boundary**

```ts
expect(diffDb(before, { ...before, settings: changedSettings })).toEqual([]);
expect(SYNCABLE_TABLES).toEqual(["categories", "habits", "logs", "tasks", "timerSessions", "journal"]);
expect((await hydrate()).db.settings).toEqual(savedLocal.settings);
expect(idb.tables.map((table) => table.name)).not.toContain("settings");
```

- [ ] **Step 2: Run local DB/sync tests and confirm failure**

Run: `npx vitest run src/lib/db/diff.test.ts src/lib/db/migrate.test.ts src/lib/sync/merge.test.ts --maxWorkers=1`  
Expected: FAIL while account settings still create synced records.

- [ ] **Step 3: Move settings wholly into `LocalState` and drop sync/storage handling**

```ts
export interface LocalState {
  auth: Auth | null;
  subscription: Subscription | null;
  notifications: AppNotification[];
  meta: Db["meta"];
  settings: Settings;
}
```

`loadLocal` must migrate existing flat local fields and combine them with any legacy IndexedDB settings once, preserving user preferences. `diffDb` emits no settings changes; remote settings are rejected/ignored.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run src/lib/db/diff.test.ts src/lib/db/migrate.test.ts src/lib/sync/merge.test.ts --maxWorkers=1`  
Expected: PASS.

```powershell
git add -- src/lib/db/local.ts src/lib/db/dexie.ts src/lib/db/diff.ts src/lib/db/hydrate.ts src/lib/db/migrate.ts src/lib/sync/merge.ts src/lib/db/diff.test.ts src/lib/db/migrate.test.ts src/lib/sync/merge.test.ts
git commit -m "refactor: keep all settings device local"
```

### Task 2: Add the One-Invocation Exchange Endpoint

**Files:**
- Modify: `backend/src/services/sync.ts`
- Modify: `backend/src/routes/sync.ts`
- Modify: `supabase/functions/api/routes/sync.ts`
- Modify: `src/lib/api/sync.ts`
- Test: `backend/test/sync.test.ts`
- Test: `supabase/tests/sync.test.ts`

**Interfaces:**
- Request: `ExchangeRequest = { cursor: number; records: PushRecord[]; includeAccountState?: boolean }`.
- Response: `ExchangeResult = { records; cursor; hasMore; reset; applied; skipped; entitlement? }`.
- Client: `exchangeRecords(request, expectedUserId, keepalive?): Promise<ExchangeResult>`.

- [ ] **Step 1: Add failing push-before-pull and account-state tests**

```ts
const res = await exchange({ cursor: 0, records: [localHabit], includeAccountState: false });
expect(res.applied).toBe(1);
expect(res.records).toContainEqual(expect.objectContaining({ id: localHabit.id }));
expect(res).not.toHaveProperty("entitlement");

const boot = await exchange({ cursor: res.cursor, records: [], includeAccountState: true });
expect(boot.entitlement).toMatchObject({ status: expect.any(String) });
```

Cover concurrent other-device writes between cursor and push, reset, pagination, duplicate keys, rejected size/kind, and the six-kind allow-list.

- [ ] **Step 2: Run Node/Edge sync tests and confirm endpoint absence**

Run: `cd backend; npx vitest run test/sync.test.ts --maxWorkers=1`  
Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1`  
Expected: FAIL with missing `/v1/sync/exchange`.

- [ ] **Step 3: Implement exchange using the existing canonical push/pull primitives**

```ts
export async function exchangeRecords(db, userId, input, now) {
  const pushed = await pushRecords(db, userId, input.records, now);
  const pulled = await pullRecords(db, userId, input.cursor);
  return { ...pulled, applied: pushed.applied, skipped: pushed.skipped };
}
```

The route performs entitlement/payment recovery only for `includeAccountState === true`. It must use the caller's original cursor, never the push cursor.

- [ ] **Step 4: Add client API transport including `keepalive`**

Extend `RequestOptions` with `keepalive?: boolean` for browser fetch; Capacitor ignores it. Bound exchange records with the existing 100-record/48 KB client chunks and 64 KB proxy limit.

- [ ] **Step 5: Run sync tests/typechecks and commit**

Run: `cd backend; npx vitest run test/sync.test.ts --maxWorkers=1`  
Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/sync.test.ts --maxWorkers=1`  
Run: `cd backend; npm run typecheck`  
Run: `npx tsc --noEmit`  
Expected: PASS.

```powershell
git add -- backend/src/services/sync.ts backend/src/routes/sync.ts supabase/functions/api/routes/sync.ts src/lib/api/sync.ts src/lib/api/client.ts backend/test/sync.test.ts supabase/tests/sync.test.ts
git commit -m "feat: exchange sync changes in one invocation"
```

### Task 3: Convert the Client Engine to Exchange

**Files:**
- Modify: `src/lib/sync/engine.ts`
- Test: `src/lib/sync/engine.test.ts`

**Interfaces:**
- `syncNow(owner, options?): Promise<SyncOutcome>`.
- `SyncOptions = { includeAccountState?: boolean; keepalive?: boolean; pullRequired?: boolean }`.
- `hasPendingChanges(): Promise<boolean>` exposes whether lifecycle/online triggers need a request.

- [ ] **Step 1: Replace fake push/pull tests with failing exchange tests**

```ts
expect(server.exchanges).toHaveLength(1);
expect(server.exchanges[0]).toMatchObject({ cursor: 0, records: [expect.objectContaining({ id: "h1" })] });
expect(outcome.entitlement).toBeUndefined();
```

Retain all existing multi-device, cursor, outbox race, 4xx rejection, tombstone reset, account switch, and IndexedDB-loss scenarios.

- [ ] **Step 2: Run engine tests and confirm failure**

Run: `npx vitest run src/lib/sync/engine.test.ts --maxWorkers=1`  
Expected: FAIL because engine still makes separate push and pull calls.

- [ ] **Step 3: Implement chunked exchange without cursor skipping**

For each accepted chunk, apply returned remote records and save the returned pull cursor. If a chunk is rejected with a permanent 4xx, count it and continue. If no records remain but `pullRequired` or `includeAccountState` is true, send one empty exchange. Never send an empty ordinary background exchange.

- [ ] **Step 4: Run engine tests and commit**

Run: `npx vitest run src/lib/sync/engine.test.ts --maxWorkers=1`  
Expected: PASS, including one exchange for the common one-chunk path.

```powershell
git add -- src/lib/sync/engine.ts src/lib/sync/engine.test.ts
git commit -m "refactor: use one-request sync exchange"
```

### Task 4: Add the 10-Second Lifecycle Scheduler

**Files:**
- Create: `src/lib/sync/scheduler.ts`
- Create: `src/lib/sync/scheduler.test.ts`
- Modify: `src/state/app.tsx`
- Modify: `src/state/app-sync.test.tsx`
- Modify: `src/client.tsx`

**Interfaces:**
- `createSyncScheduler({ flush, hasPending, now, setTimer, clearTimer })`.
- Methods: `markDirty(owner)`, `flushNow(owner, options)`, `onOnline(owner)`, `onForeground(owner)`, `dispose()`.
- Constant: `EDIT_SYNC_DELAY_MS = 10_000`.

- [ ] **Step 1: Write scheduler tests with fake timers**

```ts
scheduler.markDirty("u1");
vi.advanceTimersByTime(9_999);
expect(flush).not.toHaveBeenCalled();
vi.advanceTimersByTime(1);
expect(flush).toHaveBeenCalledTimes(1);
```

Also test timer reset by another edit, immediate hidden/pagehide/native-background flush, no empty online request, boot account-state pull, one login catch-up only, failed-sync retry, owner switch, and disposal.

- [ ] **Step 2: Run scheduler/provider tests and confirm failure**

Run: `npx vitest run src/lib/sync/scheduler.test.ts src/state/app-sync.test.tsx --maxWorkers=1`  
Expected: FAIL because polling/debounce lifecycle is still embedded in `AppProvider`.

- [ ] **Step 3: Implement scheduler and integrate after IndexedDB persistence**

Replace `SYNC_DEBOUNCE_MS = 600` and `VISIBLE_SYNC_INTERVAL_MS` with the scheduler. `write.then(...)` calls `markDirty(owner)`. Boot uses `includeAccountState: true, pullRequired: true`. Login performs immediate account-state sync and one catch-up timer. Online calls only when pending/failed. Visible foreground pulls only when stale/failed; it never starts an interval.

- [ ] **Step 4: Add close/background transport**

Listen to `visibilitychange` hidden and `pagehide` for `keepalive: true`; dynamically register Capacitor `App.addListener("appStateChange", ({ isActive }) => !isActive && flushNow(...))`. Remove listeners on cleanup and do not duplicate web/native triggers.

- [ ] **Step 5: Run lifecycle tests and commit**

Run: `npx vitest run src/lib/sync/scheduler.test.ts src/state/app-sync.test.tsx --maxWorkers=1`  
Expected: PASS with zero periodic API timers.

```powershell
git add -- src/lib/sync/scheduler.ts src/lib/sync/scheduler.test.ts src/state/app.tsx src/state/app-sync.test.tsx src/client.tsx
git commit -m "feat: sync on idle and app lifecycle"
```

### Task 5: Quota Guard, Edge Parity, and Full Regression

**Files:**
- Modify: `supabase/tests/quota.test.ts`
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Regenerate: `supabase/functions/api/shared/`

**Interfaces:**
- Quota model counts boot plus changed-session close/idle exchanges, not visible-minute polling.
- Documentation names the 10-second best-effort lifecycle contract and browser hard-kill limitation.

- [ ] **Step 1: Update quota test assertions**

```ts
const dailyInvocations = 2;
const monthlyDau = Math.floor(500_000 / (dailyInvocations * 30));
expect(monthlyDau).toBeGreaterThan(8_000);
```

Keep exceptional login/payment/admin calls outside the steady-state claim and continue measuring database bytes per user and response sizes.

- [ ] **Step 2: Regenerate Edge shared sources and update docs**

Run: `npm run sync:edge`  
Document synced kinds, local-only settings, exchange endpoint, 10-second batching, immediate lifecycle flush, login catch-up, retry semantics, and no polling/realtime.

- [ ] **Step 3: Run focused budget/parity checks**

Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/quota.test.ts supabase/tests/sync.test.ts --maxWorkers=1`  
Run: `npm run test:edge -- --maxWorkers=1`  
Expected: PASS.

- [ ] **Step 4: Run complete verification**

Run: `cd backend; npm test -- --maxWorkers=1`  
Run: `cd backend; npm run typecheck`  
Run: `npm test -- --maxWorkers=1`  
Run: `npm run lint`  
Run: `npm run build`  
Run: `npm run build:mobile`  
Expected: all pass; generated mobile bundle contains `https://api.routino.me/v1` and no device/ping/refresh paths.

- [ ] **Step 5: Commit quota/docs/parity changes**

```powershell
git add -- supabase/tests/quota.test.ts supabase/functions/api/shared docs-fa/01-FRONTEND.md docs-fa/02-BACKEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md docs-fa/CODEBASE_GUIDE.md
git commit -m "docs: record low-usage sync contract"
```

