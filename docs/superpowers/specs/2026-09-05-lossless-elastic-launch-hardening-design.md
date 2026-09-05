# Routino Lossless Elastic Launch Hardening Design

**Date:** 2026-09-05

**Status:** Approved direction; written-spec review pending

## Objective

Prepare the current Routino release for a sudden advertising-driven traffic increase without introducing a business cap on real customers, successful purchases, or valid product history.

The implementation must reduce duplicated work, temporary operational rows, database backlog, and provider amplification. Buying a larger Supabase or Cloudflare plan must increase available capacity without requiring product-code changes.

## Non-negotiable safety invariants

- Never delete a user to save database space.
- Never delete, overwrite, terminalize, or detach a successful or ambiguous payment merely to reduce storage or provider traffic.
- Preserve every payment that reached or may have reached a provider, together with the data required for later reconciliation.
- Preserve grants, entitlements, redemptions, feedback, journals, habit history, incomplete tasks, and every valid user-authored record.
- Task compaction is lossless re-encoding. Source task rows may be deleted only inside the same transaction that proves exact reconstruction from the replacement archive.
- Tombstone purge removes only deletion markers older than the established safety window. It advances the reset watermark atomically so an old device is forced to perform a safe reset instead of resurrecting deleted data.
- No fixed hourly or daily global cap may reject legitimate checkout demand.
- Security controls may deduplicate identical work, serialize conflicting work, apply per-source abuse protection, and return temporary backpressure. They may not convert an unknown payment into a failure.
- No production deploy, live migration, real OTP, real PSP request, data cleanup, or destructive production test is included in this implementation.

## Chosen architecture

Use elastic capacity with lossless deduplication and bounded background work.

This deliberately rejects two alternatives:

1. A fixed global daily/hourly sales quota could block a real advertising spike.
2. Removing all controls would let duplicate requests and rotating bots multiply provider calls and database rows faster than a paid plan can help.

The chosen design has no business quota. Capacity is governed by the provisioned database/provider resources, while the application ensures one logical action produces at most one unit of useful work.

## 1. Lossless task compaction with measurable throughput

The existing database-owned taskMonths representation remains the compaction target. Client and IndexedDB formats do not change.

The compactor will:

- keep one short transaction per bounded batch;
- prevent overlapping workers with a database advisory lock;
- select eligible rows through an expression/partial index that exactly matches safe eligibility predicates;
- use deterministic owner-month chunks and the existing semantic checksum;
- reconstruct and compare every selected source task before deleting it;
- roll back the entire batch on malformed data, checksum mismatch, conflicting updates, timeout, or any other uncertainty;
- exit cheaply when no eligible work exists.

Scheduling will become frequent and configurable rather than one fixed 500-row daily run. The default local/setup schedule must provide at least ten times the audited heavy-load arrival rate of 10,000 eligible tasks/day while keeping each transaction bounded. Scaling the database plan or changing the schedule may increase throughput without changing the archive format or application protocol.

Observability will be read-only and constant-size:

- an exact/controlled backlog query reports eligible row count, oldest eligible age, and candidate owner-month count;
- pg_cron run history remains the execution log instead of adding an append-only application log;
- operational documentation defines warning and critical backlog-age thresholds;
- tests prove scheduled-run-equivalent throughput exceeds modeled arrival rate with explicit headroom.

No compaction scheduler is enabled on production as part of this local implementation.

## 2. Bounded tombstone purge

The current weekly all-at-once tombstone delete becomes a database function that removes a deterministic bounded batch ordered by sequence.

The purge will:

- select only deleted records older than the existing retention boundary;
- use a partial index on the purge predicate/order;
- prevent overlapping workers;
- delete at most the configured batch per transaction;
- update gc_seq to at least the greatest sequence actually removed in the same transaction;
- leave live records and recent tombstones untouched;
- exit cheaply when empty;
- expose a read-only backlog count and oldest eligible tombstone age.

Scheduling will be frequent enough that expected deletion-marker arrivals cannot create a permanent backlog. The schedule and batch size remain operational parameters, not user-count gates.

Tests must prove that pagination/reset semantics prevent resurrection after purge and that concurrent/newer writes are not deleted.

## 3. Elastic OTP and checkout protection

### OTP

Existing per-phone security windows remain because they prevent duplicate SMS delivery and code guessing. They are security controls, not a total-user quota.

The claim operation will atomically serialize every shared dimension it evaluates:

- phone;
- IP;
- a database-backed SMS-provider lease pool.

Rate-limit state remains fixed-window bucket data with expiry and constant-size updates rather than one row per failed request. Parallel requests must not overshoot a bucket because of count-then-insert races.

