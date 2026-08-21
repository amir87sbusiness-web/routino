# Routino Read-only Paid Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve full viewing and sync after expiry while centrally blocking new product value until an authoritative active entitlement returns.

**Architecture:** Split pure access/progress decisions from AppProvider enforcement. Keep product writes on `update()`, expose only named system operations, and let AppShell own the single read-only notice/modal.

**Tech Stack:** React 19, TypeScript, TanStack Router, Dexie, Vitest, Capacitor Local Notifications.

## Global Constraints

- Keep Dexie and the generic `records` sync engine unchanged.
- Never entitlement-gate sync or discard pre-expiry dirty rows.
- Do not change checkout/payment idempotency or server grants.
- Do not hand-edit generated route, `www/`, `dist/`, or Edge shared files.

---

### Task 1: Final access states

**Files:** `src/lib/access-state.ts`, `src/lib/access-state.test.ts`, `src/components/AppShell.tsx`

**Interfaces:** `AccessState`; `productWriteAllowed(db, sessionGate, now): boolean`; `accessRoute(state)`.

- [ ] Write RED cases for trial/paid/expired/tampered and no expired redirect.
- [ ] Run `npm test -- --maxWorkers=1 src/lib/access-state.test.ts` and confirm the old state names/redirect fail.
- [ ] Implement the pure model and render expired inside AppShell with one notice.
- [ ] Re-run the focused test.

### Task 2: Central mutation enforcement

**Files:** `src/state/app.tsx`, `src/state/app-sync.test.tsx`, direct system-operation consumers under `src/routes/` and `src/components/`.

**Interfaces:** `update(fn): boolean`; named methods `updatePreferences`, `applyEntitlement`, `commitTrialActivation`, `markNotificationsRead`, `submitFeedback`, `signOutLocal`, `resetSyncedContent`; `writeBlocked`/`clearWriteBlocked`.

- [ ] Write RED integration cases proving active-trial writes and expired habit/task/journal/timer writes are blocked without invoking updater.
- [ ] Add RED cases for logout, preference changes, explicit reset, reactivation, and existing dirty sync.
- [ ] Run the AppProvider suite and confirm failures match the missing gate.
- [ ] Implement the minimal gate and migrate every audited `update()` system call to a named operation.
- [ ] Re-run the AppProvider and route-focused suites.

### Task 3: Reminder lifecycle

**Files:** `src/lib/subscription-reminders.ts`, `src/lib/subscription-reminders.test.ts`, `src/state/app.tsx`, `src/lib/reminder-planner.ts`.

**Interfaces:** trial events use `trial|expires-soon|<expiry>` and `trial|expired|<expiry>`; product reminder allowance follows `productWriteAllowed`.

- [ ] Write RED trial final-day/expiry and expired-product-reminder tests.
- [ ] Run focused reminder tests and confirm RED.
- [ ] Enable tasteful trial events, cloud-safe copy, and entitlement-aware reconciliation.
- [ ] Re-run reminder and AppProvider tests.

### Task 4: Paywall progress and destructive semantics

**Files:** `src/lib/subscription-progress.ts`, its test, `src/routes/subscribe.tsx`, `src/routes/settings.tsx`, `src/lib/import-policy.ts`.

**Interfaces:** `subscriptionProgress(db, now)` returns real windowed counts/rates and optional best habit; reset uses `resetSyncedContent()`.

- [ ] Write RED exact-seven-day trial-window and paid-recent-window tests with literal expected metrics.
- [ ] Write RED policy tests for expired export/import/reset behavior.
- [ ] Implement progress, personalized copy, and synced-account reset confirmation.
- [ ] Run focused progress/settings/policy tests.

### Task 5: Documentation and verification

**Files:** `docs-fa/CODEBASE_GUIDE.md`, `docs-fa/01-FRONTEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`.

- [ ] Update only stale gate, reminder, backup, and reset passages.
- [ ] Run targeted tests serially, `npx tsc --noEmit`, Impeccable detector, `npm run build`, and `npm run build:mobile`.
- [ ] Run `git diff --check` and report blockers without deployment.
