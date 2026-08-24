# NextPay Production Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NextPay as an inactive-by-default payment provider whose checkout, callback verification, recovery, and entitlement grant path are safe for production activation after the API key is approved and a controlled live preflight succeeds.

**Architecture:** Keep the current Zibal/ZarinPal providers intact and extend the existing PSP adapter with a NextPay implementation. Persist one server-owned payment attempt before redirect, identify PSP transactions by `(provider, provider_ref)`, serialize verification with a recoverable database lease, and apply a verified payment through one atomic SQL operation that claims the payment, inserts the unique payment grant, and updates entitlement exactly once.

**Tech Stack:** TypeScript, Fastify, Hono/Supabase Edge Functions, Drizzle/PostgreSQL/PGlite, React, Vitest, official NextPay REST endpoints.

## Global Constraints

- `backend/src/` is canonical; never hand-edit `supabase/functions/api/shared/`. Regenerate it with `npm run sync:edge`.
- Do not deploy, apply migrations to a remote database, call NextPay with a real key, or perform a real payment in this plan.
- Never hardcode, log, return, bundle, or persist `NEXTPAY_API_KEY`; it is server-only and has no default value.
- Do not send `auto_verify`. The backend alone verifies and grants access.
- Do not remove or change the activation status of Zibal/ZarinPal/fake providers.
- Treat callback fields as routing hints only. Amount, plan, user, order, and entitlement data come from Routino's database.
- A mocked provider flow proves Routino behavior, not the undocumented HTTP encoding compatibility. Production activation remains blocked until a controlled token-only preflight with the approved key confirms the request encoding.
- Keep transient Verify errors recoverable. Only an authoritative terminal provider result may move a payment to a terminal failed/canceled state.
- Preserve all unrelated dirty working-tree changes. Commit only explicitly listed files for this feature.

---

### Task 1: Lock the database invariants and atomic grant contract

**Files:**
- Create: `backend/test/payment-atomicity.test.ts`
- Modify: `backend/test/launch-ddl.test.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Modify: `backend/src/services/entitlement.ts` only if a shared typed SQL executor is required

**Interfaces:**
- Add nullable `payments.attemptId: uuid` and `payments.providerRef: text`.
- Add partial uniqueness on `payments(user_id, attempt_id)` where `attempt_id is not null`.
- Add partial provider-aware uniqueness on `payments(provider, provider_ref)` where `provider_ref is not null`.
- Make `grants(payment_id)` unique where `payment_id is not null`.
- Produce `applyVerifiedPaymentAtomically(db, paymentId, now)` whose payment claim, payment-linked grant insert, entitlement upsert, and grant audit result are one database transaction/statement.

- [x] **Step 1: Write failing schema and concurrency tests**

Assert the three partial unique indexes exist. Add a pre-migration duplicate detector query for `grants.payment_id`. In the payment atomicity test, race multiple calls for one paid payment and assert exactly one grant, one entitlement extension, one `applied_at`, and stable entitlement dates. Add a rollback test in which the entitlement/grant operation fails and the payment remains unapplied.

- [x] **Step 2: Run RED tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/launch-ddl.test.ts test/payment-atomicity.test.ts`

Expected: missing columns/indexes and non-atomic grant behavior fail for the intended assertions.

- [x] **Step 3: Add schema fields and safe partial indexes**

Define both nullable columns in Drizzle. Add idempotent DDL for the partial unique indexes. The migration must run a read-only duplicate preflight before creating `grants_payment_id_unique`; it must not delete, merge, or rewrite existing production rows.

- [x] **Step 4: Replace the payment grant split-write path**

Implement one transactional/CTE-based operation that locks or conditionally claims the payment, inserts `grants.payment_id` once, extends entitlement only for the winning insert, and writes `applied_at` only after the same atomic unit succeeds. A unique-index conflict must be treated as an idempotent replay after rereading state, never as permission to extend entitlement again. Keep non-payment grants on their existing path.

- [x] **Step 5: Make recovery use the same atomic primitive**

Remove the direct `grantInterval` repair call for paid/unapplied payments. Recovery must call the same atomic payment-grant operation so two Edge isolates cannot double-extend the subscription.

- [x] **Step 6: Run GREEN tests and existing payment concurrency regressions**

Run: `cd backend && npm test -- --maxWorkers=1 test/launch-ddl.test.ts test/payment-atomicity.test.ts test/payment-burst.test.ts test/payment-recovery.test.ts`

