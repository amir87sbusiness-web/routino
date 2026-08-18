# Launch Copy, Android, and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship concise user-facing landing copy, a verified signed Android APK, lower-cost Worker/Edge traffic, privacy-safe logging, and a fully tested production deployment.

**Architecture:** Preserve the current local-first app and visual system. Replace the expensive session list poll with a minimal authenticated ping, throttle entitlement refresh independently, move safe protocol work to Cloudflare Worker, and add bounded structured diagnostics at each boundary. Android remains a Capacitor universal APK signed with an owner-controlled key outside Git.

**Tech Stack:** React 19, TypeScript, Vite, Capacitor 7, Gradle/Android SDK 35, Fastify, Hono, Supabase Edge Functions, Cloudflare Worker, Vitest, PGlite.

## Global Constraints

- Personal habit/task/journal data never leaves the device.
- Export remains available to every plan; Import remains paid-only.
- Device revocation checks remain active on boot, online, foreground, and while visible.
- The landing page contains no price, trial, fabricated metric, fabricated testimonial, or multi-device sync claim.
- Signing keys, passwords, tokens, OTP values, and user content never enter Git or logs.
- `src/lib/phone.ts` and `backend/src/lib/phone.ts` remain byte-identical.
- Backend shared logic changes require `npm run sync:edge` and `npm run test:edge`.
- Generated `dist/`, `www/`, `src/routeTree.gen.ts`, and `supabase/functions/api/shared/` are never hand-edited.

---

### Task 1: Concise landing copy and configurable Android link

**Files:**
- Modify: `landing/index.template.html`
- Modify: `scripts/build-landing.mjs`
- Create: `src/lib/landing-copy.test.ts`
- Modify: `docs-fa/01-FRONTEND.md`

**Interfaces:**
- Consumes: environment variable `ANDROID_DOWNLOAD_URL` at landing build time.
- Produces: escaped `<!--ANDROID-DOWNLOAD-->` markup and truthful Persian landing copy.

- [ ] **Step 1: Write the failing landing contract test**

Assert that the template no longer contains `همگام`, `گوشی و لپ‌تاپ`, fabricated metrics, or the old hero; assert that the build script exposes a pure `renderAndroidDownload(url)` helper whose empty state is disabled and whose HTTPS state uses `rel="noreferrer"`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/lib/landing-copy.test.ts`
Expected: FAIL because the old claims and hard-coded disabled button still exist.

- [ ] **Step 3: Rewrite only user-relevant copy**

Use one short hero, four product sections (habits, today, focus, progress), one reminder/offline benefit block, and a final CTA. Keep the existing visual structure, screenshots, dark palette, no-pricing decision, and legal links.

- [ ] **Step 4: Add safe download-link rendering**

`renderAndroidDownload(url)` accepts only `https:` URLs, HTML-escapes the value, renders an enabled Android link when present, and otherwise renders the existing honest disabled state. Invalid/non-HTTPS values fail the build with a clear error.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/lib/landing-copy.test.ts && npm run build`
Commit: `feat: clarify landing copy and android download`

### Task 2: Lightweight device ping and entitlement cadence

**Files:**
- Modify: `backend/src/routes/devices.ts`
- Modify: `supabase/functions/api/routes/devices.ts`
- Modify: `src/lib/api/devices.ts`
- Modify: `src/lib/api/auth.ts`
- Modify: `src/state/app.tsx`
- Modify: `backend/test/devices.test.ts`
- Modify: `supabase/tests/devices.test.ts`
- Create: `src/lib/entitlement-refresh.test.ts`
- Create: `src/lib/entitlement-refresh.ts`

**Interfaces:**
- Produces: `pingDevice(): Promise<{ok:true}>` on `GET /v1/devices/ping`.
- Produces: `shouldRefreshEntitlement({now,lastCheckedAt,expiresAt,force}): boolean` with six-hour normal TTL and immediate refresh when forced or close to expiry.

- [ ] **Step 1: Add failing backend and Edge ping tests**

Verify an active device receives `{ok:true}`, a replaced/revoked device receives the existing security error, and the response exposes no device list or account fields.

- [ ] **Step 2: Run RED tests**

