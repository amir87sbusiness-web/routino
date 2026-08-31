# Admin OTP and Database Retention Design

**Date:** 2026-08-31

**Status:** Approved direction; awaiting written-spec review

## Objective

Replace the manual shared admin token with a simple phone-and-OTP login that
only the owner can use, keep the admin signed in securely for normal use, and
remove unbounded per-attempt authentication rows without weakening brute-force
protection. The release must preserve every real user's product, account,
payment, grant, entitlement, discount redemption, and feedback data.

## Scope and invariants

- The only permitted admin phone is the owner-provided number configured during
  release, normalized server-side to the same canonical Iranian format used
  elsewhere. Its literal value is deliberately absent from source and docs.
- The permitted phone is stored only as the Supabase secret `ADMIN_PHONE`; it is
  not committed to source, embedded in the admin HTML, returned by an API, or
  stored in an application table.
- The admin types both phone and OTP. A wrong and correct phone receive the same
  public response shape and status. Only the secret-matching phone causes an SMS.
- Admin OTP state is namespaced from ordinary user OTP state. A user-login code
  cannot authenticate the admin panel, and an admin code cannot authenticate a
  user account.
- Successful admin login creates no database session row and stores no token in
  `localStorage` or `sessionStorage`.
- Existing user bearer-token behavior is unchanged. This work does not add
  device tracking, account blocking, device limits, or user-session revocation.
- `users`, `records`, `payments`, `grants`, `entitlements`, `discounts`,
  `redemptions`, `feedback`, and valid `otp_codes` are never deleted or rewritten
  by the cleanup migration.

## Admin login flow

### Requesting a code

The public admin page initially shows a phone input and an `ارسال کد` action.
It calls `POST /v1/admin/auth/otp/request` with `{ phone }`.

The server:

1. normalizes the submitted phone;
2. applies a per-IP aggregate request bucket before disclosing any result;
3. compares the canonical phone to `ADMIN_PHONE` without logging either value;
4. returns the same generic `202` response for permitted and unpermitted phones;
5. for the permitted phone only, claims the existing atomic OTP/SMS budget and
   sends the code through the configured production SMS provider.

The OTP ledger key is a server-side HMAC namespace such as
`admin:<opaque digest>`, not the plain admin phone. The provider receives the
actual secret phone only at the final send boundary. Existing per-minute,
per-hour, per-day, per-IP, and global SMS limits remain in force.

### Verifying a code

`POST /v1/admin/auth/otp/verify` accepts `{ phone, code }`. The route repeats
normalization and secret comparison, then atomically verifies and consumes the
admin-namespaced code. Wrong, expired, replayed, over-attempt, and wrong-phone
cases return a generic authentication error and never create a session.

On success the server emits:

- `routino_admin_session`: a signed, admin-only token in an `HttpOnly`, `Secure`,
  `SameSite=Strict`, `Path=/` cookie;
- `routino_admin_csrf`: a random `Secure`, `SameSite=Strict`, `Path=/` cookie
  readable by the panel only so mutating requests can echo it in an
  `x-admin-csrf` header.

The admin session is signed with a separate Supabase secret,
`ADMIN_SESSION_SECRET`, not the normal user JWT key or the old shared admin
token. Its subject is the constant admin role, not the phone number. The cookie
contains no phone or user record identifier.

### Session lifetime and logout

- Initial lifetime is 90 days.
- An authenticated request renews the cookie back to 90 days only when fewer
  than 30 days remain, avoiding a `Set-Cookie` header on every request.
- `GET /v1/admin/auth/session` lets the page determine whether it can show the
  panel immediately.
- `POST /v1/admin/auth/logout` clears both cookies.
- Closing and reopening the browser does not require another OTP while the
  cookie remains valid.
- An invalid or expired cookie returns `401`, clears stale cookies, and shows the
  login form without leaking internal verification details.

All existing `/v1/admin/*` data endpoints accept only the verified admin cookie.
The legacy `x-admin-token` header is rejected after cutover. State-changing admin
routes additionally require the matching CSRF header. The public `/admin` HTML
contains no privileged data.

## Low-growth login throttling

The append-only `login_attempts` table is replaced by
`auth_rate_limit_buckets`:

- one row represents an aggregate `(scope, opaque key, fixed window)` counter;
- identifiers and IP addresses are HMACed before storage;
- repeated failures in one window update one row with an atomic upsert rather
  than inserting one row per attempt;
- password-login semantics remain the same: per-identifier soft and hard limits,
  per-IP limits, successful-login reset, and no user enumeration;
- admin OTP request limiting uses only a per-IP bucket, so arbitrary phone
  guesses cannot create one database row per guessed phone;
