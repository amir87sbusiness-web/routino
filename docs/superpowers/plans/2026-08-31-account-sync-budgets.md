# Account Sync Budgets Implementation Plan

**Goal:** Prevent one authenticated account from creating unbounded database rows or JSON bytes while preserving decades of ordinary permanent history and the existing offline UX.

**Architecture:** Postgres owns exact per-user counters updated by record triggers in the same transaction as every insert/update/delete. User-row check constraints are the final authority. The sync service translates a quota rollback into bounded per-record rejection metadata so valid pull/account-state work continues and private payloads are never echoed.

**Limits:** 50,000 total cloud records and 128 MiB JSON data per account. These are abuse ceilings, not routine UX limits. The measured habit fixture consumes 48 rows and about 104 KiB JSON per account-year; maximum-size daily journals are a deliberately more conservative boundary.

## Constraints

- No production migration or deploy.
- Counters include tombstones so unique-delete spam is bounded.
- Existing-row edits and deletions remain possible at the record-count ceiling.
- Normal sync does not scan the account or add another network/database round trip.
- Direct SQL/PostgREST bypass cannot evade the database constraints.

### Task 1: Database counters and invariant tests

- [x] Add failing tests for insert/update/delete counter deltas, rollback at row/byte ceilings, tombstone counting, and direct-SQL bypass.
- [x] Add user counter columns, check constraints, and transaction-local record triggers to schema/DDL.
- [x] Add a data-preserving migration that backfills counters before enabling constraints/triggers.
- [x] Run migration/schema tests.

### Task 2: Sync quota rejection contract

- [x] Add failing service/client tests for a valid batch rolled back by aggregate quota, bounded `account_quota_exceeded` metadata, pull continuation, and dirty-row preservation.
- [x] Translate only the named database quota constraints; keep unknown database failures opaque.
- [x] Mirror the rejection union to the client and Edge, then run focused tests.

### Task 3: Capacity evidence and full verification

- [x] Extend the production-like quota fixture to assert counters equal actual rows/JSON bytes and report multi-year headroom.
- [x] Update affected Persian architecture/deploy documentation.
- [x] Regenerate setup/Edge shared files.
- [ ] Run all frontend/backend/Edge tests, both typechecks, lint, build, parity and scope checks; commit documentation.