Run: `cd backend && npm test -- devices.test.ts`; then `npm run test:edge -- devices.test.ts`.
Expected: 404 for the new ping route.

- [ ] **Step 3: Implement the minimal ping route on both HTTP adapters**

The route uses only existing auth middleware and returns `{ok:true}`; no extra user/device/event-list query is added.

- [ ] **Step 4: Add failing entitlement cadence tests**

Cover missing timestamp, six-hour freshness, force refresh, expiry within three days, expired entitlement, and clock moving backwards.

- [ ] **Step 5: Implement cadence and client migration**

Persist `lastEntitlementCheckedAt` with token metadata, call `pingDevice()` for periodic security checks, and call `fetchEntitlement()` only when `shouldRefreshEntitlement` says so. Force on post-login/payment and expired offline-lease recovery. Keep network failures non-destructive.

- [ ] **Step 6: Verify and commit**

Run focused frontend/backend/Edge tests and commit: `perf: reduce session verification database work`.

### Task 3: Worker offload, request coalescing, and request IDs

**Files:**
- Modify: `cloudflare/api-worker.js`
- Modify: `supabase/tests/worker.test.ts`
- Modify: `supabase/functions/api/app.ts`
- Modify: `backend/src/app.ts`
- Modify: `supabase/tests/app.test.ts`
- Modify: `backend/test/app.test.ts`

**Interfaces:**
- Produces: `x-request-id` on every response.
- Produces: Worker-local `/health` JSON and CORS preflight 204 for approved origins.
- Preserves: `/health/ready` as the real Edge+database readiness check.

- [ ] **Step 1: Add failing Worker tests**

Test direct `/health` without origin fetch, allowed/disallowed OPTIONS behavior, request-ID forwarding/creation, and one upstream call for concurrent `/v1/plans` misses.

- [ ] **Step 2: Run RED Worker tests**

Run: `npm run test:edge -- worker.test.ts`.

- [ ] **Step 3: Implement Worker offload**

Handle only exact `/health`; answer OPTIONS from the existing explicit origin set; use an isolate-local in-flight Map around cache misses; forward a validated or generated UUID request ID; never cache personalized paths or errors.

- [ ] **Step 4: Add request-ID middleware tests for Fastify and Hono**

Test preservation of a safe inbound ID, generation when missing/invalid, response header, and availability in error logs.

- [ ] **Step 5: Implement bounded request middleware**

Record method, route, status, duration, cache state, and request ID. Never record authorization/cookie/body. Log 5xx, security/payment/admin events, and slow requests; sample routine 2xx only.

- [ ] **Step 6: Verify and commit**

Run Worker, app, security, and payment tests. Commit: `perf: offload safe api traffic to worker`.

### Task 4: Bounded local diagnostics

**Files:**
- Create: `src/lib/diagnostics.ts`
- Create: `src/lib/diagnostics.test.ts`
- Modify: `src/lib/api/client.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `docs-fa/01-FRONTEND.md`

**Interfaces:**
- Produces: `recordDiagnostic(event)`, `readDiagnostics()`, `clearDiagnostics()`, `exportDiagnostics()`.
- Stores: maximum 100 technical events, seven-day retention, no request/response bodies.

- [ ] **Step 1: Write failing privacy and retention tests**

Test capped length, age pruning, invalid-storage recovery, secret-key redaction, and export shape.

- [ ] **Step 2: Run RED test and implement the bounded ring**

Use one localStorage key scoped to the current local vault; allow only enumerated event names and scalar safe metadata.

- [ ] **Step 3: Instrument API and global failures**

Record path template, status, duration, offline/timeout state, and request ID. Never store query strings, tokens, phone, username, OTP, user-authored text, or payloads.

- [ ] **Step 4: Verify and commit**

Run diagnostics and API tests. Commit: `feat: add privacy-safe local diagnostics`.

### Task 5: Repeatable signed Android release package

**Files:**
- Modify: `android/app/build.gradle`
- Create: `scripts/build-android-release.mjs`
- Modify: `.gitignore`
- Modify: `docs-fa/MOBILE_SETUP.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: ignored `android/keystore.properties`, Android SDK, Android Studio JBR.
- Produces: `output/android/routino-android-<version>.apk`, `.sha256`, and `.json` metadata.

