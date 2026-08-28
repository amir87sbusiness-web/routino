# ZarinPal-Only Launch Readiness Design

**Date:** 2026-08-28

## Goal

Prepare Routino's source for launch with ZarinPal as the only production payment
gateway. Remove Zibal and NextPay from runtime code, configuration, environment
contracts, tests, generated Edge code, and maintained documentation. Retain a
local fake gateway only as a deterministic automated-test dependency, and make
production reject it at startup.

This work prepares source, schema migration, and deployment instructions. It does
not apply a remote migration, change a secret, deploy an Edge Function, or make a
real payment without a separate live-action authorization.

## External Contract

Routino uses ZarinPal's REST v4 payment endpoints directly so the same adapter can
run in Node.js and Supabase Edge/Deno without adding an SDK dependency.

- Request: `POST /pg/v4/payment/request.json` with the server merchant ID,
  server-computed amount, `currency: "IRR"`, HTTPS callback URL, description, and
  optional customer mobile metadata.
- Redirect: `/pg/StartPay/{authority}`.
- Callback inputs: `Authority` and `Status` plus Routino's unguessable payment ID
  already embedded in the callback URL.
- Verify: `POST /pg/v4/payment/verify.json` with the server merchant ID, stored
  authority, and stored Rial amount.
- Verify code `100` means newly verified and `101` means already verified. Both
  represent paid money; all other codes are non-success and must never grant.
- The current documented minimum is 10,000 Rial. Routino validates this before
  contacting the provider.

## Architecture

### Single production provider

`PspProvider` remains as a narrow injected interface so payment-flow tests can use
the fake adapter. It no longer has a provider name, router, health selection,
failover, or Zibal-coded result/status constants. The provider returns typed,
gateway-neutral outcomes:

- request: issued authority, definitive rejection, or an ambiguous transport
  failure;
- verify: paid, already verified, pending/retryable, canceled/terminal, definitive
  failure, or malformed/ambiguous.

Production constructs only `zarinpalPsp`. Development/tests may construct
`fakePsp`. `NODE_ENV=production` rejects `PSP_PROVIDER=fake`, and the environment
schema accepts only `fake` or `zarinpal`. Multi-provider configuration and all
Zibal/NextPay secrets are removed.

### Canonical storage

Payments keep one string `authority`; numeric `track_id` and runtime `provider`
columns are removed because the application has not launched and there is no
compatibility requirement. New safety fields are added:

- `attempt_id uuid not null`, unique with `user_id`;
- `request_started_at timestamptz` for the provider-request ownership lease;
- `verify_started_at timestamptz` for the verification ownership lease.

`authority` is unique. `grants.payment_id` receives a partial unique index so one
payment cannot create two ledger entries even if application logic regresses.

The migration fails before adding the unique grant constraint if duplicate
non-null payment IDs already exist. It uses `drop column if exists` only for the
obsolete `provider` and `track_id` columns. It does not delete payment, grant, or
entitlement rows.

### Checkout idempotency and ambiguous requests

The frontend generates one UUID `attemptId` for a user payment action and reuses
it for network retries. The server uniquely binds `(user_id, attempt_id)` to the
selected plan, normalized discount code, and platform.

The first request inserts the payment and atomically claims the provider-request
lease. Concurrent requests with the same attempt cannot both contact ZarinPal.
Retries behave by stored state:

- `redirected`: return the same `paymentId` and payment URL;
- `requesting` with a fresh lease: return an in-progress response without another
  provider call;
- stale `requesting` or `provider_unknown`: preserve the ambiguous row and do not
  blindly create another authority;
- terminal rejection: return the stored safe failure; a deliberate new user
  action needs a new `attemptId`;
- a reused `attemptId` with different plan, discount, or platform is rejected.

A timeout, network error, non-2xx response with an unreadable body, or malformed
success response may mean ZarinPal issued an authority that Routino did not
receive. These outcomes become `provider_unknown`, not a definitive failure.
Routino never automatically repeats the create-payment call for that attempt.

The callback URL contains `paymentId`. If an ambiguous request later produces a
real callback, Routino can find the row and bind the returned authority only after
successful server-to-server verification using the stored amount. The unique
authority constraint prevents reuse.

### Callback proof and verification

Callback query values are normalized strictly. Missing, duplicated, array-valued,
malformed, or mismatched `paymentId`/`Authority` inputs receive one neutral result
and cause no write or provider call. The callback's `Status` is display/input
context only; it is never proof of payment.

For a structurally valid callback with `Status=OK`, Routino atomically claims the
verify lease and calls ZarinPal using only the stored authority and stored amount.
A callback with `Status=NOK` may display cancellation, but it does not destroy the
row's recovery eligibility based only on a browser query string.

Verification handling is:

- code `100`: paid; record reference/card details and apply access atomically;
- code `101`: already verified; apply access atomically and idempotently;
- documented retryable/not-yet-paid codes: leave recoverable;
- documented terminal validation/merchant/authority/amount failures: record a
  safe terminal failure and never grant;