The existing fixed global daily SMS rejection ceiling will be removed as a product-capacity gate. Provider-wide protection will use a database-backed pool of short-lived leases. The default pool is 32 concurrent sends and is configurable through production environment without a code change. A request that cannot acquire a lease returns a generic temporary response with Retry-After and consumes neither a new OTP code nor a provider send. Expired leases are reclaimable after a crashed invocation. Repeated requests for the same phone/window must not send duplicate SMS messages.

### Checkout

Checkout will have no fixed global hourly or daily sales ceiling.

Instead:

- attemptId idempotency remains authoritative;
- a repeated request for the same logical purchase reuses the existing recoverable checkout/payment state instead of creating another provider call or row;
- concurrent claims for the same account/purchase fingerprint are serialized atomically;
- only one request owns a provider-initialization lease for a logical checkout;
- provider initialization uses a database-backed pool of 64 short-lived concurrent leases by default, configurable through production environment without a code change;
- callers observing an active lease receive the existing recoverable state or a temporary retry response, never a fabricated terminal failure;
- saturation returns Retry-After and the client retries with the same attemptId; it does not create a second payment;
- a successful, redirected, verifying, or provider-unknown payment is always retained;
- provider/network ambiguity remains recoverable and is never automatically retried blindly;
- paid entitlements remain server-authoritative and idempotent.

Unbounded distributed traffic cannot be made harmless by application code alone. Cloudflare WAF/rate limiting and provider capacity remain deployment gates, but local code must ensure retries and concurrency do not amplify one logical purchase.

No automatic payment-history purge is introduced. Records that are provably pre-provider and non-financial may be considered only in a separate retention policy with explicit evidence; they are out of scope here.

## 4. Schema, DDL, migration, and admin-delete parity

The payment ownership contract is:

- payments.user_id is nullable;
- its foreign key uses ON DELETE SET NULL;
- payment history survives account deletion;
- every query that lists financial history handles a missing user through a left join or explicit nullable field;
- user-scoped queries do not accidentally expose anonymous payments to another account.

The following sources must agree:

- backend/src/db/schema.ts;
- backend/src/db/ddl.ts;
- the additive Supabase migration;
- generated supabase/setup.sql;
- canonical Backend and generated Edge shared sources.

The admin delete implementation must compile without weakening its deleted-row check. Backend tests will reuse one authenticated admin session per test instead of requesting a second OTP inside the same minute. This fixes the test harness, not the production OTP rule.

The legacy subscription-import Edge harness will receive the same explicit cutoff override as the Backend harness. Production cutoff behavior remains unchanged and receives its own boundary tests.

## 5. Release gates and load evidence

The stale load smoke is replaced or corrected so:

- removed endpoints are not counted as success;
- every unexpected 4xx and every 5xx fails the run;
- health, plans, authenticated sync exchange, OTP claim behavior, and checkout idempotency are measured with fake providers and isolated test accounts;
- workload reports request count, success/error count, p50/p95/p99 latency, response bytes, database rows, and maintenance backlog before and after;
- a multi-account burst proves legitimate identities are not rejected by a fixed business quota;
- a same-identity burst proves duplicate provider work is bounded;
- no stress test runs against production.

The release cannot proceed until fresh commands prove:

- Frontend tests pass;
- Backend tests pass;
- Edge tests pass after npm run sync:edge;
- Backend typecheck and build pass;
- Deno Edge check passes;
- lint has zero errors;
- web and mobile builds pass;
- schema/setup/migration parity tests pass;
- maintenance throughput and losslessness tests pass;
- dependency audit is either freshly verified or explicitly blocked by the environment.

## Rollout boundary after local implementation

This work stops before production mutation.

A later, separately approved rollout must use:

1. verified project identity;
2. non-empty backup and restore rehearsal;
3. additive migration before behavior that requires it;
4. archive-aware code deployment before enabling compaction;
5. one controlled canary account/month;
6. payment/grant/count reconciliation;
7. staged traffic growth with backlog, database size, error rate, latency, Edge invocation, egress, SMS, and PSP monitoring;
8. explicit approval before enabling production cron or any destructive cleanup.

## Success criteria

- No real customer or valid product history is removed for cost savings.
- No successful or ambiguous payment loses its recovery/audit trail.
- One logical OTP or checkout cannot fan out into multiple provider calls under concurrency.
- There is no fixed global business quota on successful checkout demand.
- Compaction and purge are lossless, bounded per transaction, observable, and proven faster than the modeled arrival rate.
- Fresh bootstrap, migration, schema types, generated setup, Backend, and Edge all express the same database contract.
- All local release gates are green before any production rollout is proposed.