### Task 2: Define typed provider failures and implement the NextPay adapter

**Files:**
- Modify: `backend/test/psp.test.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/src/providers/psp/index.ts`
- Modify: `backend/src/providers/psp/router.ts`
- Create: `backend/src/providers/psp/nextpay.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/lib/http-errors.ts`

**Interfaces:**
- Extend `PspName` and provider env parsing with `nextpay`.
- Add a safe failure classification such as `invalid_response | token_rejected | timeout | unavailable | terminal_verify | transient_verify` plus numeric `providerCode` where available.
- Preserve provider `orderId` in Verify results so payment-flow can compare it with the database order.
- Construct `NextPayProvider({apiKey, fetchImpl?, timeoutMs?})`; fail startup/provider construction safely if NextPay is selected without `NEXTPAY_API_KEY`.

- [ ] **Step 1: Write failing adapter tests with a mocked fetch**

Cover the exact official token URL and fields, `currency=IRT`, optional `customer_phone`, absence of `auto_verify`, Toman conversion, successful `code=-1` token response, UUID `trans_id`, exact redirect URL, malformed payloads, token rejection, timeout, unavailable transport, and secret redaction. For Verify, cover the exact URL/fields, successful `code=0`, returned amount/order comparison data, terminal codes, and retryable `-42`, `-43`, `-45`, and `-72` classifications.

- [ ] **Step 2: Run RED provider tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/psp.test.ts`

Expected: NextPay types/module are missing.

- [ ] **Step 3: Implement the smallest official-contract adapter**

Use only:

- `POST https://nextpay.org/nx/gateway/token`
- `POST https://nextpay.org/nx/gateway/verify`
- `https://nextpay.org/nx/gateway/payment/{trans_id}`

Serialize the currently approved implementation as `application/x-www-form-urlencoded`, never send `auto_verify`, accept only `code=-1` as token success and `code=0` as Verify success, validate UUID-shaped `trans_id`, convert stored Rial to integral Toman, and expose only safe codes/messages. No raw provider body, key, or phone may enter logs/errors/database.

- [ ] **Step 4: Wire optional configuration without activating it**

Read `NEXTPAY_API_KEY` only from server environment. Add NextPay to provider construction and router typing, but do not change current production provider defaults or allow an empty/missing key to silently fall back when NextPay is explicitly selected.

- [ ] **Step 5: Run GREEN tests and typecheck**

Run: `cd backend && npm test -- --maxWorkers=1 test/psp.test.ts && npm run typecheck`

### Task 3: Add server-owned checkout idempotency and provider-aware references

**Files:**
- Modify: `backend/test/payments.test.ts`
- Modify: `backend/test/payment-burst.test.ts`
- Modify: `backend/src/routes/payments.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Modify: `backend/src/lib/http-errors.ts`

**Interfaces:**
- Require `attemptId` as a client-generated UUID on `POST /v1/payments/checkout`.
- Return the same persisted payment/redirect for an already completed identical attempt.
- Return safe `409 duplicate_payment_attempt` while the first identical attempt is still registering or when immutable attempt inputs conflict.
- Persist provider transaction IDs in `provider_ref`; locate them only with provider scope.

- [x] **Step 1: Write failing checkout idempotency tests**

Cover retry with the same UUID, concurrent double-click, same attempt with a changed plan/code/platform, client amount injection being ignored/rejected, provider timeout, provider unavailable, token rejection, and successful mocked NextPay checkout. Assert only one provider token call and one payment row for an attempt. Assert `provider_ref` is saved before a redirect response is returned.

- [x] **Step 2: Write failing provider-aware uniqueness tests**

Insert the same `provider_ref` for two different providers and assert it is allowed. Insert it twice for the same provider and assert rejection. Prove lookup never matches a reference belonging to another provider. Keep legacy `track_id`/`authority` readable; do not destructively migrate them.

- [x] **Step 3: Run RED checkout tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/payments.test.ts test/payment-burst.test.ts`

- [x] **Step 4: Implement the idempotent checkout claim**

Insert or claim `(user_id, attempt_id)` before calling a PSP. On a unique conflict, reread the row and either return the existing redirect/result, return `409 duplicate_payment_attempt`, or reject changed immutable inputs. Never make a second provider call for the same claimed attempt. Derive amount/plan/months entirely from server pricing and persist them before provider I/O.

- [x] **Step 5: Store and route PSP references by provider**

