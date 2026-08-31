# Admin OTP and Database Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-stored admin token with owner-phone OTP and secure sliding cookies while replacing append-per-failure login storage with expiring aggregate counters.

**Architecture:** Canonical framework-independent authentication logic lives in `backend/src/services/` and is synchronized to Edge. Fastify and Hono keep thin cookie/route adapters. Database rollout is expand-first; destructive cleanup is a separate contract migration that is not applied until live owner login succeeds.

**Tech Stack:** TypeScript, Fastify, Hono, Drizzle/PostgreSQL, jose, PGlite, Vitest, Supabase Edge Functions.

## Global Constraints

- Never commit or log the literal admin phone, OTP, database URL, provider key, or session secret.
- `ADMIN_PHONE` and `ADMIN_SESSION_SECRET` exist only as production secrets; the session secret is at least 32 random bytes.
- Admin session is an HttpOnly, Secure, SameSite=Strict cookie with 90-day lifetime and renewal only inside the final 30 days.
- Admin mutation routes require the double-submit CSRF cookie/header pair.
- Wrong and permitted phone requests expose the same status and response body; only the permitted phone reaches the SMS provider.
- Do not delete or rewrite users, records, payments, grants, entitlements, discounts, redemptions, feedback, or OTP history.
- Canonical backend edits must be followed by `npm run sync:edge` and Edge parity tests.

---

### Task 1: Expiring aggregate authentication buckets

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `backend/src/services/login-throttle.ts`
- Modify: `backend/src/routes/auth.ts`
- Test: `backend/test/password-auth.test.ts`
- Test: `backend/test/concurrency.test.ts`

**Interfaces:**
- Produces: `checkLoginRate(db, env, ip, identifier, now): Promise<LoginRateVerdict>`.
- Produces: `recordLoginFailure(db, env, ip, identifier, now, { trackIdentifier }): Promise<void>`.
- Produces: `clearLoginFailures(db, env, identifier): Promise<void>`.
- Produces: `claimAdminOtpRequest(db, env, ip, now): Promise<LoginRateVerdict>`.

- [ ] **Step 1: Write failing behavior tests**

Add tests proving fifty failures for one known identifier create one current identifier row and one IP row, unknown identifiers create only an IP row, concurrent increments preserve the count, successful login clears only the identifier counter, and expired windows no longer throttle.

- [ ] **Step 2: Verify RED**

Run: `cd backend && npm test -- password-auth.test.ts concurrency.test.ts --maxWorkers=1`

Expected: failures because `auth_rate_limit_buckets` and the Env-aware signatures do not exist.

- [ ] **Step 3: Implement the aggregate table and limiter**

Create `auth_rate_limit_buckets(scope, key_hash, window_start, count, expires_at)` with primary key `(scope,key_hash,window_start)`, `count >= 1`, and an expiry index. HMAC keys with `OTP_PEPPER`; update counters with `INSERT ... ON CONFLICT ... count=count+1`. Preserve the 15-minute soft/hard/IP limits. Only track an identifier after the route has found a real account; always track the IP.

- [ ] **Step 4: Verify GREEN**

Run: `cd backend && npm test -- password-auth.test.ts concurrency.test.ts --maxWorkers=1`

- [ ] **Step 5: Commit the limiter unit**

Stage only the schema, limiter, auth route and tests. Commit message: `feat: aggregate authentication rate limits`.

---

### Task 2: Stateless admin session and OTP service

**Files:**
- Modify: `backend/src/env.ts`
- Create: `backend/src/services/admin-auth.ts`
- Test: `backend/test/admin-auth.test.ts`
- Modify: `backend/test/app.test.ts`

**Interfaces:**
- Produces: `adminOtpLedgerKey(env): string`, an opaque HMAC namespace.
- Produces: `adminPhoneMatches(env, rawPhone): boolean` using canonical normalization and constant-time comparison.
- Produces: `issueAdminSession(env, now): Promise<{ token: string; expiresAt: Date }>`.
- Produces: `verifyAdminSession(env, token, now): Promise<{ expiresAt: Date; renew: boolean }>`.
- Produces: `newAdminCsrfToken(): string` and cookie parsing/serialization helpers.

