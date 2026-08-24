# NextPay Production Integration Design

**Date:** 2026-08-24

**Status:** Approved architecture, pending implementation

## Goal

Add NextPay as an optional payment provider in Routino's existing multi-provider
payment architecture, ready for a controlled production test after the real API
key is approved. The integration must not activate NextPay, perform a real
payment, change production secrets, deploy code, or remove or weaken the current
gateways.

## Official NextPay contract

The implementation follows the current official documentation at
`https://nextpay.org/nx/docs`:

- Token: `POST https://nextpay.org/nx/gateway/token`.
- Token fields: `api_key`, server-owned `order_id`, server-owned `amount`,
  `callback_uri`, `currency=IRT`, and `customer_phone` when a valid local mobile
  is available.
- Token success is exactly `code=-1` with a non-empty UUID `trans_id`.
- Redirect: `https://nextpay.org/nx/gateway/payment/{trans_id}`.
- Callback is a browser `GET` containing `trans_id`, `order_id`, and `amount`.
  Those values are untrusted inputs and never authorize access by themselves.
- Verify: `POST https://nextpay.org/nx/gateway/verify` with `api_key`, the
  candidate `trans_id`, the amount loaded from Routino's database, and
  `currency=IRT`.
- Verify success is exactly `code=0`. Its returned `amount` and `order_id` must
  equal Routino's server-owned payment row before any grant is permitted.
- Verification must happen within NextPay's documented ten-minute window.
- `auto_verify` is never sent. In particular, `auto_verify=yes` is forbidden.

The current documentation names the POST parameters but does not explicitly
state the request content type, and its linked current Node.js/cURL samples
return 404. NextPay's official legacy HTML sample submits named form fields, so
the adapter will use `application/x-www-form-urlencoded` with the current
endpoint and current parameter names. This wire-format choice remains a launch
check: the first approved-key test must confirm token issuance before any user is
sent to a payment page. No production readiness claim may treat the mocked test
as proof that NextPay still accepts the documented form encoding.

No endpoint, provider code, replay behavior, or undocumented guarantee may be
inferred. A non-zero Verify code is not treated as successful merely because it
looks like an "already verified" or duplicate response.

## Chosen architecture

NextPay becomes another adapter behind the existing `PspProvider` / `PspRouter`
boundary. Existing Zibal, ZarinPal, and fake-provider behavior remains available
and remains the default until an environment variable explicitly selects
NextPay.

The canonical payment state machine continues to own pricing, persistence,
verification decisions, and entitlement grants. The NextPay adapter owns only
wire-format conversion, timeout handling, safe classification of documented
codes, and conversion between Routino's stored Rial amount and NextPay's
explicit `IRT` Toman amount.

## Configuration and secret boundary

- Add `nextpay` to `PSP_PROVIDER` and `PSP_PROVIDERS` validation.
- Add optional server-only `NEXTPAY_API_KEY`; it has no default and no placeholder.
- Boot fails before serving requests whenever NextPay is selected without a
  syntactically valid `NEXTPAY_API_KEY`.
- The key is consumed only by backend/Edge provider construction. It never
  enters frontend code, API output, persisted payment metadata, logs, local
  storage, or generated public bundles.
- This implementation does not change current production provider selection.

## Provider-aware PSP identity

The database receives a nullable `provider_ref text` column for opaque gateway
transaction identifiers. NextPay's `trans_id` is stored there before the
checkout response returns a redirect URL.

Uniqueness is enforced by a partial unique index on
`(provider, provider_ref) WHERE provider_ref IS NOT NULL`. This deliberately
does not assume that a transaction identifier is globally unique across
NextPay, Zibal, ZarinPal, or future providers.

Existing `track_id` and `authority` columns remain readable for legacy rows and
are not destructively migrated. New provider code resolves a payment reference
in this order:

1. `provider_ref` for new writes;
2. legacy ZarinPal `authority`;
3. legacy numeric `track_id`.

New Zibal and ZarinPal checkouts may also populate `provider_ref` while retaining
their legacy columns during the compatibility period. Callback lookup always
combines provider identity with provider reference; a NextPay `trans_id` can
never resolve a row owned by another provider.

## Checkout idempotency and duplicate attempts

The frontend creates one cryptographically random UUID `attemptId` for each
intentional click and reuses it for every retry of that same checkout request.
The server never treats it as price, plan, user, or PSP identity; it is only an
idempotency key scoped to the authenticated user.

The payments table receives nullable `attempt_id uuid` and a partial unique
index on `(user_id, attempt_id) WHERE attempt_id IS NOT NULL`.