Write all new provider identifiers to `provider_ref`, optionally maintaining legacy fields for existing providers only where current compatibility requires it. Every new lookup must bind both `provider` and `provider_ref`. Convert typed provider failures to safe HTTP errors: token error 502, timeout 504, unavailable 503, and opaque internal 500.

- [x] **Step 6: Run GREEN checkout tests**

Run the same targeted payment command.

### Task 4: Serialize Verify while preserving transient recovery

**Files:**
- Modify: `backend/test/payments.test.ts`
- Modify: `backend/test/payment-recovery.test.ts`
- Modify: `backend/src/services/payment-flow.ts`

**Interfaces:**
- Use a durable `status='verifying'` lease with `updated_at` as lease timestamp, including stale-lease recovery.
- For NextPay, callback fields route to a database row but never prove payment.
- Verify sends database `amount` and stored provider reference; it compares provider response amount and `order_id` with database values before applying.
- Transient Verify failures remain recoverable and retryable; terminal provider failures remain terminal.

- [x] **Step 1: Write failing callback integrity tests**

Cover fake callback, altered callback amount, altered callback `order_id`, provider/reference mismatch, reused transaction, missing transaction, and a NextPay callback that contains no trusted success flag. Assert no entitlement is granted until backend Verify returns success matching database amount and order.

- [x] **Step 2: Write failing duplicate/retry tests**

Cover duplicate callbacks, duplicate polling Verify, concurrent Verify, stale `verifying` lease, timeout/unavailable/transient NextPay code followed by success, terminal failure, and already locally applied payment. Assert transient outcomes do not become `failed`, `canceled`, or `verify_failed`; retries remain possible. Assert a second success cannot add time or a second grant.

- [x] **Step 3: Run RED Verify tests**

Run: `cd backend && npm test -- --maxWorkers=1 test/payments.test.ts test/payment-recovery.test.ts test/payment-atomicity.test.ts`

- [x] **Step 4: Implement the database Verify lease**

Claim eligible payments with a conditional update. A fresh competing lease returns the current safe pending state; a stale lease may be reclaimed. Re-read before persisting a visible failure so a concurrent successful apply always wins. Locally applied rows return paid without another PSP call.

- [x] **Step 5: Implement provider-specific callback routing and authoritative Verify**

Parse NextPay `trans_id`/`order_id` only to identify the candidate row. Ignore callback amount. Verify with stored amount/provider reference; require provider `code=0`, equal stored amount, and equal order ID. Never treat an undocumented “already verified” provider code as success. Store only the numeric provider code and safe normalized status.

- [x] **Step 6: Run GREEN Verify and recovery tests**

Run the same targeted Verify command.

### Task 5: Make frontend retries stable and safe

**Files:**
- Create: `src/lib/api/payments.test.ts`
- Create or modify: `src/routes/-subscribe.test.tsx`
- Modify: `src/lib/api/payments.ts`
- Modify: `src/routes/subscribe.tsx`
- Modify: `src/routes/pay.result.tsx` only if `verifying` needs an explicit non-terminal display state

**Interfaces:**
- `checkout(input)` sends a UUID `attemptId` but no amount, months, or entitlement data.
- The subscribe screen reuses one attempt ID for transport/retry ambiguity and creates a new one only after a definitive terminal answer or changed immutable checkout selection.
- A synchronous in-flight guard prevents two clicks before React state renders.

- [x] **Step 1: Write failing client payload and interaction tests**

Assert payload contains `planId`, optional code/platform, and `attemptId`, but never amount or API key. Double-click must make one HTTP request. A retryable timeout/unavailable response must reuse the attempt ID; changing plan/code must create a new attempt ID. Terminal validation/token rejection must safely release the attempt.

- [x] **Step 2: Run RED frontend tests**

Run: `npm test -- --maxWorkers=1 src/lib/api/payments.test.ts src/routes/-subscribe.test.tsx`

- [x] **Step 3: Implement stable attempt lifecycle and safe messages**

Use `crypto.randomUUID()` and refs, not localStorage. Add safe Persian messages for `duplicate_payment_attempt`, `nextpay_token_error`, `payment_network_timeout`, and `payment_provider_unavailable`; never render a raw provider response. Keep current providers and UI behavior otherwise unchanged.

- [x] **Step 4: Run GREEN frontend tests and typecheck**

Run: `npm test -- --maxWorkers=1 src/lib/api/payments.test.ts src/routes/-subscribe.test.tsx && npx tsc --noEmit`

### Task 6: Mirror Edge behavior, generate migration artifacts, and update guides