- [ ] **Step 1: Write failing service and environment tests**

Cover valid/invalid admin phone configuration, production rejection for absent/weak session secret and proxy secret, opaque OTP ledger key, constant generic comparison behavior, valid/expired/wrong-secret sessions, 90-day expiry, and renewal threshold at 30 days.

- [ ] **Step 2: Verify RED**

Run: `cd backend && npm test -- admin-auth.test.ts app.test.ts --maxWorkers=1`

- [ ] **Step 3: Implement minimal service**

Use a separate HS256 secret and fixed issuer/audience/subject for admin cookies; never include the phone in claims. Serialize `routino_admin_session` as HttpOnly+Secure+SameSite=Strict+Path=/ and `routino_admin_csrf` as Secure+SameSite=Strict+Path=/. Remove runtime dependence on `ADMIN_TOKEN`.

- [ ] **Step 4: Verify GREEN**

Run: `cd backend && npm test -- admin-auth.test.ts app.test.ts --maxWorkers=1`

- [ ] **Step 5: Commit the service unit**

Commit message: `feat: add stateless admin sessions`.

---

### Task 3: Fastify and Edge admin OTP routes

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `supabase/functions/api/routes/admin.ts`
- Modify: `backend/src/app.ts`
- Modify: `supabase/functions/api/app.ts`
- Modify: `cloudflare/api-worker.js`
- Test: `backend/test/admin.test.ts`
- Test: `supabase/tests/admin.test.ts`

**Interfaces:**
- Adds: `POST /v1/admin/auth/otp/request { phone } -> 202 { accepted: true }`.
- Adds: `POST /v1/admin/auth/otp/verify { phone, code } -> 200 { authenticated: true }` plus cookies.
- Adds: `GET /v1/admin/auth/session -> 200 { authenticated: true }` or 401.
- Adds: `POST /v1/admin/auth/logout -> 204` and clears cookies.
- Changes: `/v1/admin/*` data routes accept only valid session cookie; POST data routes also require `x-admin-csrf` matching the CSRF cookie.

- [ ] **Step 1: Write failing adapter tests**

Cover zero SMS for wrong phone, one SMS for permitted phone, generic request responses, namespaced single-use OTP, user/admin OTP separation, cookie attributes, session renewal, logout, legacy header rejection, read-cookie authorization, and CSRF rejection/acceptance.

- [ ] **Step 2: Verify RED in both adapters**

Run: `cd backend && npm test -- admin.test.ts --maxWorkers=1`

Run: `npm run test:edge -- admin.test.ts --maxWorkers=1`

- [ ] **Step 3: Implement the thin adapters**

Call `claimAdminOtpRequest` before phone comparison. Return the generic 202 even when the phone is not permitted or the provider send fails; release a claimed OTP slot on definite provider failure. Protect all non-auth admin routes with cookie verification and POST routes with CSRF. Allow `x-admin-csrf` in CORS/preflight.

- [ ] **Step 4: Verify GREEN and parity**

Run the two commands from Step 2, then `npm run sync:edge && npm run test:edge -- --maxWorkers=1`.

- [ ] **Step 5: Commit the route unit**

Commit message: `feat: authenticate admin with otp cookies`.

---

### Task 4: Simple phone-and-code admin panel

**Files:**
- Modify: `backend/src/lib/admin-page.ts`
- Test: `backend/test/admin-page.test.ts`

**Interfaces:**
- Consumes the four `/v1/admin/auth/*` routes and `routino_admin_csrf` cookie.
- Stores no admin credential in Web Storage.

- [ ] **Step 1: Load the UI hardening playbook and craft floor**

Read `impeccable/reference/harden.md` and `impeccable/reference/craft-floor.md`; preserve the incumbent Operate-mode visual system.

- [ ] **Step 2: Write failing panel behavior tests**

Assert the real page requests session on boot, uses phone and OTP inputs with labels/autocomplete/inputmode, never reads/writes localStorage, sends `credentials: same-origin`, includes CSRF on mutations, and returns to login after logout/401.

- [ ] **Step 3: Verify RED**

Run: `cd backend && npm test -- admin-page.test.ts --maxWorkers=1`