- The first request creates the server-owned payment UUID and server-computed
  quote.
- A concurrent request with the same attempt ID cannot create a second payment.
- If the first request has already persisted a provider reference, a retry
  returns the same payment ID and redirect URL.
- If the first request is still registering with the provider, the duplicate
  receives `duplicate_payment_attempt` with HTTP 409 and may safely poll/retry.
- A definitive failed attempt is not silently reused for a new purchase; a new
  user action creates a new attempt ID.
- The existing ten-checkouts-per-hour rule remains an abuse limit, not the
  idempotency mechanism.

The UI keeps its disabled/in-flight guard, but correctness does not depend on
React state timing.

## NextPay token request

The server inserts the payment before contacting NextPay. The `order_id` sent
to NextPay is the server-generated `payments.id`; amount and plan are the values
persisted from the server-side quote.

The adapter converts `amountRial` to an integer Toman amount and refuses a
non-integral conversion. It sends `currency=IRT` and a canonical local mobile
number when present. It omits `auto_verify` entirely.

Only `code=-1` plus a valid non-empty `trans_id` is success. Before returning
the payment URL, the state machine atomically persists:

- `provider='nextpay'`;
- `provider_ref=trans_id`;
- safe raw provider code;
- `status='redirected'`.

Malformed JSON, missing `trans_id`, unexpected response shape, HTTP failures,
network failures, and timeout are classified without exposing response bodies
or the API key.

## Callback and verification

The public callback accepts NextPay's documented snake-case names. It may use
`order_id` and `trans_id` only to locate a candidate row and to choose what to
verify; callback `amount` is ignored for all monetary decisions.

For a normal payment, both callback identities must agree with the stored row.
If a crash occurred after NextPay issued a token but before Routino persisted
it, a callback may supply the candidate `trans_id`; Routino still grants nothing
until server-to-server Verify returns `code=0` and returns the same server-owned
`order_id` and amount. Only then may the recovered reference be persisted.

NextPay has no documented trustworthy success flag in its callback, so every
otherwise valid NextPay callback goes through server-side Verify. An invalid or
unproven callback receives the existing neutral result page and cannot disclose
whether a payment exists.

Verify always sends the database amount in Toman with `currency=IRT`. It never
uses callback or client amount, plan, product, months, or entitlement data.

## Verify concurrency, retries, and terminal states

Verification uses a durable database claim/lease so callback, polling, refresh,
and recovery cannot concurrently send multiple Verify requests for the same
payment. A second caller observes an active claim and returns `pending` without
granting or terminally changing the payment.

The lease must be recoverable after process termination. A stale claim can be
reacquired after a bounded timeout; an in-flight claim is never permanent.

Classification follows documented NextPay meanings:

- `code=0`: verified candidate; still requires DB amount and order equality.
- `code=-1` or `code=-3`: pending; retain a retryable state.
- `code=-4`: canceled terminally, without grant.
- `code=-2`: failed terminally, without grant.
- Provider/system unavailability, HTTP 5xx, timeout, malformed transient
  response, `-42`, `-43`, `-45`, or `-72`: retryable; do not set a terminal
  payment state.
- Authentication/configuration, invalid token/order/amount, mismatch, duplicate
  without local success evidence, or other definitive non-zero codes:
  `verify_failed`; never grant.

If another request finishes successfully while a caller receives a non-success
response, the caller reloads the payment row before deciding the visible result.
An already-applied local payment always returns `paid` without calling NextPay
again. No undocumented NextPay code is mapped to canonical already-verified
success.

## Atomic, exactly-once grant

`grants.payment_id` becomes structurally unique through a partial unique index:

`UNIQUE (payment_id) WHERE payment_id IS NOT NULL`.

Adding the index alone is insufficient because the current `grantInterval`
updates `entitlements` and then inserts `grants` in separate statements. The
payment grant path will therefore use one atomic SQL operation that:

1. claims/inserts the unique payment grant;
2. updates or creates the entitlement only if that claim was newly inserted;
3. records `expires_before` and `expires_after` on that same grant;
4. returns the existing entitlement unchanged when the payment grant already
   exists.

This makes duplicate callback, duplicate Verify, poll/callback races, and
paid-without-grant recovery safe at the database level across multiple Edge
isolates. No code path may extend entitlement before it has won the unique
payment grant claim.

Before applying the unique index to production, a read-only preflight query must
check for duplicate non-null `payment_id` values. Any existing duplicates require
manual review; migration code must not delete, merge, or rewrite financial
history automatically.

## Safe persistence and logging

