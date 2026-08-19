# Admin, Auth, Settings and Contact Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Each
> behavior change follows a failing-test, passing-test cycle.

**Goal:** Deliver the approved responsive admin panel, four-digit SMS
authentication and recovery flows, Settings cleanup, and complete public-email
removal without changing payment or local-data behaviour.

**Architecture:** Keep `/admin` as the shared framework-free Fastify/Edge page,
but make its first authenticated overview response reusable and its shell
responsive. Extend the existing OTP verification endpoint with an explicit
post-verification intent so password reset stays atomic with the verified SMS
proof. The React client only changes presentation and request intent; all
security decisions remain server-authoritative.

**Tech Stack:** React 19, TypeScript, Vitest, Fastify, Drizzle/PGlite,
framework-free admin HTML, Vite, Tailwind, Cloudflare/Supabase Edge parity.

## Global Constraints

- Remove both requested cards from `src/routes/settings.tsx`: `امنیت نگهداری روی
  این دستگاه` and `دستگاه‌های حساب`.
- Do not weaken the device ping, device policy, revocation, account lock or
  admin device controls.
- Four-digit OTPs use a CSPRNG; all environments permit at most three guesses.
- Keep the backend verifier compatible with an already-issued six-digit OTP for
  the two-minute deployment overlap.
- Never hand-edit generated Edge copies, `dist/`, `www/`, or `routeTree.gen.ts`.
- After backend edits run `npm run sync:edge` and `npm run test:edge`.
- Never modify `payment-flow.ts` or `src/lib/db/*` for this work.

---

### Task 1: Four-digit OTP and password-recovery contract

**Files:**
- Modify: `backend/test/auth.test.ts`
- Modify: `backend/test/password-auth.test.ts`
- Modify: `backend/src/services/otp.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/.env.example`
- Modify: `backend/src/providers/sms/kavenegar.ts`
- Modify: `docs-fa/02-BACKEND.md`

**Interfaces:**
- Produces `POST /v1/auth/otp/verify` body fields `intent?: "signup" | "password_reset"` and `newPassword?: string`.
- Existing callers that omit both fields retain the current SMS sign-in result.
- A `password_reset` response preserves the newly verified device while all
  prior device sessions are revoked.

- [ ] **Step 1: Add the failing four-digit and recovery tests**

  In `auth.test.ts`, assert the provider receives a code matching
  `/^\\d{4}$/`, change the brute-force boundary to three failed attempts, and
  add this real multi-device scenario:

  ```ts
  const victim = await signIn("09123334444");
  await h.raw(`update users set max_active_devices = 2`);
  const other = await signIn("09123334444");
  await request("09123334444");
  const reset = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: {
      phone: "09123334444",
      code: h.sms.last()!.code,
      intent: "password_reset",
      newPassword: "Naghmeh@1405",
      deviceName: "recovery-device",
    },
  });
  expect(reset.statusCode).toBe(200);
  expect(await refreshIsRejected(other.refresh)).toBe(true);
  expect(await refreshIsAccepted(reset.json().refresh)).toBe(true);
  ```

  In `password-auth.test.ts`, add an assertion that a reset intent rejects a
  weak password and that ordinary SMS sign-in does not replace an existing
  password.

- [ ] **Step 2: Run the targeted backend tests and confirm they fail for the intended reasons**

  Run: `cd backend && npm test -- auth.test.ts password-auth.test.ts`

  Expected before implementation: the SMS assertion reports six digits, the
  fourth incorrect verification is still accepted, and recovery intent is
  ignored or validation fails.

- [ ] **Step 3: Implement the minimal server contract**

  - Use `randomInt(1_000, 10_000)` for every newly created code.
  - Set the documented/default OTP attempt value to three and apply
    `Math.min(env.OTP_MAX_ATTEMPTS, 3)` in the atomic verify query so an old
    production environment value cannot weaken the new four-digit policy.
  - Keep the current verification body upper length at eight to let an
    already-issued six-digit code finish during the two-minute rollout window.
  - Extend the verification schema with optional `intent` and `newPassword`.
    Validate a supplied password with the existing password validator before
    writing it. For `signup`, set it only on a newly created account. For
    `password_reset`, set it after SMS verification, issue the verified-device
    token, then call `revokeOtherDevices` with that token's `deviceId`.
  - Retain the current generic account-creation and trial behavior and never
    branch a pre-verification response on account existence.
  - Update four/six-digit comments and the Kavenegar template assumption.

