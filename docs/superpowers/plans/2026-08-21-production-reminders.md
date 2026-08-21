# Production Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace action-specific native alarms with a capacity-aware, schedule-correct reconciliation pipeline.

**Architecture:** A pure planner emits deterministic platform-neutral notification requests from `Db`; one Capacitor adapter checks permission, cancels only Routino-owned pending requests, and applies the plan. AppProvider supplies lifecycle triggers, while Settings alone requests OS permission and exact-alarm access.

**Tech Stack:** TypeScript, React, Vitest, Capacitor Local Notifications v7, Android AlarmManager integration.

## Global Constraints

- Keep Dexie, sync records, local IDs, and existing `isDueOn` as sources of truth.
- Never prompt for notification permission from AppProvider or reconciliation.
- Product and lifecycle reminders remain separately gateable.
- Never cancel non-Routino pending notifications.
- Use no JavaScript timer for closed-app delivery.

---

### Task 1: Pure planner

**Files:** create `src/lib/reminder-planner.ts`, create `src/lib/reminder-planner.test.ts`.

**Produces:** `planNativeReminders(db, options): PlannedReminder[]` and deterministic `routinoNotificationId(key)`.

- [ ] Write literal-expectation tests for daily, weekday, both calendar odd/even rules, createdAt, archive/removal, task lifecycle, journal, lifecycle, IDs, capacity and uniqueness.
- [ ] Run the test and verify RED because the planner module is absent.
- [ ] Implement candidate construction using `isDueOn`, local `Date` values, native-supported `at`/`on`, `allowWhileIdle`, sorting and truncation.
- [ ] Run the planner suite and verify GREEN.

### Task 2: Central Capacitor reconciler

**Files:** replace `src/lib/native-notifications.ts`, create `src/lib/native-notifications.test.ts`.

**Produces:** `checkNativeNotificationPermission`, `requestNativePermission`, exact-alarm helpers, and `reconcileNativeReminders(db, options)`.

- [ ] Write boundary tests proving denied permission never requests, only Routino-owned IDs are cancelled, and one deterministic plan is scheduled without duplicates.
- [ ] Verify RED against the old action-specific adapter.
- [ ] Implement the adapter with dynamic Capacitor import and ownership tags.
- [ ] Verify GREEN and remove task-specific scheduling exports.

### Task 3: Lifecycle and permission UX

**Files:** modify `src/state/app.tsx`, `src/routes/settings.tsx`, `src/routes/tasks.tsx`, `src/lib/store.ts`, `src/lib/db/local.ts`, `src/lib/db/migrate.ts`, related tests.

- [ ] Write failing tests for default-off migration and Provider reconciliation without permission requests.
- [ ] Make AppProvider reconcile on state/boot/foreground/focus and suppress browser `Notification` on native.
- [ ] Remove task-page scheduling; state reconciliation now handles create/edit/delete/complete/sync.
- [ ] Keep Settings as the explicit permission request, reflect denial accurately, and expose exact-alarm status/action on Android.
- [ ] Run relevant tests until GREEN.

### Task 4: Native precision and delivery documentation

**Files:** modify `android/app/src/main/AndroidManifest.xml`, `capacitor.config.ts`, add Android small-icon resource, update `docs-fa/01-FRONTEND.md`, `docs-fa/MOBILE_SETUP.md`, create `docs-fa/REMINDER-NATIVE-CHECKLIST.md`.

- [ ] Declare `SCHEDULE_EXACT_ALARM` and configure a real monochrome small icon.
- [ ] Document Capacitor's reboot receiver, exact-alarm fallback, capacity and the physical-device checklist.
- [ ] Run targeted tests, frontend-only/full test commands, typecheck, web build, mobile build, and Android debug build where local tooling permits.
