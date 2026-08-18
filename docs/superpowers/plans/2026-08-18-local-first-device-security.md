# Local-First Device Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Routino as a durable local-first PWA with account-isolated local vaults, a server-enforced device/security policy, paid-only import, subscription-expiry notifications, and no personal productivity data stored on the server.

**Architecture:** IndexedDB remains the source of truth for product data, but each signed-in account gets a separate local vault that is selected without destructive wipes. The backend owns identity, device sessions, switch-security events, entitlement and payments; every protected request verifies the device row. The client retains a 15-day offline lease and treats definite security responses differently from network failure.

**Tech Stack:** React 19, TypeScript, Dexie/IndexedDB, Vite PWA/Workbox, Capacitor Local Notifications, Fastify, Drizzle/Postgres, Supabase Edge/Hono, Vitest/PGlite, Playwright.

## Global Constraints

- Default active-device limit is exactly `1`; per-user admin override is an integer from `1` through `10`.
- The first three device replacements in a rolling 30-day window succeed; the fourth creates a security lock and revokes every session.
- Offline account verification lease is exactly 15 days from the last successful server confirmation.
- Logout, revocation, account switching, subscription expiry and security lock never delete a local vault.
- Export is always available; import is allowed only for an active non-trial paid subscription.
- Three-days-before-expiry and at-expiry notifications are idempotent and reschedule on entitlement extension.
- Habits, tasks, logs, timer sessions, journal and personal settings must not be sent to or retained by the backend.
- `src/lib/phone.ts` and `backend/src/lib/phone.ts` remain byte-identical.
- Backend source changes happen under `backend/src/`, followed by `npm run sync:edge` and `npm run test:edge`; generated `supabase/functions/api/shared/` is never hand-edited.
- Existing user changes in analytics files are out of scope and must remain untouched.

---

### Task 1: Account-Isolated Local Vaults Without Automatic Data Loss

**Files:**

- Create: `src/lib/db/vault.ts`
- Create: `src/lib/db/vault.test.ts`
- Modify: `src/lib/db/dexie.ts`
- Modify: `src/lib/db/hydrate.ts`
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/lib/db/local.ts`
- Modify: `src/lib/wipe.ts`
- Modify: `src/lib/wipe.test.ts`
- Modify: `src/state/app.tsx`

**Interfaces:**

- Produces: `vaultIdForOwner(ownerId: string | null): string`, `activateVault(vaultId: string): Promise<void>`, `claimGuestVault(ownerId: string): Promise<string>`, `switchOwnerVault(ownerId: string | null): Promise<VaultSwitchResult>`.
- Produces: `deleteVault(vaultId: string): Promise<void>` as the only destructive vault API.
- Consumes: authenticated server user id returned by auth/account APIs; never derive the vault name from a raw phone number.

- [ ] **Step 1: Write failing vault lifecycle tests**

```ts
it("returns account A data after A -> B -> A without deleting either vault", async () => {
  await switchOwnerVault("user-a");
  await db.habits.put(row("habit-a", habitA));
  await switchOwnerVault("user-b");
  expect(await db.habits.get("habit-a")).toBeUndefined();
  await db.habits.put(row("habit-b", habitB));
  await switchOwnerVault("user-a");
  expect((await db.habits.get("habit-a"))?.data).toEqual(habitA);
});