- [ ] **Step 1: Add a packaging dry-run test**

The script must fail clearly when signing config is absent, reject debug-signed APKs, and never print passwords.

- [ ] **Step 2: Generate the permanent keystore outside Git**

Create it under `C:\Users\User\.routino-signing\`, generate strong random passwords, write only ignored `android/keystore.properties`, and confirm Git does not see either file.

- [ ] **Step 3: Harden Release build**

Enable R8/resource shrinking only after a successful baseline Release build, retain Capacitor bridge/plugin classes, set production `VITE_API_URL=https://api.routino.me/v1`, and keep minSdk 23/targetSdk 35.

- [ ] **Step 4: Build and verify**

Run `npm run android:release`; require `apksigner verify --verbose --print-certs` success, package `com.routino.app`, versionCode/versionName match, no debug certificate, and APK under the chosen host limit.

- [ ] **Step 5: Install and smoke-test Android**

Use an emulator/device if available; test launch, local data persistence, offline restart, notification permission, login endpoint reachability, export share sheet, and return from background.

- [ ] **Step 6: Commit reproducible build support**

Commit scripts/config/docs only; never APK or signing material. Commit: `build: add verified android release packaging`.

### Task 6: Load, regression, security, and visual verification

**Files:**
- Create: `scripts/load-smoke.mjs`
- Create: `backend/test/load.test.ts`
- Modify: `supabase/tests/quota.test.ts`
- Modify: `docs-fa/LAUNCH-READINESS.md`

**Interfaces:**
- Produces: bounded local load report with concurrency, latency percentiles, status counts, and error count.

- [ ] **Step 1: Add local concurrency tests**

Exercise health, plans, ping, invalid auth, OTP rate limits, and entitlement reads with bounded concurrency. Assert no 5xx and preserved rate-limit/security behavior.

- [ ] **Step 2: Run local Fastify and Edge load smoke**

Use PGlite/test providers only; do not send OTP or payment load to production.

- [ ] **Step 3: Run full verification**

Run frontend tests, backend tests/typecheck/build, Edge tests/parity, web/mobile builds, production audits, `git diff --check`, Android lint, APK verification, and Worker tests.

- [ ] **Step 4: Perform one bounded visual pass**

Inspect landing desktop and mobile together, then Android emulator/device. Fix all findings in one batch and confirm once. Run Impeccable detector once on changed UI targets.

- [ ] **Step 5: Commit verification/docs**

Commit: `test: add launch load and release verification`.

### Task 7: Production deployment and Loop monitoring

**Files:**
- Modify: `docs-fa/DEPLOY-SUPABASE-EDGE.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/LAUNCH-READINESS.md`

**Interfaces:**
- Deployment order: Supabase Edge -> Cloudflare Worker -> Git main/Pages -> smoke -> Loop.

- [ ] **Step 1: Deploy Edge and verify schema/API**

Run `npm run sync:edge`, parity tests, deploy function `api`, then verify `/health/ready`, sync 410, plans, security ping, and headers.

- [ ] **Step 2: Deploy Worker**

Use authenticated Wrangler or connected Git build; verify direct health, ready upstream, request ID, CORS preflight, plans HIT behavior, and admin CSP.

- [ ] **Step 3: Push the tested branch to Git main**

Require a fast-forward from current origin/main, preserve the user's dirty local main worktree, and push only after all release gates pass.

- [ ] **Step 4: Verify Cloudflare Pages and public flows**

Check homepage, legal, `/app/`, PWA offline reload, Android disabled state until URL exists, OTP/password login, paid/free Import policy, device replacement, and payment sandbox/real-provider status without creating false purchases.

- [ ] **Step 5: Arm post-deploy Loop**

Run immediately, then monitor health, ready, plans, landing, app shell, cache headers, and recent deployment state at a five-minute cadence during the release window. Stop after stable confirmation or on a rollback-worthy failure.

- [ ] **Step 6: Final documentation and report**

Record exact versions, APK SHA-256/certificate fingerprint, deployed Git SHA, Supabase function version, Worker/Pages status, test counts, remaining external link step, and recovery instructions.
