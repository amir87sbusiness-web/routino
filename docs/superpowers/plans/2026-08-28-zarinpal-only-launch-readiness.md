# ZarinPal-Only Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Routino launch-ready with ZarinPal as its only production payment gateway and remove every operational Zibal and NextPay surface.

**Architecture:** Keep one injected `PspProvider` interface for production ZarinPal and deterministic fake tests, but remove multi-provider routing and Zibal-coded contracts. Bind every checkout to a stable user attempt UUID, serialize provider request/verify work with durable database leases, and apply payment grant plus entitlement atomically inside one transaction.

**Tech Stack:** TypeScript, Fastify, React, Drizzle, PostgreSQL/PGlite, Supabase Edge/Deno, Vitest, Zod.

## Global Constraints

- Production accepts only ZarinPal and rejects the fake provider at boot.
- The fake provider remains local/test-only and uses ZarinPal's authority/callback dialect.
- Amount, plan, discount, and entitlement remain server-authoritative and Rial is explicit on the provider wire.
- Callback fields identify a candidate payment but never prove payment; only Verify codes 100 and 101 may grant.
- Provider create/verify transport ambiguity remains recoverable and is never converted blindly into a paid or terminal state.
- Zibal and NextPay are removed from maintained source, generated Edge source, env, config, tests, and docs.
- Generated `supabase/functions/api/shared/` files are changed only through `npm run sync:edge`.
- No remote migration, secret mutation, deployment, or real provider call is part of implementation validation.

---

### Task 1: Replace the multi-provider contract with a typed ZarinPal contract

**Files:**
- Modify: `backend/src/providers/psp/index.ts`
- Modify: `backend/src/providers/psp/zarinpal.ts`
- Modify: `backend/src/providers/psp/fake.ts`
- Delete: `backend/src/providers/psp/zibal.ts`
- Delete: `backend/src/providers/psp/router.ts`
- Modify: `backend/test/psp.test.ts`

**Interfaces:**
- Produces: `PspProvider.request(input): Promise<PspRequestResult>` and `PspProvider.verify(authority, amountRial): Promise<PspVerifyResult>`.
- Produces request kinds `issued | rejected | unknown` and verify kinds `paid | already_verified | pending | canceled | failed | unknown`.

- [ ] **Step 1: Add failing wire-contract tests**

Add literal fixtures proving request uses `/pg/v4/payment/request.json`, `currency: "IRR"`, an HTTPS callback, stored Rial amount, mobile metadata, and returns `issued` only for code 100 with a non-empty authority. Add timeout, non-2xx, invalid JSON, errors-object, errors-array, missing-code, and missing-authority cases.

- [ ] **Step 2: Run the adapter tests and confirm the old contract fails**

Run: `cd backend; npm test -- --maxWorkers=1 test/psp.test.ts`

Expected: failures reference missing typed kinds and the old Zibal-coded result/status interface.

- [ ] **Step 3: Implement the typed adapter and ZarinPal-shaped fake**

Use these public shapes:

```ts
type PspRequestResult =
  | { kind: "issued"; authority: string; code: 100 }
  | { kind: "rejected"; code: number; message?: string }
  | { kind: "unknown"; code?: number };

type PspVerifyResult =
  | { kind: "paid" | "already_verified"; code: 100 | 101; refNumber?: string; cardNumber?: string }
  | { kind: "pending" | "canceled" | "failed" | "unknown"; code?: number; message?: string };
```

Map official code 100 to `paid`, 101 to `already_verified`, known not-yet-paid/canceled codes to retryable/canceled outcomes, validation/merchant/authority/amount failures to `failed`, and transport/malformed responses to `unknown`. Do not log response bodies or merchant IDs.

- [ ] **Step 4: Make the fake provider use string authorities and codes 100/101**

Keep deterministic controls for paid, canceled, pending, timeout, malformed, and already-verified outcomes. Its dev redirect must use `Authority`, `Status`, and the callback URL supplied at request time.

- [ ] **Step 5: Run the focused tests**

Run: `cd backend; npm test -- --maxWorkers=1 test/psp.test.ts`

Expected: all adapter tests pass with no Zibal imports.

- [ ] **Step 6: Commit the provider boundary**

```powershell
git add backend/src/providers/psp backend/test/psp.test.ts
git commit -m "refactor(payments): make ZarinPal the sole provider"
```

### Task 2: Enforce production-only ZarinPal configuration

**Files:**
- Modify: `backend/src/env.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/test/app.test.ts`
- Modify: `backend/.env.example`
- Modify: `backend/docker-compose.yml`