it("revocation and logout preserve every account vault", async () => {
  await switchOwnerVault("user-a");
  await db.journal.put(row("1405-05-27", entry));
  await lockLocalCredentials("device_replaced");
  expect((await db.journal.get("1405-05-27"))?.data).toEqual(entry);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- src/lib/db/vault.test.ts src/lib/wipe.test.ts`
Expected: FAIL because vault switching APIs do not exist and owner change currently wipes shared data.

- [ ] **Step 3: Introduce a swappable Dexie instance and stable vault registry**

```ts
export let db = new RoutinoDexie(databaseNameForVault(DEFAULT_VAULT_ID));

export async function activateVault(vaultId: string): Promise<void> {
  if (activeVaultId === vaultId) return;
  db.close();
  db = new RoutinoDexie(databaseNameForVault(vaultId));
  activeVaultId = vaultId;
  await db.open();
}
```

Store only opaque owner-id→vault-id mappings and the active vault id under a versioned localStorage key. Claim the legacy `routino` IndexedDB as the first account vault without deleting or overwriting it. A second account selects a new database. Returning to the first account reopens its original database.

- [ ] **Step 4: Replace owner-change wiping with vault selection**

Remove automatic calls that write tombstones/clear product rows when `dataOwner` changes. Keep explicit erase behind `deleteVault(activeVaultId)` and require the existing confirmation modal to name the current local space.

- [ ] **Step 5: Verify GREEN and run local persistence regression tests**

Run: `npm test -- src/lib/db/vault.test.ts src/lib/wipe.test.ts src/lib/db/migrate.test.ts src/lib/db/diff.test.ts`
Expected: all selected tests pass; switching owners changes visible vault, and explicit erase affects only one vault.

---

### Task 2: Durable Web Storage and Storage-Health UX

**Files:**

- Create: `src/lib/storage-health.ts`
- Create: `src/lib/storage-health.test.ts`
- Create: `src/lib/pwa.test.ts`
- Modify: `src/state/app.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/lib/pwa.ts`
- Modify: `src/components/pwa.tsx`
- Modify: `vite.config.ts`

**Interfaces:**

- Produces: `readStorageHealth(): Promise<StorageHealth>` and `requestPersistentStorage(): Promise<StorageHealth>`.

```ts
export interface StorageHealth {
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}
```

- [ ] **Step 1: Write failing browser-storage tests**

Cover: unsupported API, denied persistence, granted persistence, quota values, and thrown browser APIs returning a safe status rather than blocking app boot.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/lib/storage-health.test.ts`
Expected: FAIL because the storage-health module is absent.

- [ ] **Step 3: Implement persistence request and non-blocking boot integration**

Call `navigator.storage.persisted()` on boot. Request `persist()` only from a clear user action in Settings or an install-success path. A denied request keeps the app usable and shows backup/install guidance.

- [ ] **Step 4: Add an Operate-mode storage card to Settings**

Display persistent/best-effort state, usage, last successful export timestamp, install status and concise Persian/English recovery guidance. Preserve existing Routino tokens and component patterns; do not add a separate visual system.

- [ ] **Step 5: Harden Workbox boundaries**

Keep API/auth/payment uncached; expand navigation denylist to API, admin and payment callback paths. Retain prompt-based updates and ensure reload is triggered only after the user accepts and no vault transaction is active.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- src/lib/storage-health.test.ts src/lib/pwa.test.ts`
Run: `npm run build`
Expected: selected tests and production build pass.

---

### Task 3: Backend Device Identity, Limit and Rolling Switch Lock

**Files:**

- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/src/services/tokens.ts`
- Modify: `backend/src/routes/auth.ts`
- Create: `backend/test/device-security.test.ts`
- Modify: `backend/test/device-limit.test.ts`
- Modify: `backend/test/auth.test.ts`

**Interfaces:**

- Adds user columns: `maxActiveDevices`, `securityLockedAt`, `securityLockReason`, `deviceSwitchResetAt`.
- Adds device columns: `installationKeyHash`, `platform`, `browser`, `os`, `revocationReason`.
- Adds `device_security_events` with `userId`, `deviceId`, `kind`, `createdAt`, and safe metadata.
- Produces:

```ts
export interface DeviceDescriptor {
  installationKey: string;
  name: string;
  platform: "web" | "pwa" | "android" | "ios";
  browser?: string;
  os?: string;
}

export async function issueDeviceSession(
  db: Database,
  env: Env,
  userId: string,
  device: DeviceDescriptor,
  now: Date,
): Promise<IssuedTokens>;
```

- [ ] **Step 1: Write failing PGlite tests for exact policy boundaries**

```ts
it.each([1, 2, 3])("allows replacement %s in rolling 30 days", async (n) => {
  const response = await loginFromNewDevice(user, `device-${n + 1}`, clock.now);
  expect(response.statusCode).toBe(200);
});

it("locks before issuing the fourth replacement", async () => {
  await performThreeReplacements(user);
  const response = await loginFromNewDevice(user, "device-5", clock.now);
  expect(response.statusCode).toBe(423);
  expect(response.json().error).toBe("device_security_locked");
  expect(await activeDeviceCount(user.id)).toBe(0);
});

it("does not count relogin from the same installation key", async () => {
  await loginFromNewDevice(user, "stable-key");
  await loginFromNewDevice(user, "stable-key");
  expect(await replacementCount(user.id)).toBe(0);
});
```

Also cover rolling-window expiry, free slots when max>1, concurrent fourth/fifth login, blocked account, and values outside admin range.

- [ ] **Step 2: Run backend tests and confirm RED**

Run: `cd backend; npm test -- test/device-security.test.ts test/device-limit.test.ts`
Expected: FAIL on missing schema and service behavior.

- [ ] **Step 3: Add idempotent DDL and Drizzle schema**

Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, checks for `max_active_devices between 1 and 10`, an indexed event timestamp, and a unique `(user_id, installation_key_hash)` constraint. No changes to payment tables or `payment-flow.ts`.

- [ ] **Step 4: Implement transactional login-device decision**

Lock the user row during the decision. Reuse an existing installation row, fill free slots without counting a switch, or record/revoke exactly one oldest device. Count qualifying events newer than `now - 30 days` and newer than `deviceSwitchResetAt`. On the fourth, lock user and revoke all sessions before returning `device_security_locked` with support id.

- [ ] **Step 5: Verify GREEN including concurrency**

Run: `cd backend; npm test -- test/device-security.test.ts test/device-limit.test.ts test/auth.test.ts test/password-auth.test.ts`
Expected: all selected backend tests pass.

---

### Task 4: Enforce Device Status on Every Protected Request and Expose Security APIs

**Files:**

- Modify: `backend/src/plugins/auth.ts`
- Create: `backend/src/routes/devices.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/services/admin.ts`
- Modify: `backend/src/lib/admin-page.ts`
- Create: `backend/test/devices.test.ts`
- Modify: `backend/test/admin.test.ts`

**Interfaces:**

- Adds `GET /v1/devices`, `GET /v1/devices/session`, `POST /v1/devices/:id/revoke`.
- Adds admin operations to set `maxActiveDevices`, reset the switch window and unlock the security lock.
- Protected API failures use stable codes: `device_replaced`, `device_revoked`, `device_security_locked`, `offline_lease_expired` is client-only.

- [ ] **Step 1: Write failing middleware/API/admin tests**

Assert that an unexpired access token belonging to a revoked device cannot call `/v1/subscriptions/me`; an active token succeeds; one user cannot list/revoke another user's device; admin range validation rejects 0 and 11; reset/unlock is audited.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend; npm test -- test/devices.test.ts test/admin.test.ts`
Expected: FAIL because current auth middleware checks the user but not the device row.

- [ ] **Step 3: Query user and device together in authentication middleware**

Reject missing/revoked/mismatched devices before attaching `req.user`. Update `lastSeenAt` with a bounded write cadence so every request does not cause an unnecessary database write.

- [ ] **Step 4: Implement user and admin device endpoints**

Return only safe device presentation fields. Admin mutations use explicit zod schemas, UUID validation, authentication and audit records. Update the embedded admin panel with device limit, rolling count, lock state and confirmation dialogs for destructive session actions.

- [ ] **Step 5: Verify GREEN**

Run: `cd backend; npm test -- test/devices.test.ts test/admin.test.ts test/subscriptions.test.ts`
Expected: all selected tests pass.

---

### Task 5: Client Device Key, 15-Day Offline Lease and Security Notifications

**Files:**

- Create: `src/lib/device-identity.ts`
- Create: `src/lib/device-identity.test.ts`
- Create: `src/lib/security-session.ts`
- Create: `src/lib/security-session.test.ts`
- Create: `src/lib/api/devices.ts`
- Modify: `src/lib/api/auth.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/routes/auth.tsx`
- Modify: `src/state/app.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/lib/store.ts`

**Interfaces:**

- Produces `getOrCreateDeviceDescriptor(): Promise<DeviceDescriptor>` using Web Crypto random bytes and generic UA parsing.
- Produces:

```ts
export type SessionDecision =
  | { kind: "valid" }
  | { kind: "offline-valid"; remainingMs: number }
  | { kind: "needs-online-confirmation" }
  | { kind: "revoked"; reason: "device_replaced" | "device_revoked" | "device_security_locked" };

export function decideSession(input: SessionDecisionInput): SessionDecision;
```

- [ ] **Step 1: Write failing pure decision and stable-key tests**

Use literal timestamps for day 14, exactly day 15, day 16, timeout, online success and definite security responses. Assert VPN/IP changes do not alter the locally generated installation key.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/lib/device-identity.test.ts src/lib/security-session.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Send device descriptor on every login and persist last confirmation**

OTP and password login bodies include the descriptor. Successful auth/session checks update `lastServerConfirmedAt`; timeout/abort/network failures preserve auth until the 15-day boundary. Structured security responses clear only tokens and add a local security notification.

- [ ] **Step 4: Add lifecycle checks without request storms**

Check on boot, `online`, visibility becoming visible, Capacitor resume and a 60-second foreground timer. Deduplicate concurrent checks and apply exponential retry only to idempotent session checks.

- [ ] **Step 5: Build the user device/security card**

Show device name, platform, first/last activity, current-device label and status. Use copy approved in the design and show `@routino_support` for a security lock. Data remains exportable when credentials are locked.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- src/lib/device-identity.test.ts src/lib/security-session.test.ts src/lib/api`
Expected: all selected frontend tests pass.

---

### Task 6: Always-On Export, Paid-Only Import and Subscription Expiry Notifications

**Files:**

- Modify: `src/lib/backup.ts`
- Modify: `src/lib/backup.test.ts`
- Create: `src/lib/import-policy.ts`
- Create: `src/lib/import-policy.test.ts`
- Create: `src/lib/subscription-reminders.ts`
- Create: `src/lib/subscription-reminders.test.ts`
- Modify: `src/lib/native-notifications.ts`
- Modify: `src/routes/settings.tsx`
- Modify: `src/state/app.tsx`

**Interfaces:**

- Produces `canImportBackup(subscription, now): { allowed: boolean; reason: "paid" | "trial" | "free" | "expired" }`.
- Produces `planSubscriptionReminders(subscription, now): PlannedReminder[]` with stable ids derived from `expiresAt` and reminder kind.

- [ ] **Step 1: Write failing policy and reminder boundary tests**

```ts
expect(canImportBackup(activeTrial, now).allowed).toBe(false);
expect(canImportBackup(activePaid, now).allowed).toBe(true);
expect(canImportBackup(expiredPaid, now).allowed).toBe(false);
expect(planSubscriptionReminders(sub, threeDaysBefore)).toHaveLength(2);
expect(planSubscriptionReminders(sub, oneDayBefore)[0]?.kind).toBe("expiring-missed");
expect(planSubscriptionReminders(sub, oneDayAfter)[0]?.kind).toBe("expired-missed");
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/lib/import-policy.test.ts src/lib/subscription-reminders.test.ts src/lib/backup.test.ts`
Expected: FAIL on missing policy/reminder modules and current backup UI flag.

- [ ] **Step 3: Make export visible for every plan and enforce import twice**

Remove `BACKUP_UI=false`. Export the active vault with no auth or entitlement secrets. Check policy before the file picker and again immediately before the restore transaction. Trial/free UI explains that export remains available while import requires a paid plan.

- [ ] **Step 4: Schedule, cancel and recover expiry reminders**

On entitlement change, cancel ids for the old expiry and schedule the new `-3d` and `expiry` notifications through Capacitor where available. On web, create idempotent in-app notifications and system notifications when permission and browser scheduling capabilities allow; recover missed events at next boot.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- src/lib/import-policy.test.ts src/lib/subscription-reminders.test.ts src/lib/backup.test.ts`
Expected: all selected tests pass with no duplicate reminders.

---

### Task 7: Remove Personal-Data Sync and Clear Server Records Safely

**Files:**

- Modify: `src/state/app.tsx`
- Modify: `src/lib/db/dexie.ts`
- Modify: `src/lib/db/local.ts`
- Delete: `src/lib/api/sync.ts`
- Delete: `src/lib/sync/engine.ts`
- Delete: `src/lib/sync/merge.ts`
- Delete or replace tests: `src/lib/sync/engine.test.ts`, `src/lib/sync/merge.test.ts`
- Modify: `backend/src/routes/sync.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/test/sync.test.ts`
- Create: `backend/src/routes/feedback.ts`
- Create: `backend/test/feedback.test.ts`
- Create: `src/state/app.test.tsx`

**Interfaces:**

- `GET /v1/subscriptions/me` again becomes the entitlement source on boot.
- Legacy `/v1/sync/push` and `/v1/sync/pull` return `410` with `{ error: "sync_disabled" }` during the compatibility window.
- Explicit feedback uses `POST /v1/feedback` with a bounded schema and never carries product records.

- [ ] **Step 1: Write failing tests for disabled sync and direct feedback**

Assert both legacy sync routes return 410 without applying data; explicit feedback accepts bounded text and rejects oversized/unknown payloads; app boot calls entitlement but never push/pull.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/state/app.test.tsx`
Run: `cd backend; npm test -- test/sync.test.ts test/feedback.test.ts`
Expected: FAIL because sync is currently active and feedback rides the sync outbox.

- [ ] **Step 3: Remove client sync scheduling and dirty/tombstone coupling**

Local deletes become real local deletes within the active vault. Keep migration compatibility for existing tombstones long enough to hydrate safely, but never generate a network outbox. Restore standalone entitlement refresh with timeout-safe behavior.

- [ ] **Step 4: Disable backend routes before deleting data**

Ship 410 adapters in Fastify and Hono parity, remove service registration only after clients understand `sync_disabled`, and keep payment settlement on entitlement/payment routes rather than sync pull.

- [ ] **Step 5: Sync generated edge shared code and verify parity**

Run: `npm run sync:edge`
Run: `npm run test:edge`
Expected: generated shared code matches `backend/src` and all edge tests pass.

- [ ] **Step 6: Clear only the confirmed personal-record table**

Before deletion, run a read-only count grouped by `kind` and confirm the resolved database/target. Execute a transaction-scoped `DELETE FROM records` only after frontend, backend and edge compatibility tests are green. Re-run the count and expect exactly zero. Do not delete users, devices, entitlements, grants, payments, OTP/audit or admin data.

---

### Task 8: Legal Copy, Documentation and Full Launch Verification

**Files:**

- Modify: `src/lib/legal-text.json`
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Create: `src/lib/legal-text.test.ts`

**Interfaces:**

- Terms/privacy copy must reflect local-only data, one-device default, three replacements/30 days, support handle, backup limits and permitted server data.

- [ ] **Step 1: Update Persian and English legal copy**

Remove claims that personal content is copied/synced to the server. Add neutral security-language device rules and explain that manually clearing browser data cannot be recovered without an export.

- [ ] **Step 2: Update docs-fa alongside code contracts**

Document vault selection, 15-day lease, device APIs/error codes, admin controls, notification behavior, backup gating, disabled sync and the exact production-data cleanup runbook.

- [ ] **Step 3: Run format/lint on changed files and compile both targets**

Run Prettier only over files changed by this feature, then run ESLint only over those paths so unrelated pre-existing formatting failures are not rewritten.
Run: `npm run build`
Run: `npm run build:mobile`
Run: `cd backend; npm run typecheck; npm run build`

- [ ] **Step 4: Run all automated suites freshly**

Run: `npm test`
Run: `cd backend; npm test`
Run: `npm run sync:edge`
Run: `npm run test:edge`

Record exact pass/fail counts. Existing analytics test failures must be diagnosed and reported separately rather than hidden or overwritten.

- [ ] **Step 5: Run bounded real-browser QA**

Use the production preview and Playwright/DevTools to test desktop and mobile together in one inspection pass: online, Offline, Slow 3G, reconnect, PWA reload, storage status, trial import denial, paid import, export, notification denied, device replacement and security lock copy. Fix discovered issues in one batch and run at most one confirmation pass.

- [ ] **Step 6: Run the Impeccable detector and accessibility checks**

Run once after UI work:

```powershell
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json src/routes/settings.tsx src/routes/auth.tsx src/components/pwa.tsx
```

Resolve actionable regressions in focus, semantics, RTL/LTR, responsive overflow and contrast.

- [ ] **Step 7: Perform final security and requirement review**

Check every requirement in `docs/superpowers/specs/2026-08-18-local-first-device-security-design.md` against code and tests. Inspect outgoing API payloads to prove no habit/task/journal/settings records leave the client. Report any remaining launch blocker or residual platform limitation explicitly.
