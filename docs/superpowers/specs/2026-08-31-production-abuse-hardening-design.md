# Production Abuse Hardening Design

**Date:** 2026-08-31

**Status:** Approved direction from adversarial audit; awaiting written-spec review

## Objective

Close the production-specific resource-amplification and fail-open gaps found by
the adversarial review without changing ordinary user behavior or deleting any
real-user data.

## Production configuration must fail closed

- The Supabase Edge entry forces or explicitly requires production mode; absence
  of `NODE_ENV` can never activate development defaults.
- Production requires a strong `PROXY_SECRET`, real SMS provider, real PSP,
  production database driver, valid merchant, JWT secret, OTP pepper, admin
  phone, and admin session secret.
- Development defaults remain available only to local/test harnesses that
  explicitly set development or test mode.
- Regression tests boot the Edge environment with each critical setting missing
  and assert startup failure rather than a fake provider or default secret.

## Cross-driver quota errors

Account quota detection accepts both PostgreSQL driver shapes:
`constraint` and postgres-js `constraint_name`, but still requires SQLSTATE
`23514` and one of the two named account-budget constraints. Unrelated database
errors remain 500s and are never mislabeled as quota rejections.

A native-shape regression test injects a postgres-js-style cause and expects the
same bounded `account_quota_exceeded` record response as PGlite. The client keeps
the rejected record durable but completes the pull instead of retrying a 500
forever.

## Bounded habit-delete cascade

Deleting a habit must not load every full `habitMonths` JSON row into Edge memory
or build an unbounded JavaScript values list.

The cascade becomes database-set-based:

- select only matching month identifiers or, preferably, perform the tombstone
  update/insert inside SQL;
- process a bounded batch per statement while preserving monotonic sequence
  allocation and delete-wins behavior;
- return pagination/continuation state only if the whole cascade cannot safely
  complete within one bounded transaction;
- never expose month payloads to the deletion code;
- preserve exact tombstone and account-budget counters.

Tests create thousands of month rows, send one habit tombstone, and assert a
bounded query/memory shape, full deletion semantics, correct sequence ordering,
and no effect on another account.

## Byte-bounded sync responses

Pull remains ordered by sequence but is bounded by both row count and serialized
UTF-8 bytes. The server reads a limited candidate window, appends records until
the configured response-byte budget would be exceeded, and always permits at
least one valid record so a large row cannot wedge the cursor.

`cursor` points to the final returned row, and `hasMore` remains true when rows
were left out by either the count or byte budget. Account state appears only on
the final page as before. The same bound applies to Fastify and Hono responses.

Acceptance tests store near-maximum habit-month records and prove a page remains
under the chosen response budget, repeated cursor-zero pulls cannot produce the
former 21 MB response, pagination eventually returns every row exactly once,
and normal small pages retain their current shape.

## Payment verification backoff

One pending checkout must not allow an authenticated caller to invoke the PSP on
every status poll.

- Store the last verification attempt and a bounded retry count/backoff state on
  the payment row.
- A pending or unknown PSP result releases the lease but retains the next allowed
  verification time.
- Callback verification may bypass poll backoff once because it is a provider
  return event; ordinary `GET /payments/:id` and sync recovery cannot.
- Sequential polls inside the cooldown return the current database state without
  calling the PSP.
- Backoff grows to a conservative maximum and never turns an ambiguous payment
  terminal.
- Paid/already-verified behavior, amount matching, grant idempotency, and recovery
  after a missed callback remain unchanged.

Tests prove repeated pending polls make one PSP call in the first window, become
eligible after the clock advances, callback and polling races still grant once,
and ambiguous/network failures remain recoverable.

## Pages and PWA security headers

- Landing, legal, `/app/`, and app fallback responses receive HSTS,
  `X-Content-Type-Options`, frame protection, and an explicit referrer policy.
- A CSP compatible with the built app is introduced from the generated artifact,
  not guessed against source imports.
- `/app/sw.js`, `/app/index.html`, and the manifest are served with `no-cache`;
  content-hashed assets use long immutable caching.
- The Pages Function must not overwrite the service-worker cache policy emitted
  by `_headers`.

Browser tests confirm initial load, service-worker activation, offline reload,
update discovery, no CSP violations, and identical mobile/desktop behavior.

## Release sequence and safety

These fixes are independent commits and test gates. Database migrations are
additive before code deploy and contract-only after live verification. The
payment migration backs up affected payment columns and validates that every
paid payment still has exactly one grant. Sync changes preserve all existing
records and only change response/cascade mechanics.

No stress test runs against production. Production receives only bounded
read-only probes and one owner-assisted admin OTP. Full amplification, quota,
payment-provider, and concurrency tests run against PGlite/fake providers and
the Edge adapter harness.

## Acceptance criteria

- Missing production-critical environment values stop startup.
- postgres-js quota errors return bounded 200-level sync rejection behavior, not
  500.
- A single habit deletion cannot materialize account-scale JSON or an unbounded
  JavaScript SQL list.
- Sync responses remain below the explicit byte budget and paginate without loss.
- Repeated pending-payment polls respect cooldown and do not hammer the PSP.
- Web/PWA security headers and service-worker cache policy match the intended
  production configuration.
- Existing real-user content, payments, grants, subscriptions, authentication,
  and offline behavior remain intact through migration and deploy.