- timeout, HTTP failure, invalid JSON, or malformed response: release or expire
  the verify lease and leave the payment retryable.

Raw provider bodies, merchant IDs, and secrets are never logged, stored, or sent
to the frontend. Logs contain only Routino payment ID, normalized provider code,
and safe state.

### Atomic entitlement application

Successful verification opens a database transaction and locks the payment row.
Inside the same transaction Routino checks `applied_at` and the unique payment
grant, extends entitlement, inserts the payment grant, and marks the payment paid
and applied. A crash commits all of these effects or none of them.

Concurrent callback, polling, and app-open recovery may verify at most once per
fresh lease and can never grant twice. Discount redemption runs after the paid
transaction and cannot roll back or duplicate a successful entitlement. A failed
discount bookkeeping write is logged for support while payment remains paid.

### Recovery

The authenticated status endpoint and bounded app-open sweep recover payments
whose browser callback never arrived. They consider redirected, provider-unknown,
and callback-canceled display states within the recovery window. Verification
timeouts remain retryable. Terminal amount/merchant/invalid-authority failures do
not create endless provider traffic.

Recovery is bounded per account and uses a verification lease so callback,
polling, and multiple app instances do not fan out provider calls. An already
applied payment returns its local final state without contacting ZarinPal.

### Web and mobile return flow

The backend remains the only ZarinPal callback. It renders the result page, then
returns web users to `PUBLIC_WEB_URL/pay/result` and mobile users to
`APP_DEEP_LINK`. The result route polls the authenticated payment endpoint and
updates local entitlement only from the server response. Neither web query
parameters nor deep-link parameters can activate access.

## Fake Provider

The fake provider is retained because it makes the complete payment state machine
deterministic and testable without real money or flaky external calls. It mimics
ZarinPal's string authority, `Authority`/`Status` callback, codes `100` and `101`,
timeouts, malformed responses, cancellation, and pending outcomes. The local dev
gateway uses the same callback shape.

Production has two independent guards: environment validation rejects `fake`, and
the Edge constructor never silently falls back to fake when the merchant is
missing or invalid.

## Removed Surfaces

- Zibal adapter, secret, sandbox exception, Docker variables, callback dialect,
  result/status constants, tests, comments, and documentation.
- NextPay design/plan artifacts on the active branch and any code/config reference
  present in maintained source. The separate historical git branch/worktree is
  not part of production runtime and is not deleted by this change.
- Multi-provider router and `PSP_PROVIDERS` failover configuration.
- Database `provider` and `track_id` columns and their indexes.
- Generated Edge copies are never edited by hand; canonical backend changes are
  propagated with `npm run sync:edge`.

## Test Design

Tests use hand-derived ZarinPal-shaped fixtures and mocked network boundaries.
No test calls a real provider or uses the real merchant.

Coverage includes:

- exact request endpoint, JSON body, IRR currency, mobile metadata, callback URL,
  timeout signal, redirect URL, and minimum amount;
- response code `100`, missing authority, official negative errors, errors-object
  and errors-array shapes, non-2xx, timeout, invalid JSON, and malformed JSON;
- verify codes `100` and `101`, reference/card parsing, official terminal and
  retryable codes, non-2xx, timeout, invalid JSON, and malformed JSON;
- stable checkout attempt retry, concurrent duplicate request, reused attempt with
  changed inputs, provider rejection, provider-unknown preservation, and callback
  recovery after an issued-but-unpersisted authority;
- forged/missing/duplicated callback fields, mismatched authority/payment ID,
  `OK`/`NOK`, duplicate callbacks, duplicate polls, callback/poll concurrency,
  stale request/verify leases, and already-applied payments;
- server-authoritative plan/discount/final amount, 100% discount bypass, amount
  mismatch rejection, discount redemption timing, and no client-supplied amount;
- atomic grant behavior under concurrent settlement and injected failures, one
  unique grant, one entitlement extension, and crash recovery;
- callback loss, browser/app closure, app-open sweep, bounded retries, web return,
  Android/iOS deep link return, and authenticated result polling;
- production environment rejection of fake/missing/invalid merchant configuration;
- absence scans for Zibal and NextPay operational references, secret names,
  adapters, routes, generated files, and dependencies.

## Validation and Launch Boundary

Fresh validation must run after the refactor:

- targeted red/green tests for each behavior change;
- complete backend tests serially;
- frontend tests;
- Edge tests;
- backend/Edge and phone parity tests;
- backend and frontend typechecks;
- lint;
- production frontend build;
- Edge shared-source regeneration and clean parity;
- generated setup SQL check and migration syntax/preflight where locally possible;
- repository-wide forbidden-reference and secret-exposure scans.

`Launch Ready` means the source, generated Edge source, schema artifact, migration,
configuration contract, tests, and builds are complete with no known payment-code
blocker. It does not mean remote SQL was applied, secrets were verified in the
correct project, Edge/frontend were deployed, or a controlled live transaction
was observed. Those remain explicit production activation gates and must be
reported separately.
