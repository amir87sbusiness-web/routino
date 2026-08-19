# Admin, Auth, Settings and Contact Design

## Goal

Make Routino's admin panel fast and pleasant on both phone and desktop, make
SMS authentication consistently four-digit with clear registration and password
recovery paths, remove the two requested Settings cards, and remove the
support email from user-facing product surfaces.

## Scope and boundaries

- The user-facing Settings cards titled `امنیت نگهداری روی این دستگاه` and
  `دستگاه‌های حساب` are removed completely, including their initial device-list
  and storage-health requests.
- Device revocation, the frequent lightweight security ping, device limits and
  all admin device controls remain. Removing a Settings card must not weaken
  account-security enforcement.
- The admin panel remains a self-contained, framework-free page served at
  `/admin`. That preserves Fastify/Supabase Edge parity and avoids introducing
  a second deployment or client bundle.
- Backend changes are made only in `backend/src/`, then copied with
  `npm run sync:edge`; generated Edge copies, `dist/`, `www/`, and
  `src/routeTree.gen.ts` are never edited by hand.
- Payment and local-persistence code are out of scope.

## Admin panel

The surface is an operational dashboard, not a marketing page. It will reuse
Routino's warm neutral palette, orange primary action, Vazirmatn typography,
rounded cards, clear success/destructive states and restrained motion.

- On phone, the header and tabs stay visible, tabs scroll horizontally, metric
  cards form a compact two-column grid, tables remain horizontally scrollable,
  and user detail opens as a full-height sheet.
- On desktop, metrics use a wider responsive grid, tables have stronger column
  hierarchy, and the user sheet remains constrained and readable.
- Loading skeletons reserve the final card/table geometry. Empty, failed and
  destructive-action states explain what happened and expose a retry action
  where safe.
- A successful initial `/overview` response both authenticates the admin token
  and renders the overview. The old second `/overview` request is removed.
  Other tabs retain lazy loading and are fetched only when opened.
- Existing data and actions stay intact: overview, user search/detail,
  password provisioning, grants, blocking, device policy, payments and
  discounts.

## SMS, registration and password recovery

- `generateCode` produces exactly four numeric characters and the client OTP
  input accepts exactly four digits, with four visual slots.
- The server keeps accepting a valid in-flight six-digit OTP during the
  deployment transition, but newly generated messages are four digits. The
  native and web client always submit exactly four newly entered digits.
- Because a four-digit space is smaller, verification attempts are capped at
  three for every environment; rate limiting, hash peppering, expiry, atomic
  attempt claims and newest-code-only behaviour remain in force.
- The password screen replaces the long SMS sentence with two equal, explicit
  actions: `ثبت‌نام` and `فراموشی رمز عبور`.
- Registration flow: phone -> four-digit SMS -> choose a password -> sign in
  and receive the existing server-side trial when the account is new.
- Recovery flow: phone -> four-digit SMS -> choose a new password -> sign in.
  A verified SMS is the proof for this one recovery operation; the server
  changes the password before issuing the response and revokes every other
  device session while preserving the just-verified device.
- Neither path reveals whether a phone already has an account. Password rules
  and Persian error translations remain shared with the ordinary password
  flow.

## Contact removal

- Remove `amir.templates@gmail.com`, its `mailto:` link and the email label
  from the in-app legal/contact component.
- Remove the email property and its landing-page build-time extraction and
  rendering. The legal page keeps Telegram and Instagram contact methods.
- Update the affected Persian guides so they no longer say that an email is a
  required legal-information field. Infrastructure-only ACME configuration is
  outside this request and is not a public support channel.

## Verification

- Start with failing backend tests for four-digit OTP generation, the
  three-attempt boundary and recovery revoking another device.
- Add client-level coverage for the four-digit control and the two explicit
  entry actions, using real route behaviour rather than source-text checks.
- Add a landing build test or controlled build assertion that the generated
  legal page has no email/mailer link while retaining both social contacts.
- Run targeted frontend/backend tests, backend typecheck, frontend lint and
  build, then `npm run sync:edge` and `npm run test:edge`.
- Verify `/admin` in a real browser at phone and desktop widths. Measure the
  first authenticated overview load before and after; the changed page must
  issue one overview request, not two.
