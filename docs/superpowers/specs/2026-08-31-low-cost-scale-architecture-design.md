# Routino Low-Cost Scale Architecture Design

**Date:** 2026-08-31

**Status:** Approved direction

## Objective

Keep all user-authored history permanently while making the web and native apps inexpensive and reliable beyond 10,000 daily active users. Normal use must remain instant and offline-first. Abuse must be bounded before it can create unbounded database rows, egress, Edge invocations, SMS spend, or payment-provider traffic.

## Evidence and constraints

- The client already writes product data to IndexedDB first and batches dirty rows after a 10-second trailing window.
- `POST /v1/sync/exchange` already combines push, incremental pull, and optional account state in one Edge invocation.
- The server already pages pulls, clamps hostile client clocks, uses last-write-wins, retains tombstones safely, and caps a request at 200 records and 64 KiB in Fastify.
- The production Hono/Edge path does not currently enforce the Fastify body limit or a general HTTP rate limit.
- The server accepts `data: unknown` and has no semantic per-kind validation or aggregate per-account storage ceiling.
- Product history must survive for years. Operational request logs, expired idempotency state, and rate-limit buckets are not product history and may be compacted or purged.
- No deploy, production migration, real PSP request, or destructive production operation is part of local implementation.

## Architecture decision

Retain the local-first client and the single authenticated sync exchange. Do not introduce microservices, realtime polling, Redis, Kafka, D1, or R2 as active product storage.

Use four bounded layers:

1. **Local durable state:** IndexedDB remains the UI source of truth. UI writes never wait for the network.
2. **Efficient sync transport:** batch changes, pull only after a cursor, make retries idempotent, and report acceptance per record so one malformed record cannot wedge the account.
3. **Server-authoritative validation and budgets:** validate the exact shape of every sync kind, enforce request/body limits in both Fastify and Hono, and atomically cap abusive account growth well above legitimate lifetime use.
4. **Compact server persistence:** keep low-frequency entities as individual records. Store high-frequency habit history as one bounded habit-month record whose daily cells merge independently by timestamp.

Cloudflare remains the public shield and static delivery layer. Supabase Postgres remains the authoritative store for sync, authentication, entitlement, and payments. R2 is reserved for encrypted recovery backups after a separate restore-tested design.

## Sync protocol v2

### Request

Every exchange carries:

- `protocolVersion: 2`
- the device cursor
- at most 100 client records and less than 48 KiB from the client
- an optional account-state flag
- state-setting records, never an unbounded arbitrary event stream

Retry idempotency is structural: equal `(kind, id, updatedAt)` writes do not bump the server sequence. For habit-month cells, equal `(habitId, dateKey, updatedAt)` writes do not replace or duplicate a cell.

### Response

The response returns:

- accepted/applied and stale/skipped counts
- a bounded list of rejected record identifiers with stable error codes
- only records newer than the caller's cursor
- reset metadata if tombstone compaction passed the caller's cursor
- account state only on the final page when requested

The client clears `dirty` only for accepted or stale records whose local `updatedAt` still equals the sent value. Rejected data stays durable locally and is surfaced as a count; it never blocks other records or the pull.

## Domain validation

The canonical validator lives under `backend/src/` and is copied to Edge through `npm run sync:edge`.

Server validation checks both IDs and payloads:

- `categories`: bounded names, known color/icon string sizes, booleans only.
- `habits`: bounded name/category/unit/reminder, known measure/schedule enums, finite positive targets, bounded weekday arrays.
- `tasks`: bounded title/note/reminder/color/icon, known measure type, finite non-negative values.
- `timerSessions`: known mode/link kind, finite timestamps and duration, bounded labels.
- `journal`: ISO date key, bounded text by characters and UTF-8 bytes, score `null` or 1 through 10, bounded mood.
- `habitMonths`: canonical `habitId|YYYY-MM` key, at most 31 canonical date cells, each containing a validated habit log or tombstone and its own non-negative timestamp.

Unknown object keys are stripped or rejected consistently. Non-finite numbers, prototype-shaped values, malformed natural keys, and oversized UTF-8 payloads are rejected before database writes.

## Habit-history compaction

The UI and IndexedDB keep the existing per-day `HabitLog` model. Only the wire/server representation changes.

- Dirty local log rows are grouped by `habitId + calendar month` before a request.
- Each outgoing month contains only dirty daily cells.
- The server merges each daily cell independently, then stores one complete bounded month record.
- Pulling a month expands it back into ordinary local log rows before the existing merge logic runs.
- Two devices editing different days in the same month preserve both days.
- Two devices editing the same day converge by the existing timestamp rule.
- Deleting a habit tombstones its month records without requiring one request per historical day.

For five active habits per user, this bounds high-frequency server rows near `users × habits × months` rather than `users × daily logs` while keeping full daily history.

## Abuse and cost budgets

Limits are server-side and intentionally far above normal usage:

- hard body cap before JSON parsing in both production adapters
- record-count and pull-page caps
- exact per-kind byte and field limits
- account live-record and live-byte ceilings sized for decades of ordinary use
- bounded rejected-record details to prevent reflected-response amplification
- Cloudflare coarse IP/path rate limits plus existing durable OTP/password/provider ledgers
- aggregate SMS and checkout circuit breakers retained separately from sync limits

Import/restore remains a distinct authenticated workflow with its own larger batches and resumable cursor. Normal sync limits are not weakened to accommodate imports.

## Web and native session security

Session redesign is a separate release unit because it changes authentication contracts:

- Web: short-lived access token in memory and rotating refresh token in an `HttpOnly`, `Secure`, `SameSite` cookie with CSRF protection for cookie-authenticated mutations.
- Native: short-lived access token plus refresh credential in platform secure storage.
- Store only hashes of refresh credentials server-side; rotate on use and revoke the chain on replay.
- Preserve the current login UX and offline product access.

This does not add device-management UI or device-count limits.

## Rollout sequence

1. Add shared semantic validation, per-record rejection, and Edge body parity behind protocol v2 tests.
2. Add habit-month packing/merging with exhaustive same-day, different-day, tombstone, pagination, reset, and multi-device tests.
3. Add aggregate account storage accounting and benchmark normalized versus compact history with realistic fixtures.
4. Add Cloudflare production rate-limit configuration and verify raw Supabase bypass remains blocked.
5. Ship Edge code while the schema remains backward-compatible, smoke-test, then apply the reviewed migration.
6. Verify function-backed readiness, sync round-trip, old local vault recovery, Pages asset identity, and Android bundle endpoint binding.
7. Implement session rotation as its own plan after the storage/sync release is stable.

## Release gates

- All new behavior follows red-green-refactor tests.
- `backend/src` remains canonical; run `npm run sync:edge` before Edge verification.
- Frontend, backend, Edge, typecheck, lint, and production builds must pass from fresh commands.
- Load fixtures must report requests/DAU, response bytes/request, rows/user-year, and indexed bytes/user-year.
- A production migration requires a non-empty validated backup and explicit approval.
- Local test success is never reported as deployed or live-verified behavior.

## Non-goals

- No deletion or summarization of journals or valid habit history.
- No user-visible daily activity cap.
- No realtime socket or polling loop.
- No active-data move to object storage.
- No payment-flow behavior or amount changes.
- No deploy or live migration during implementation.
