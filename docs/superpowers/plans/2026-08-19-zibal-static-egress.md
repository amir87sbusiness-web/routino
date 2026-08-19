# Zibal Static Egress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** عبور امن و کم‌مصرف تماس‌های زیبال از یک رلهٔ دارای IPv4 ثابت، بدون تغییر مسیرهای عادی برنامه یا ذخیرهٔ دادهٔ شخصی.

**Architecture:** Cloudflare Worker ورودی عمومی فعلی را نگه می‌دارد. آداپتور زیبال در backend و Edge، در صورت وجود تنظیمات رله، بدنه را با HMAC امضا می‌کند و رله فقط دو عملیات مجاز را به زیبال می‌فرستد. رله stateless و بدون دیتابیس است.

**Tech Stack:** TypeScript/Vitest، Web Crypto، Node 22 HTTP server، Docker، Supabase Edge/Deno، Cloudflare Worker موجود.

## Global Constraints

- منطق بک‌اند فقط در `backend/src/` تغییر می‌کند و سپس با `npm run sync:edge` تولید می‌شود.
- `supabase/functions/api/shared/` دستی ویرایش نمی‌شود.
- هیچ پرداخت یا پیامک واقعی در تست اجرا نمی‌شود.
- اطلاعات عادت‌ها، کارها و تنظیمات کاربر به سرور اضافه نمی‌شود.
- مسیر مستقیم زیبال برای dev/test سازگار می‌ماند؛ تنظیم ناقص رله در production fail-fast است.

---

### Task 1: قرارداد امضا و رله

**Files:**

- Create: `payment-relay/relay.js`
- Create: `payment-relay/server.js`
- Create: `payment-relay/package.json`
- Create: `payment-relay/Dockerfile`
- Test: `supabase/tests/payment-relay.test.ts`

**Interfaces:**

- Produces: `createRelayHandler({ merchant, secret, fetchImpl, now })` و `signRelayRequest({ secret, timestamp, nonce, path, body })`.
- HTTP contract: `POST /v1/request|/v1/verify`, signed headers, JSON response; `GET /health` local.

- [ ] **Step 1: Write failing tests** for valid forwarding, merchant override, invalid signature, stale timestamp, replayed nonce, forbidden path, oversized/invalid body and local health.
- [ ] **Step 2: Run RED:** `npm run test:edge -- supabase/tests/payment-relay.test.ts`; expected failure is missing `payment-relay/relay.js`.
- [ ] **Step 3: Implement minimal relay** with Web Crypto HMAC, constant-time comparison, a bounded nonce map, exact path allowlist, 8 KiB limit and 12 s upstream timeout.
- [ ] **Step 4: Run GREEN:** same command; all relay tests pass.

### Task 2: اتصال آداپتور زیبال به رله

**Files:**

- Modify: `backend/src/env.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/providers/psp/zibal.ts`
- Modify: `supabase/functions/api/index.ts`
- Test: `backend/test/app.test.ts`
- Test: `backend/test/psp.test.ts`

**Interfaces:**

- Produces: `zibalPsp(merchant, relay?)` where `relay` is `{ url: string; secret: string }`.
- Env: `ZIBAL_RELAY_URL` and `ZIBAL_RELAY_SECRET`, both empty or both non-empty.

- [ ] **Step 1: Write failing adapter tests** proving request and verify use the relay URL, include independently verified HMAC headers, preserve payloads, and keep direct mode unchanged.
- [ ] **Step 2: Write failing env tests** proving production rejects half-configured relay settings.
- [ ] **Step 3: Run RED:** `cd backend; npm test -- psp.test.ts app.test.ts`.
- [ ] **Step 4: Implement relay signing and wiring** in backend and Deno entry points without logging secrets or payloads.
- [ ] **Step 5: Run GREEN:** rerun focused backend tests.

### Task 3: تشخیص خطا و مستندات استقرار

**Files:**

- Modify: `backend/src/providers/psp/index.ts`
- Modify: `backend/src/services/payment-flow.ts`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/DEPLOY-SUPABASE-EDGE.md`
- Create: `payment-relay/README.md`

**Interfaces:**

- Produces: کد ثابت `ZIBAL_RESULT.IP_NOT_ALLOWED = 115` و لاگ امن شامل result/message بدون اطلاعات حساس.

- [ ] **Step 1: Add a failing payment test** that a gateway rejection persists result `115` and emits an actionable safe diagnostic.
- [ ] **Step 2: Run RED:** `cd backend; npm test -- payments.test.ts`.
- [ ] **Step 3: Implement the result constant and safe diagnostic**, then document exact secrets, Docker deployment, health check and the single IPv4 value to enter in Zibal.
- [ ] **Step 4: Run GREEN:** rerun the focused payment test.

### Task 4: همگام‌سازی و تأیید

**Files:**

- Generate: `supabase/functions/api/shared/*` via `npm run sync:edge`

- [ ] **Step 1: Run:** `npm run sync:edge`.
- [ ] **Step 2: Verify backend:** `cd backend; npm run typecheck; npm test`.
- [ ] **Step 3: Verify Edge/Worker:** `npm run test:edge`.
- [ ] **Step 4: Verify repository:** `npm run lint; npm run build`.
- [ ] **Step 5: Build relay image:** `docker build -t routino-payment-relay ./payment-relay` when Docker is available; otherwise run its Node tests and record the missing local runtime explicitly.

### Task 5: انتشار و تست دود

**Files:** no source changes unless deployment diagnostics expose a bug.

- [ ] **Step 1: Push the reviewed commit** to `origin/codex/local-first-launch`.
- [ ] **Step 2: Deploy Supabase Edge** after setting both relay secrets.
- [ ] **Step 3: Deploy the existing Cloudflare Worker** only if its source changed; otherwise retain the verified production version.
- [ ] **Step 4: Deploy relay on a host with fixed IPv4**, set `ZIBAL_MERCHANT` and `RELAY_SECRET`, and add that host's outbound IPv4 to Zibal.
- [ ] **Step 5: Smoke-test** `/health`, `/health/ready`, `/v1/plans` cache, one sandbox/non-money relay contract request, and confirm no SMS or real charge occurred.