**Interfaces:**
- Produces: `PSP_PROVIDER: "fake" | "zarinpal"` and required production `ZARINPAL_MERCHANT`.
- Removes: `PSP_PROVIDERS`, `ZIBAL_MERCHANT`, `ALLOW_TEST_PROVIDERS` payment bypass behavior.

- [ ] **Step 1: Write failing production-guard tests**

Test production rejection for `fake`, missing/placeholder/whitespace merchant, invalid merchant format, and acceptance for `zarinpal` plus a 36-character merchant UUID. Verify no multi-provider parser remains.

- [ ] **Step 2: Run the environment tests and verify failure**

Run: `cd backend; npm test -- --maxWorkers=1 test/app.test.ts`

- [ ] **Step 3: Simplify environment and constructors**

Construct `zarinpalPsp(env.ZARINPAL_MERCHANT)` directly in production. Construct fake only for explicit non-production `PSP_PROVIDER=fake`. Keep the console-SMS production guard independent; do not retain a payment-provider escape hatch.

- [ ] **Step 4: Update example/Docker configuration**

Document only `PSP_PROVIDER=zarinpal` and `ZARINPAL_MERCHANT`. Do not add a real value or placeholder that passes production validation.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd backend; npm test -- --maxWorkers=1 test/app.test.ts; npm run typecheck`

- [ ] **Step 6: Commit configuration changes**

```powershell
git add backend/src/env.ts backend/src/index.ts backend/test/app.test.ts backend/.env.example backend/docker-compose.yml
git commit -m "fix(config): require ZarinPal in production"
```

### Task 3: Add the launch schema and atomic payment grant

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/src/services/entitlement.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Create: `supabase/migrations/20260828090000_zarinpal_only_payment_safety.sql`
- Regenerate: `supabase/setup.sql`
- Modify: `backend/test/payments.test.ts`
- Modify: `backend/test/payment-burst.test.ts`

**Interfaces:**
- Produces: `payments.attempt_id`, `request_started_at`, `verify_started_at`, unique `(user_id, attempt_id)`, unique `authority`, and unique non-null `grants.payment_id`.
- Removes: `payments.provider` and `payments.track_id`.

- [ ] **Step 1: Write failing schema and atomicity tests**

Add tests proving two concurrent settlements create exactly one payment grant and one interval extension, an injected failure rolls back payment/grant/entitlement together, and duplicate `grants.payment_id` is structurally rejected.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-burst.test.ts`

- [ ] **Step 3: Implement transactional application**

Make `applyPaid` open one database transaction, lock the payment row, return if already applied or already granted, call `grantInterval(tx, ...)`, and mark paid/applied in the same transaction. Run discount redemption after commit inside its existing non-fatal catch.

- [ ] **Step 4: Update canonical schema and safe migration**

The migration must preflight duplicate non-null payment grants and raise before adding the unique index. Add new columns/indexes with `if not exists`, backfill `attempt_id` for any prelaunch rows with `gen_random_uuid()`, make it non-null, and drop obsolete provider/track columns with `drop column if exists`. Do not delete payment or entitlement rows.

- [ ] **Step 5: Regenerate setup SQL and run focused tests**

Run: `node scripts/gen-setup-sql.mjs`

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-burst.test.ts`

- [ ] **Step 6: Commit schema safety**

```powershell
git add backend/src/db backend/src/services/entitlement.ts backend/src/services/payment-flow.ts backend/test/payments.test.ts backend/test/payment-burst.test.ts supabase/migrations supabase/setup.sql
git commit -m "fix(payments): make grants atomic and idempotent"
```

### Task 4: Make checkout attempts durable and idempotent

**Files:**
- Modify: `backend/src/routes/payments.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Modify: `backend/test/payments.test.ts`
- Modify: `backend/test/payment-recovery.test.ts`

**Interfaces:**
- Consumes: `attemptId` UUID supplied by the authenticated client.
- Produces: stable checkout responses for the same attempt and safe `payment_in_progress`, `payment_attempt_conflict`, and `payment_provider_unknown` errors.

- [ ] **Step 1: Add failing idempotency tests**

Cover same-attempt retry, concurrent double-click, changed plan/code/platform under one attempt, response loss after persisted authority, provider timeout, malformed response, definitive rejection, stale request lease, and new deliberate attempt after an ambiguous one. Assert one provider create call per attempt.

