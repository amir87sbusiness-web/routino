# Frontend Sync Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the existing frontend sync engine into the real Routino lifecycle without blocking local writes or clobbering concurrent edits.

**Architecture:** Keep `syncNow` as the data engine and add only owner binding plus an orchestration layer in `AppProvider`. Reconciliation uses the existing persistence queue and a mutation revision barrier.

**Tech Stack:** React 19, TypeScript, Vitest, Dexie/IndexedDB.

## Global Constraints

- Do not replace Dexie, persistence, outbox, merge logic or sync protocol.
- UI mutations remain local and never await Supabase.
- Canonical sync owner is authenticated `userId`.
- No Realtime and no high-frequency data sync.

---

### Task 1: Precise engine outcome and owner-bound transport

**Files:** `src/lib/sync/engine.ts`, `src/lib/sync/engine.test.ts`, `src/lib/api/auth.ts`, `src/lib/api/sync.ts`, related auth tests.

- [ ] Add failing tests proving push-only returns `remoteChanged: false`, applied remote rows return true, reset returns true, and an expected-owner mismatch aborts before transport.
- [ ] Run the targeted tests and confirm the expected failures.
- [ ] Implement `remoteChanged`, reset tracking, JWT-subject lookup and expected-owner request checks.
- [ ] Re-run targeted tests to green.

### Task 2: AppProvider sync orchestration and reconciliation barrier

**Files:** `src/state/app.tsx`, `src/state/app-sync.test.tsx`.

- [ ] Add failing tests for post-persist debounce/order, trigger coverage, entitlement marking, and a local edit that occurs while pull/hydrate is in flight.
- [ ] Run the orchestration test and confirm behavioral failures.
- [ ] Implement the small controller, ten-minute visible fallback, owner-safe switch sequencing and bounded revision reconciliation.
- [ ] Re-run orchestration tests to green.

### Task 3: Multi-device and vault acceptance

**Files:** `src/lib/sync/engine.test.ts`, `src/lib/db/vault.test.ts`, `src/lib/db/persist.test.ts` only where an uncovered behavior requires it.

- [ ] Add/extend tests for habit creation, completion, offline tombstone, LWW, close/reopen outbox and reset preserving device-local state.
- [ ] Run the focused sync/persistence/vault group and correct only demonstrated failures.

### Task 4: Documentation and verification

**Files:** `docs-fa/01-FRONTEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md` if their lifecycle description changed.

- [ ] Update the two guides with exact trigger cadence and no-clobber behavior.
- [ ] Run frontend type checks/full tests, `npm run build`, `npm run build:mobile`, and `git diff --check`.
