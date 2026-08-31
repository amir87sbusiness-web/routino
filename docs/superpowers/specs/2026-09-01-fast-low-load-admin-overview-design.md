# Fast, Low-Load Admin Overview Design

## Goal

Make the admin login feel immediate and keep the dashboard ready without increasing database, Edge, or network load. Preserve the current OTP and cookie security model and do not change or rewrite any production user data.

## Confirmed problem

OTP verification succeeds, but the page currently waits for the overview response before leaving the login screen. The overview endpoint starts eight independent database operations. In production, the Edge database pool is intentionally small, so those operations can queue and leave the button showing the verification state even though authentication already completed.

## Architecture

### Immediate authentication transition

After `POST /v1/admin/auth/otp/verify` succeeds, the client must immediately:

1. hide the login card;
2. show the authenticated panel shell;
3. render cached aggregate metrics when a valid same-tab snapshot exists, otherwise render skeletons;
4. start one background overview request.

The overview response is no longer part of the login success condition. A slow or failed overview may show a retry state inside the dashboard, but must never keep the administrator on the OTP screen.

On a later page load, the client validates the long-lived HttpOnly cookie once. Only after that validation succeeds may it show the authenticated panel and read the aggregate snapshot. An invalid session clears the snapshot and shows the login form.

### One API request and one SQL statement

Each dashboard refresh sends exactly one `GET /v1/admin/overview` request. The backend executes exactly one parameterized SQL statement.

The SQL uses small aggregate CTEs and `FILTER` clauses:

- scan `users` once for total and last-24-hour counts;
- scan `entitlements` once for active subscriptions;
- scan `payments` once for paid counts, revenue, last-24-hour revenue, pending payments, and verification failures;
- scan `otp_codes` once for the last-24-hour count;
- combine the four one-row aggregates into one result row.

The query uses one shared `now` and `dayAgo` boundary supplied by the service, so every metric represents the same instant. It returns only scalar numbers and server time.

No migration, new table, materialized view, cron job, realtime subscription, or new index is introduced. Existing data volume does not justify the permanent write/storage cost of those structures. Indexes may be reconsidered only after production query-plan evidence shows a real bottleneck.

### Cache policy

Only the aggregate overview response may be stored in `sessionStorage`, under a versioned key with a saved timestamp. It is scoped to the current browser tab and is cleared on logout, invalid session, parse failure, or schema mismatch.

The snapshot may make the dashboard immediately useful while one live request refreshes it. It is never treated as authoritative for mutations. User phone numbers, user details, payment rows, discount rows, CSRF tokens, OTP values, and session secrets are never cached.

There is no polling. Overview refresh happens only:

- once after OTP verification;
- once after a valid session is restored on page load;
- when the administrator explicitly presses refresh;
- after a successful admin mutation that changes an overview metric.

An in-flight guard prevents duplicate overview requests from concurrent UI actions.

### Failure and timeout behavior

Admin requests use a bounded timeout. A timeout or network failure leaves the panel usable, preserves any displayed aggregate snapshot, shows a clear stale/error indicator, and offers a manual retry. It does not automatically loop or create a retry storm.

Authentication errors still return to the login form and clear the aggregate snapshot. Mutation requests remain protected by the existing HttpOnly session cookie and double-submit CSRF mechanism.

### Practical visual refinement

The overview groups the existing metrics into clear operational sections instead of adding more endpoints:

- today: new users, paid payments, revenue, OTP sends;
- business: total users, active subscriptions, total paid revenue;
- attention: verification failures and pending payments.

The panel shows a compact last-updated label, a refreshing state that does not block navigation, and an explicit refresh control. Existing users, payments, and discounts tabs remain lazy: they request their data only when opened.

## Data and security guarantees

- No production rows are inserted, updated, deleted, reformatted, or migrated by this change.
- The browser never receives database credentials or the configured admin phone secret.
- The Cloudflare API subdomain remains in place; removing it would reduce protection and does not address the measured bottleneck.
- Authenticated admin responses are not placed in shared Cloudflare/CDN caches.
- Existing OTP rate limits, signed cookie lifetime, cookie renewal, and CSRF validation remain unchanged.
- The legacy admin-token cleanup remains a separate production gate and is not bundled with this performance change.

## Verification

Automated tests must prove:

1. successful OTP verification reveals the panel before an unresolved overview request completes;
2. a dashboard refresh performs one overview fetch and concurrent refresh calls are coalesced;
3. aggregate snapshot data is restored only after session validation and is cleared on logout or invalid session;
4. overview failure or timeout does not return the administrator to the OTP screen;
5. `adminOverview` returns the current contract using one database execution;
6. Fastify and Supabase Edge copies remain byte-for-byte synchronized;
7. existing admin authentication, CSRF, payment, sync, and production-safety suites remain green.

Production verification must be read-only: request an OTP to the configured administrator, confirm immediate panel entry, confirm a single overview request, inspect response latency and status, and avoid payment, grant, discount, or user-data mutations.

## Out of scope

- shared CDN caching of authenticated data;
- realtime dashboards or periodic polling;
- new analytics tables or counters;
- changing admin phone, OTP, session, or CSRF policy;
- removing historical auth tables or production secrets;
- changing payment, subscription, sync, or end-user data formats.