- [ ] **Step 2: Verify the tests fail against current checkout**

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-recovery.test.ts`

- [ ] **Step 3: Implement insert-or-read plus request lease**

Validate `attemptId` with the existing UUID expression. Normalize discount code before comparing stored inputs. Atomically claim only a fresh `pending` payment. Return the stored redirect for `redirected`; never call create again for fresh/stale `requesting` or `provider_unknown` under the same attempt.

- [ ] **Step 4: Store authority before returning redirect**

Update payment to `redirected` with authority in the database before returning `paymentUrl`. On transport/malformed ambiguity, persist `provider_unknown`; on definitive provider rejection, persist `failed` plus safe code.

- [ ] **Step 5: Run focused tests**

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-recovery.test.ts`

- [ ] **Step 6: Commit durable checkout behavior**

```powershell
git add backend/src/routes/payments.ts backend/src/services/payment-flow.ts backend/test/payments.test.ts backend/test/payment-recovery.test.ts
git commit -m "fix(payments): make checkout attempts idempotent"
```

### Task 5: Harden callback, Verify leases, polling, and recovery

**Files:**
- Modify: `backend/src/services/payment-flow.ts`
- Modify: `backend/src/lib/pay-result-page.ts`
- Modify: `backend/src/routes/dev-gateway.ts`
- Modify: `backend/test/payments.test.ts`
- Modify: `backend/test/payment-recovery.test.ts`
- Modify: `backend/test/payment-burst.test.ts`

**Interfaces:**
- Callback consumes exactly one scalar `paymentId`, `Authority`, and `Status`.
- Verify uses only stored authority and stored Rial amount and applies typed outcomes.

- [ ] **Step 1: Write failing callback and concurrency tests**

Cover missing/duplicate/array fields, malformed UUID/authority, mismatched authority, forged OK/NOK, codes 100/101, timeout, network failure, non-2xx, malformed response, stale verify lease, duplicate callback, duplicate poll, callback/poll overlap, callback loss, and app-open recovery. Assert no forged input grants or leaks payment details.