- [ ] **Step 4: Implement the two-step form**

Use one compact card: phone step, then code step with change-number action. Disable submits while pending, use generic Persian feedback, preserve keyboard/focus/error behavior, and keep the existing panel tabs unchanged.

- [ ] **Step 5: Verify GREEN and run the UI detector**

Run the test from Step 3 and:
`node C:/Users/User/.agents/skills/impeccable/scripts/detect.mjs --json backend/src/lib/admin-page.ts`

- [ ] **Step 6: Commit the UI unit**

Commit message: `feat: simplify admin otp login`.

---

### Task 5: Expand and contract migrations plus retention jobs

**Files:**
- Create: `supabase/migrations/20260831140000_auth_rate_limit_buckets.sql`
- Create: `supabase/migrations/20260831141000_remove_legacy_auth_tables.sql`
- Modify: `scripts/gen-setup-sql.mjs`
- Modify: `supabase/setup.sql` (generated)
- Modify: `backend/test/launch-ddl.test.ts`
- Modify: `supabase/tests/quota.test.ts`

**Interfaces:**
- Expand migration creates and locks down the bucket table without dropping anything.
- Contract migration unschedules the old purge, aborts if `admins` is nonempty, then drops only `login_attempts` and `admins`.

- [ ] **Step 1: Write failing migration tests**

Run both migrations against populated fixtures and assert critical table rows are byte-equivalent before/after; assert contract aborts when `admins` has a row; assert expired bucket purge removes only operational rows.

- [ ] **Step 2: Verify RED**

Run: `cd backend && npm test -- launch-ddl.test.ts --maxWorkers=1`

Run: `npm run test:edge -- quota.test.ts --maxWorkers=1`

- [ ] **Step 3: Implement migrations and generator**

Schedule `routino-auth-rate-limit-purge` hourly using `expires_at < now()`. Remove the legacy login purge from generated setup and include the bucket table in RLS. Keep the contract migration separate and reversible through the pre-release backup.

- [ ] **Step 4: Verify GREEN**

Run the two commands from Step 2 and regenerate setup SQL.

- [ ] **Step 5: Commit the migration unit**

Commit message: `db: bound authentication retention`.

---

### Task 6: Documentation and complete local gate

**Files:**
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/DEPLOY-SUPABASE-EDGE.md`

- [ ] **Step 1: Update the operator contract**

Document OTP-cookie login, secret names, retention, expand/deploy/contract order, and the owner-assisted live verification requirement. Do not include the literal phone.

- [ ] **Step 2: Run the complete local gate**

Run root tests/lint/build; backend typecheck/tests/build; `npm run sync:edge`; Edge tests; setup generation; `git diff --check`; and secret-literal scans.

- [ ] **Step 3: Commit documentation**

Commit message: `docs: document admin otp operations`.

---

### Task 7: Safe production rollout

- [ ] **Step 1: Read-only preflight and backup**

Verify project ref, branch SHA, remote state and CLI identity. Export schema plus affected operational/critical-table rows to a local timestamped backup outside source control; record nonzero counts and payment/grant invariants without printing secrets.

- [ ] **Step 2: Apply expand migration only**

Dry-run against PGlite, inspect the exact remote migration list, then apply only `20260831140000_auth_rate_limit_buckets.sql`.

- [ ] **Step 3: Configure secrets and deploy Edge/Worker/Pages**

Set `ADMIN_PHONE` from the owner-provided value and generate `ADMIN_SESSION_SECRET` without emitting either. Deploy Edge with `--no-verify-jwt`, then Worker/Pages from reviewed artifacts.

- [ ] **Step 4: Bounded live verification**

Verify `/health`, `/health/ready`, `/v1/plans`, CORS, raw-origin blocking, generic wrong-phone behavior, one permitted-phone OTP send, browser session/cookie/CSRF behavior, and ordinary app login/sync/payment reads. Never run a production stress test or real payment without separate owner participation.

- [ ] **Step 5: Contract only after owner login**

After the owner successfully signs in through the live panel, recheck backups/counts and apply `20260831141000_remove_legacy_auth_tables.sql`. Otherwise leave legacy tables unused but intact and report the pending gate.
