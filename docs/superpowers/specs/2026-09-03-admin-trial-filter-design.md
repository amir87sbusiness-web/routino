# Restore Full Admin User Visibility Design

## Goal

Restore the admin users area to its original behavior: every account that still exists in `users` is visible and searchable, including registration-only accounts, active or expired Trial-only accounts, and subscribed accounts. The existing detail dialog and admin-grant workflow remain available for all of them. No filter, hidden-user rule, or visual redesign is added.

The Trial-account retention feature remains independent from admin visibility. Once PostgreSQL deletes an eligible account, it disappears naturally from the panel because its `users` row no longer exists.

## Admin behavior

- `GET /v1/admin/users` returns all existing users, ordered and limited exactly as before retention was introduced.
- Phone search applies to every existing user.
- `GET /v1/admin/users/:id` returns details for every existing user.
- The current user dialog, payment/grant history, password controls, and admin subscription grant remain unchanged.
- The anonymous `trial_starts` counter remains an overview metric but does not replace the ordinary user list.
- No selector, scope parameter, new request, polling, or visual change is introduced.

## Retention behavior preserved

- Trial duration remains seven days.
- The base deadline is `users.created_at + 30 days`; activity, login, and sync do not extend it.
- A still-active Trial defers deletion until its `trial_expires_at`, making the effective deadline the later of those two instants.
- Any non-Trial grant, admin grant, payment row of any status, redemption, used or referenced private discount, financial history, or structurally inconsistent state makes the account ineligible. Eligibility remains fail-closed.
- The cleanup function rechecks eligibility while holding the user-row lock, so a completed admin grant or purchase wins over cleanup.
- Cleanup remains small-batch, timeout-limited, atomic per transaction, idempotent, and compatible with archive records, quota counters, `records`, and `taskMonths`.
- The one-time grace period for pre-existing accounts and the deletion warning remain unchanged.

## Implementation boundary

Only the admin visibility regression is changed in application code and tests. The retention migration, dry-run SQL, cleanup function, cron SQL, payment flow, sync, archive, quota, customer UI, and database schema are not modified.

Backend source remains canonical under `backend/src/`; its generated Edge mirror is refreshed only with `npm run sync:edge`.

## Verification and release gates

- A test written before implementation proves the default user list includes registration-only, active-Trial, expired-Trial, subscribed, and payment-history accounts.
- Detail and grant tests prove an ordinary Trial-only user can be opened and granted an admin subscription.
- Search tests prove Trial-only and registration-only users remain discoverable.
- Existing retention tests continue to prove the 30-day deadline, active-Trial deferral, fail-closed payment/grant protection, purchase-versus-cleanup concurrency, cascaded deletion, archive/quota compatibility, token rejection, and fresh re-registration.
- Run frontend, backend, and Edge tests, frontend/backend typechecks, lint, build, Edge parity, and `git diff --check`.
- Before any future production mutation, take and verify a recoverable production backup and run the aggregate-only read-only dry-run. Report no personal identifiers. Every `selected_with_*` safety count must be zero.
- This change does not authorize a migration, cron installation/change, manual deletion, cleanup invocation, or any real-data deletion. Those actions require separate approval after the backup and dry-run report.