- [ ] **Step 4: Re-run the targeted backend tests and confirm they pass**

  Run: `cd backend && npm test -- auth.test.ts password-auth.test.ts`

  Expected: four-digit generation, three-attempt lockout, ordinary sign-in
  preservation, and recovery-session revocation pass.

- [ ] **Step 5: Commit the completed backend slice**

  ```bash
  git add backend/src/services/otp.ts backend/src/routes/auth.ts backend/src/env.ts backend/.env.example backend/src/providers/sms/kavenegar.ts backend/test/auth.test.ts backend/test/password-auth.test.ts docs-fa/02-BACKEND.md
  git commit -m "feat: use four-digit SMS codes for recovery"
  ```

### Task 2: Explicit registration and recovery UI

**Files:**
- Modify: `src/routes/auth.tsx`
- Modify: `src/lib/api/auth.ts`
- Create: `src/routes/-auth.test.tsx` (leading `-` keeps it out of the route tree)
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`

**Interfaces:**
- `verifyOtp(phone, code, options)` accepts the optional server intent and new
  password while still supplying the existing device descriptor.
- The UI sends exactly four ASCII digits and cannot submit fewer or more.

- [ ] **Step 1: Write failing UI behavior tests**

  Render the real route with its minimal app context and API boundary mocked
  only below the route. Assert:

  ```ts
  expect(screen.getByRole("button", { name: "ثبت‌نام" })).toBeVisible();
  expect(screen.getByRole("button", { name: "فراموشی رمز عبور" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "ثبت‌نام" }));
  expect(screen.getByRole("textbox", { name: /کد/i })).toHaveAttribute("maxlength", "4");
  ```

  Drive recovery through phone, code and new-password state and assert its API
  call carries `intent: "password_reset"`; drive registration and assert
  `intent: "signup"` plus the chosen password.

- [ ] **Step 2: Run the route test and confirm it fails because the two actions and four-slot field do not exist**

  Run: `npm test -- src/routes/-auth.test.tsx`

- [ ] **Step 3: Implement the smallest client flow**

  - Replace the long combined SMS link with two accessible buttons.
  - Preserve the password form as the default screen.
  - Registration and recovery each show phone, SMS code and a new-password
    field; recovery labels make clear that the code verifies ownership.
  - Use `maxLength={4}`, `placeholder="····"` and an exact four-character
    submit guard; retain Persian-digit conversion.
  - Translate `weak_password` through the existing error mapper and preserve
    offline, rate-limit and blocked-account messaging.

- [ ] **Step 4: Re-run the route test and relevant frontend auth tests**

  Run: `npm test -- src/routes/-auth.test.tsx src/lib/api/auth-expiry.test.ts`

- [ ] **Step 5: Commit the completed frontend auth slice**

  ```bash
  git add src/routes/auth.tsx src/routes/-auth.test.tsx src/lib/api/auth.ts docs-fa/01-FRONTEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md
  git commit -m "feat: clarify registration and password recovery"
  ```

### Task 3: Remove Settings storage/device cards and all email contact output

**Files:**
- Modify: `src/routes/settings.tsx`
- Modify: `src/lib/legal-info.ts`
- Modify: `src/components/LegalContent.tsx`
- Modify: `scripts/build-landing.mjs`
- Modify: `docs-fa/01-FRONTEND.md`
- Create: `scripts/build-landing.test.mjs`

**Interfaces:**
- Settings no longer imports or calls device-list/storage-health APIs.
- `LEGAL_INFO` exposes Telegram, Instagram and update dates only.
- The built `/legal/` contact section contains only the two social links.

- [ ] **Step 1: Add a failing, controlled landing-build test**

  Run the real landing builder in a disposable output location and assert its
  legal HTML includes the Telegram/Instagram links but has neither
  an email link nor a public support-email value.

- [ ] **Step 2: Run the test and confirm it fails because the current builder renders an email link**

  Run: `node scripts/build-landing.test.mjs`

- [ ] **Step 3: Remove the requested settings and contact behavior**

  - Delete both cards and their now-unused imports, state, initial effects,
    helpers and API calls from Settings.
  - Do not touch `state/app.tsx`, device APIs or backend security policy.
  - Remove the email property, visible email row, build-time extractor and
    legal-page email paragraph. Preserve Telegram and Instagram.
  - Update the affected guide so legal contact information does not claim that
    email is mandatory.

- [ ] **Step 4: Run the landing test and a targeted build**

  Run: `node scripts/build-landing.test.mjs && npm run build:landing`

  Then run a repository search for the former support-email value and
  email-link markup in the relevant source and generated output.

  Expected: the test/build pass and the search returns no public contact email
  source or generated legal output.

- [ ] **Step 5: Commit the completed settings/contact slice**

  ```bash
  git add src/routes/settings.tsx src/lib/legal-info.ts src/components/LegalContent.tsx scripts/build-landing.mjs scripts/build-landing.test.mjs docs-fa/01-FRONTEND.md
  git commit -m "feat: simplify settings and remove email contact"
  ```

### Task 4: Responsive, single-fetch admin experience

**Files:**
- Create: `backend/test/admin-page.test.ts`
- Modify: `backend/src/lib/admin-page.ts`
- Modify: `docs-fa/02-BACKEND.md`

**Interfaces:**
- A successful `GET /v1/admin/overview` produces the first visible dashboard;
  it is not immediately requested again by the page shell.
- All existing `/v1/admin/*` routes and user-management actions remain
  unchanged.

- [ ] **Step 1: Add a failing DOM-level admin test**

  Load `ADMIN_PAGE` in JSDOM with a mocked successful overview response, click
  the real login control, and assert `fetch` receives exactly one
  `/v1/admin/overview` call before a user opens another tab. Also assert the
  rendered overview shows the returned user total.

- [ ] **Step 2: Run the test and confirm it fails with two overview requests**

  Run: `cd backend && npm test -- admin-page.test.ts`

- [ ] **Step 3: Implement the responsive redesign and request reuse**

  - Add responsive mobile/desktop layout, semantic focus styles, skeletons,
    empty/error/retry states, readable status pills and a full-height mobile
    user dialog while keeping the endpoint contract and all actions intact.
  - Refactor `showPanel(overview)` and `renderOverview(overview)` so token
    validation and rendering share the first response. `loadOverview` remains
    the explicit refresh path.
  - Keep tab APIs lazy, do not add libraries or a second frontend bundle, and
    retain explicit confirmation for destructive actions.

- [ ] **Step 4: Re-run the DOM-level test and existing admin API suite**

  Run: `cd backend && npm test -- admin-page.test.ts admin.test.ts`

- [ ] **Step 5: Commit the completed admin slice**

  ```bash
  git add backend/src/lib/admin-page.ts backend/test/admin-page.test.ts docs-fa/02-BACKEND.md
  git commit -m "feat: improve responsive admin dashboard"
  ```

### Task 5: Synchronization and final verification

**Files:**
- Generated by command only: `supabase/functions/api/shared/`

- [ ] **Step 1: Synchronize backend source into the Edge function**

  Run: `npm run sync:edge`

- [ ] **Step 2: Run focused and full automated checks serially**

  Run:

  ```bash
  npm test -- --maxWorkers=1
  npm run lint -- src/routes/auth.tsx src/routes/settings.tsx src/components/LegalContent.tsx
  npm run build
  cd backend && npm test -- --maxWorkers=1 && npm run typecheck
  cd .. && npm run test:edge -- --maxWorkers=1
  ```

- [ ] **Step 3: Verify the real admin UI at both target sizes**

  Start the local backend, open `/admin` in a browser at a phone and desktop
  viewport, authenticate with the development token, and confirm the first
  dashboard load makes one overview request. Check keyboard focus, tabs,
  search, user details, payments, discounts, empty/error states, and the
  mobile dialog.

- [ ] **Step 4: Inspect the final diff and run the UI detector**

  Run:

  ```bash
  git diff HEAD~4..HEAD --check
  node C:\\Users\\User\\.agents\\skills\\impeccable\\scripts\\detect.mjs --json backend/src/lib/admin-page.ts src/routes/auth.tsx src/routes/settings.tsx src/components/LegalContent.tsx
  git status --short
  ```