**Files:**
- Modify: `scripts/sync-edge-shared.mjs`
- Modify: `supabase/functions/api/index.ts`
- Modify: `supabase/functions/api/routes/payments.ts`
- Modify: `supabase/tests/payments.test.ts`
- Generate: `supabase/functions/api/shared/providers/psp/nextpay.ts`
- Generate: other changed `supabase/functions/api/shared/*` through `npm run sync:edge`
- Generate: `supabase/setup.sql` through `node scripts/gen-setup-sql.mjs`
- Generate: `supabase/setup.sql` as the repository's existing idempotent migration artifact; do not introduce a second migration system
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/DEPLOY-SUPABASE-EDGE.md`

**Interfaces:**
- Fastify and Hono expose the same checkout/callback/poll behavior.
- Migration contains nullable columns, duplicate preflight guidance/failure, and the three partial unique indexes; it performs no cleanup.
- Docs clearly separate code readiness, unapplied migration, unset secret, undeployed functions, and unverified live provider compatibility.

- [x] **Step 1: Add failing Edge parity and flow tests**

Mirror attempt ID validation, successful mocked NextPay flow, altered amount/order, duplicate callback/Verify, transient retry, and exactly-once grant tests in Edge. Add NextPay to the shared-file parity manifest.

- [x] **Step 2: Run RED Edge tests**

Run: `npm run test:edge -- --maxWorkers=1 supabase/tests/payments.test.ts backend/test/edge-parity.test.ts`

- [x] **Step 3: Add thin Hono/config wiring and migration**

Keep all business logic in canonical shared services. Add only the Edge-specific route/env constructor wiring required for NextPay. Regenerate the repository's existing idempotent `supabase/setup.sql` migration artifact with `provider_ref`, `attempt_id`, provider-aware and attempt indexes, and unique `grants.payment_id`. Abort safely when duplicate payment grants already exist; do not mutate those rows.

- [x] **Step 4: Regenerate shared code and setup SQL**

Run: `npm run sync:edge` then `node scripts/gen-setup-sql.mjs`. Review generated diffs; do not manually patch generated shared files.

- [x] **Step 5: Update the Persian guides without overwriting unrelated edits**

Document the new inactive provider, server-only `NEXTPAY_API_KEY`, exact flow/status rules, database invariants, retry/recovery semantics, migration preflight, functions to deploy later, and controlled activation steps. Explicitly state no deploy/migration/live payment occurred.

- [x] **Step 6: Run GREEN Edge tests and parity**

Run: `npm run test:edge -- --maxWorkers=1 supabase/tests/payments.test.ts && cd backend && npm test -- --maxWorkers=1 test/edge-parity.test.ts`

### Task 7: Run the no-deploy release gate and independent review

**Files:**
- Modify only files required to fix failures caused by this feature
- Update: `skill-observations/log.md` only with concise workflow observations required by the active task-observer skill

- [x] **Step 1: Run formatting integrity and focused lint**

Run: `git diff --check` and ESLint only on changed TypeScript/TSX files. Do not mass-format unrelated dirty files.

- [x] **Step 2: Run the required serial test matrix**

Run backend payment/provider/schema/concurrency/recovery suites with `--maxWorkers=1`, then all backend tests serially. Run frontend payment tests and the full frontend suite serially. Run `npm run sync:edge` followed by all Edge tests serially.

- [x] **Step 3: Run builds and type checks**

Run: `cd backend && npm run typecheck && npm run build`; root `npx tsc --noEmit`; root `npm run build`.

- [x] **Step 4: Scan for secret and contract leakage**

Search tracked/source/generated output for literal API keys, `NEXTPAY_API_KEY` in frontend paths, NextPay raw-response logging, `auto_verify`, unscoped `provider_ref` lookups, non-atomic payment grant calls, and calls to live NextPay endpoints in tests. Confirm all provider I/O is mocked.

- [x] **Step 5: Review the complete diff against the approved spec**

Verify every requested error class, state transition, uniqueness rule, callback defense, retry path, and exactly-once entitlement invariant. Record any unresolved risk instead of weakening a test or guessing provider behavior.

- [x] **Step 6: Stop before every production action**

Do not push a migration, set a Supabase secret, deploy an Edge Function, change provider selection, or call NextPay. Prepare the final report with changed files, flow architecture, required migrations, required secret, later deploy list, passed tests, remaining risks, and the exact 3–5 approved-key live-test steps.