- every bucket has `expires_at`; an hourly cron removes expired rows;
- the table has a primary key covering scope, key hash, and window start, plus a
  small expiry index used by cleanup.

The bucket key uses a server secret and never stores a plaintext phone,
username, or IP. It is operational state, not user history, and may be deleted
after expiry.

## Other database-retention decisions

### Remove

- `login_attempts`, its indexes, its Node purge timer, and its pg_cron job after
  the bucket implementation is live and verified.
- `admins`, which is unused by runtime code, only if a migration precheck proves
  it is empty. A nonempty table aborts the contract migration for manual review.

### Keep with existing bounded retention

- `otp_codes`: required for OTP correctness and SMS budgets; retain for 24 hours
  and verify the hourly purge job exists.
- sync tombstones: required for deletion correctness; retain the existing weekly
  watermark-aware purge.
- `auth_rate_limit_buckets`: retain only until `expires_at` and purge hourly.

### Keep permanently

- successful and ambiguous payments, grants, entitlements, discount redemptions,
  feedback, users, and product records. These are financial audit data, access
  authority, or user-authored history. No automatic deletion is introduced in
  this release.

Abandoned payment retention is intentionally deferred until a separate policy
can distinguish provider-unknown/recoverable attempts from records that are
provably safe to archive. Saving a small amount of storage is not worth losing a
real payment recovery trail.

## Environment contract

Production startup fails closed unless all of these are valid:

- `NODE_ENV=production` is explicit;
- `ADMIN_PHONE` is a valid configured Iranian mobile number;
- `ADMIN_SESSION_SECRET` is at least 32 random bytes;
- `PROXY_SECRET` is present and strong;
- existing production JWT, OTP, SMS, PSP, database, and public URL requirements
  remain satisfied.

The old `ADMIN_TOKEN` secret may remain temporarily in Supabase only for rollback
of the previous deployed version. New code never reads or accepts it. It is
removed from the live secret set only after the OTP release has been verified
and the rollback window has closed.

## Release architecture

Use an expand/deploy/contract sequence:

1. Verify the linked project identity and take a nonempty, checksum-recorded
   metadata/affected-table backup without printing credentials.
2. Record counts and invariants for all critical real-user tables.
3. Dry-run the expand migration locally: create `auth_rate_limit_buckets`, its
   index, and its purge job; do not drop anything.
4. Configure `ADMIN_PHONE` and `ADMIN_SESSION_SECRET` as production secrets
   without exposing their values.
5. Apply only the reviewed expand migration.
6. Deploy backend/Edge code that uses buckets and OTP-cookie admin auth while
   old tables still exist for rollback.
7. Verify readiness, ordinary user login/sync/payment read paths, raw-origin
   blocking, wrong-phone no-send behavior, and one owner-assisted real admin OTP.
8. Apply the contract migration: abort if `admins` is nonempty; unschedule the
   legacy login-attempt purge; drop `login_attempts` and the empty `admins` table.
9. Recheck critical-table counts, payment/grant invariants, admin access, and
   production Edge source parity.

No step may truncate, rewrite, re-key, or bulk-copy a real-user content or money
table. A failure before the contract migration rolls back by deploying the prior
Edge version; a failure after contract uses the validated backup only for the two
removed operational tables, never as a blind full-database restore.

## Tests and acceptance criteria

- Correct phone requests one SMS; wrong phone returns the same response and
  requests zero SMS messages.
- Admin OTP is exactly single-use, separate from user OTP, expires normally, and
  spends attempts atomically under concurrency.
- No response, log, cookie payload, HTML, or rate-limit row contains the admin
  phone.
- Session cookies have all required attributes, survive browser restart, renew
  inside the final 30 days, and are cleared on logout/expiry.
- Old `x-admin-token` calls return `401`; cookie-authenticated reads work; admin
  mutations without the CSRF header return `403`.
- Fifty failures for one identifier/window create one identifier bucket row, not
  fifty attempt rows; concurrent increments do not lose counts.
- Existing password-login soft/hard/IP behavior and no-enumeration behavior pass
  unchanged.
- The expand migration preserves every old table. The contract migration aborts
  on nonempty `admins` and otherwise removes only `login_attempts` and `admins`.
- Fixture users, records, paid payments, grants, entitlements, redemptions, and
  feedback have identical counts and values before and after both migrations.
- Fastify and Edge suites exercise the same auth contracts; canonical backend
  changes are synchronized only with `npm run sync:edge`.
- Full frontend/backend/Edge tests, typechecks, lint, production builds, browser
  mobile/desktop admin flows, and post-deploy bounded probes pass before release
  completion is claimed.