- [ ] **Step 2: Run focused tests and verify the old dialect fails**

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-recovery.test.ts test/payment-burst.test.ts`

- [ ] **Step 3: Implement strict callback binding and verify lease**

Require scalar parameters, case-sensitive authority match, and payment ID proof. Treat callback status as a hint only. Claim verification with a bounded timestamp lease; concurrent callers return current local state. Release retryable failures and preserve terminal failures without granting.

- [ ] **Step 4: Preserve recovery after browser/app interruption**

Poll and app-open sweep recover redirected, provider-unknown, and callback-canceled display states inside the 72-hour window. Already-applied rows never contact the provider. Bound each sweep to the existing maximum.

- [ ] **Step 5: Run focused tests**

Run: `cd backend; npm test -- --maxWorkers=1 test/payments.test.ts test/payment-recovery.test.ts test/payment-burst.test.ts`

- [ ] **Step 6: Commit settlement hardening**

```powershell
git add backend/src/services/payment-flow.ts backend/src/lib/pay-result-page.ts backend/src/routes/dev-gateway.ts backend/test
git commit -m "fix(payments): harden ZarinPal settlement recovery"
```

### Task 6: Bind frontend retries and validate web/mobile return

**Files:**
- Modify: `src/lib/api/payments.ts`
- Modify: `src/routes/subscribe.tsx`
- Modify: `src/routes/pay.result.tsx`
- Modify: `src/client.tsx` only if deep-link parsing needs contract changes
- Create: `src/lib/api/payments.test.ts`
- Create: `src/routes/subscribe.payment.test.tsx`
- Create: `src/routes/pay.result.payment.test.tsx`

**Interfaces:**
- `checkout(planId, code, platform, attemptId)` sends the stable UUID.
- Payment status includes `requesting` and `provider_unknown` as non-terminal states.

- [ ] **Step 1: Add failing frontend tests**

Prove double click uses one attempt UUID, automatic retry preserves it, a deliberate fresh action gets a new UUID, ambiguous/in-progress states show a safe Persian/English message, and URL/deep-link status never activates entitlement without authenticated polling.

- [ ] **Step 2: Run focused frontend tests and confirm failure**

Run: `npm test -- src/lib/api src/routes`

- [ ] **Step 3: Implement stable attempt ownership**

Generate with `crypto.randomUUID()` at user action, keep the UUID across retryable network failures, and clear it after redirect, free success, or definitive rejection. Do not store amount or entitlement decisions client-side.

- [ ] **Step 4: Update result polling states**

Keep `requesting`, `redirected`, `provider_unknown`, and pending callback hints in polling. Apply entitlement only when the authenticated server result says `paid`.

- [ ] **Step 5: Run frontend tests**

Run: `npm test -- src/lib/api src/routes`

- [ ] **Step 6: Commit frontend payment behavior**

```powershell
git add src/lib/api/payments.ts src/routes/subscribe.tsx src/routes/pay.result.tsx src/client.tsx src/**/*.test.*
git commit -m "fix(checkout): bind retries to one payment attempt"
```

### Task 7: Synchronize Edge and remove obsolete operational surfaces

**Files:**
- Modify: `scripts/sync-edge-shared.mjs`
- Modify: `supabase/functions/api/index.ts`
- Modify: `supabase/functions/api/routes/dev-gateway.ts`
- Modify: `supabase/tests/payments.test.ts`
- Modify: `supabase/tests/app.test.ts`
- Regenerate: `supabase/functions/api/shared/**`
- Delete: `docs/superpowers/specs/2026-08-24-nextpay-production-integration-design.md`
- Delete: `docs/superpowers/plans/2026-08-24-nextpay-production-integration.md`
- Modify: payment sections in `docs-fa/CODEBASE_GUIDE.md`, `docs-fa/02-BACKEND.md`, `docs-fa/03-FRONT-BACK-CONNECTIONS.md`, `docs-fa/DEPLOY-SUPABASE-EDGE.md`, and `docs-fa/LAUNCH-READINESS.md`
- Modify: `backend/README.md`

**Interfaces:**
- Edge constructs only ZarinPal in production and fake in explicit non-production tests.
- Shared parity manifest contains no Zibal/router files.

- [ ] **Step 1: Update Edge tests to the ZarinPal callback and attempt contract**

Mirror backend cases for stable attempt, 100/101, forged callback, duplicate callback/poll, timeout/malformed response, recovery, and one grant.

- [ ] **Step 2: Run Edge tests and observe failures before synchronization**

Run: `npm run test:edge -- --maxWorkers=1`

- [ ] **Step 3: Update Edge wiring and shared manifest**

Remove router/Zibal imports, use direct provider construction, update the hand-ported dev gateway, then run `npm run sync:edge`. Delete generated files no longer present in the manifest.

- [ ] **Step 4: Remove NextPay artifacts and update maintained docs**

Document ZarinPal-only env, migration order, callback/Verify flow, no fake production escape, and the distinction between source-ready and live-deployed. Preserve unrelated dirty documentation content when integrating.

- [ ] **Step 5: Run Edge and parity tests**

Run: `npm run test:edge -- --maxWorkers=1`

Run: `cd backend; npm test -- --maxWorkers=1 test/edge-parity.test.ts test/phone-parity.test.ts`

- [ ] **Step 6: Commit Edge/docs cleanup**

```powershell
git add scripts supabase backend/README.md docs-fa docs/superpowers
git commit -m "chore(payments): remove legacy gateway surfaces"
```

### Task 8: Full launch-readiness validation

**Files:**
- Review all changed files and generated artifacts.

**Interfaces:**
- Produces the final evidence table and explicit remaining live gates.

- [ ] **Step 1: Run complete backend validation**

Run: `cd backend; npm test -- --maxWorkers=1; npm run typecheck; npm run build`

- [ ] **Step 2: Run complete frontend and Edge validation**

Run: `npm test; npm run test:edge -- --maxWorkers=1; npm run lint; npx tsc --noEmit; npm run build`

- [ ] **Step 3: Verify generated parity and migration/setup artifacts**

Run: `npm run sync:edge`

Run: `git diff --exit-code -- supabase/functions/api/shared`

Run the migration against a disposable local PostgreSQL/PGlite-compatible database when supported; otherwise parse and pressure-test its preflight statements in the schema test suite and report the unexecuted boundary.

- [ ] **Step 4: Run forbidden-reference and secret scans**

Search maintained runtime/config/test/docs/generated paths for case-insensitive `zibal`, `nextpay`, `ZIBAL_MERCHANT`, `NEXTPAY_API_KEY`, `PSP_PROVIDERS`, router imports, live provider calls in tests, merchant-like UUID literals outside fixtures, and raw provider-response logging. Historical git/worktree refs are outside runtime scope and reported separately.

- [ ] **Step 5: Inspect final diff and working tree ownership**

Run: `git diff --check`, `git status --short`, and focused diffs. Confirm unrelated pre-existing changes were neither overwritten nor included in payment commits.

- [ ] **Step 6: Report actual launch state**

Report changed/removed surfaces, exact test counts and exit codes, migration file/order, required production env/secrets, whether source is Launch Ready, and separate blockers for remote migration, secret verification, deploy provenance, or controlled live payment evidence.
