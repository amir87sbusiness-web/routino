# Trial Account Retention Main Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the trial-account retention feature to current `main`, add the one-time safety window, verify it against the current archive/quota/sync/payment architecture, and release it incrementally.

**Architecture:** PostgreSQL owns fail-closed eligibility, effective deadlines, bounded deletion, and scheduling. Existing API responses carry the deadline without new requests. The current archive/quota triggers and payment foreign keys remain authoritative safety boundaries.

**Tech Stack:** PostgreSQL 17, pg_cron, Drizzle, Fastify/Hono Edge, React/TypeScript, Vitest, PGlite, dedicated PostgreSQL integration tests, Supabase CLI, Cloudflare Pages.

## Global Constraints

- Keep the trial at exactly seven days.
- Do not merge the old feature branch; port only retention hunks to current `main`.
- Preserve compression, `taskMonths`, the 10 MiB annual allowance, sync, payment, and admin controls.
- Existing users cannot be deleted before `deployment_cutoff + 30 days`.
- Any financial, admin, referenced-discount, unknown, or inconsistent state fails closed.
- Never manually delete production user data.

---

### Task 1: Port the locally verified retention feature

**Files:** canonical backend/auth/admin services, frontend auth/root warning, focused tests, and aggregate dry-run SQL.

- [ ] Apply only retention diffs onto current `main`; regenerate generated Edge shared files.
- [ ] Resolve overlaps by retaining current archive/quota/task-month behavior.
- [ ] Run existing focused retention tests.

### Task 2: Add current-release safety contracts with TDD

**Files:** retention SQL/DDL, migration, dry-run, admin queries, PostgreSQL integration and capacity tests.

- [ ] Add failing tests for the deployment floor, registration-only admin privacy, referenced discounts, archive/quota cleanup, and a large protected population.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Implement the minimal additive SQL and query changes.
- [ ] Re-run focused tests and confirm they pass.

### Task 3: Verify the current main tree

**Files:** generated Edge mirror and task guides.

- [ ] Run `npm run sync:edge` and verify parity.
- [ ] Run all frontend, backend, and Edge tests, typechecks, builds, lint, and `git diff --check`.
- [ ] Run dedicated PostgreSQL concurrency and capacity tests.
- [ ] Commit on `main` only after all evidence is green.

### Task 4: Production preflight and release

**Files:** additive migration, aggregate dry-run, postcheck SQL, deployment artifacts.

- [ ] Create a non-empty production backup and restore it into an isolated PostgreSQL database.
- [ ] Run the read-only production dry-run; stop on any protected overlap.
- [ ] Deploy compatible backend/Edge and frontend, apply the additive migration, and run postchecks.
- [ ] Install the once-daily cron and prove the deployment floor prevents old-account deletion for 30 days.
- [ ] Smoke-test health, auth/login contract, sync, payment read paths, admin filtering/metric, and warning delivery.

### Task 5: Finalize Git state

**Files:** Git refs and worktrees only.

- [ ] Push the verified commit to `origin/main` without force.
- [ ] Confirm `main` and `origin/main` are identical.
- [ ] Preserve unrelated user work, remove only the obsolete retention feature branch, and leave the main worktree clean.