The existing payment row already stores server-owned amount, user, plan,
status, timestamps, provider result/status, verification time, reference number,
and masked card data. NextPay adds no raw response JSON storage.

Safe fields retained are limited to:

- documented numeric provider code;
- provider-aware transaction reference;
- returned order and amount only for validation, not long-term duplication;
- Shaparak reference ID as `ref_number` when supplied;
- masked card holder value when supplied;
- verification timestamp.

Logs contain internal payment ID, provider name, safe numeric code, error class,
and request ID. They never contain API key, request body, full provider response,
full card number, or raw customer phone.

## Error contract

The backend exposes stable safe error codes:

- `invalid_request` — HTTP 400;
- auth middleware's existing unauthorized errors — HTTP 401;
- `duplicate_payment_attempt` — HTTP 409;
- `nextpay_token_error` — HTTP 502 for a definitive token rejection;
- `payment_network_timeout` — HTTP 504;
- `payment_provider_unavailable` — HTTP 503;
- invalid/unproven callback — neutral HTML result, no payment disclosure;
- `payment_verify_failed` — persisted terminal verification failure without raw
  provider output;
- locally already verified/applied — normal paid result, never a second grant;
- unexpected internal failure — existing opaque HTTP 500 contract.

The frontend translates the new checkout codes into short Persian/English
messages and never renders NextPay's raw message.

## Recovery behavior

Existing authenticated polling and app-open payment recovery remain active.
Retryable NextPay rows, including stale verify claims, remain eligible within
the current bounded recovery window. A transient Verify failure never becomes
`failed`, `canceled`, or `verify_failed`.

The recovery query remains bounded so opening the app cannot fan out into an
unlimited number of provider calls. Successful recovery goes through the same
atomic payment grant operation as the callback.

## Test strategy

All NextPay network calls are mocked. No test uses the unapproved API key and no
request reaches a NextPay host.

Required red-green coverage:

- exact token endpoint, method, URL-encoded form fields, `currency=IRT`, optional
  `customer_phone`, and absence of `auto_verify`;
- token success only for `code=-1` with valid `trans_id`;
- provider-aware reference uniqueness;
- `trans_id` persisted before checkout returns redirect;
- exact payment URL;
- Verify uses amount and order from DB, never callback/client values;
- successful mocked flow and one entitlement grant;
- altered callback amount;
- altered callback `order_id`;
- Verify response amount mismatch;
- Verify response order mismatch;
- forged/invalid callback;
- duplicate checkout attempt and concurrent double click;
- duplicate callback;
- duplicate/concurrent Verify;
- reused provider transaction reference;
- failed payment and canceled payment;
- token timeout, Verify timeout, HTTP/provider unavailable, and recovery after a
  transient failure;
- stale verification lease recovery;
- payment grant exactly once under concurrent callback/poll/recovery;
- Edge parity and Edge HTTP flow;
- environment validation and production guard;
- frontend error translations and stable retry attempt ID.

Final verification includes targeted tests during development, then serial
frontend/backend/Edge suites, backend typecheck/build, frontend production
build, and targeted lint/format checks. No live smoke test, payment, secret
change, migration application, or deployment is part of this implementation.

## Migration and deployment boundary

The generated idempotent setup SQL will contain:

- `payments.provider_ref text`;
- partial unique index on `(provider, provider_ref)`;
- `payments.attempt_id uuid`;
- partial unique index on `(user_id, attempt_id)`;
- partial unique index on `grants(payment_id)`.

The migration is generated and tested locally only. Production application is a
separate owner-approved action after duplicate-history preflight.

Only the existing Supabase Edge Function `api` needs deployment because NextPay
logic lives in canonical `backend/src` and is synchronized into generated
`supabase/functions/api/shared`. Frontend deployment is needed only because the
checkout idempotency key and new safe error translations change the web/mobile
client. Neither is deployed in this task.

## Controlled real-payment readiness

After API-key approval, a real low-value test requires a separate explicit
approval and follows this order:

1. Run the read-only duplicate-grant preflight and apply the reviewed setup SQL.
2. Set `NEXTPAY_API_KEY` in Supabase Secrets and deliberately select NextPay in
   `PSP_PROVIDER` or `PSP_PROVIDERS`; never expose or paste the key into chat,
   source, or logs.
3. Deploy the `api` Edge Function and frontend build, then run non-payment health,
   auth, plan, and callback-route smoke checks.
4. Use the owner's account and card for one minimum allowed real payment, verify
   the charged Toman amount, one paid payment row, one grant row, and one
   entitlement extension.
5. Refresh and replay the callback/poll path to confirm the grant count remains
   one, then record the deployed commit and evidence.
