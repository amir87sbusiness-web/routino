# Admin Trial User Filter Design

## Goal

Restore the admin users view to its pre-retention behavior while adding a narrow server-side filter. Existing accounts remain visible until PostgreSQL actually deletes them. The retention deadline, trial duration, cleanup job, payments, sync, and the customer-facing app do not change.

## User experience

- The users section defaults to `همه کاربران` and lists every account that still exists, including registration-only, trial-only, subscribed, admin-granted, and payment-history accounts.
- A small selector beside the existing search offers `همه کاربران` and `فقط تریال‌ها`.
- `فقط تریال‌ها` includes both active and expired trial-only accounts while they still exist in the database.
- Search runs inside the selected scope. Changing the selector refreshes the users list once; it does not add polling.
- After an admin grant, the user remains in `همه کاربران` and leaves `فقط تریال‌ها` on the next list refresh.
- When cleanup deletes an account, it disappears naturally because there is no remaining `users` row.

## Server contract

`GET /v1/admin/users` accepts an optional `scope` query parameter:

- omitted or `all`: return all existing users, preserving the old default behavior.
- `trial`: return accounts that have at least one trial grant and have no non-trial grant, payment, or redemption history. Their entitlement may be active or expired but must not represent a non-trial plan.
- any other value: return the existing structured 400 validation response.

The filter is evaluated in PostgreSQL so it applies before the existing result limit and cannot miss users merely because the browser loaded only the first page. `GET /v1/admin/users/:id` again permits every existing user so rows from either scope can open the current detail/grant view.

## Safety and non-goals

- The seven-day trial remains unchanged.
- `routino_account_deletion_at`, the 30-day/preexisting grace rules, deletion batches, cron, and anonymous trial counter remain unchanged.
- No migration or database schema change is needed.
- Payment, discount, archive, quota counters, records, taskMonths, sync, login, and the main application UI are untouched.
- No deleted account is reconstructed or retained solely for the admin panel.

## Verification

- Backend tests prove default/all returns registration-only, active trial, expired trial, subscribed, and financial-history accounts.
- Backend tests prove `scope=trial` returns active and expired trial-only accounts, but excludes registration-only, payment-history, redemption, and non-trial-grant accounts.
- A grant test proves the granted user leaves the trial-only scope while remaining in all-users scope.
- Admin-page tests prove the selector defaults to all, sends the selected scope with search, and refreshes once when changed.
- Existing retention tests prove deletion deadlines and complete deletion remain unchanged.
- Backend changes are mirrored with `npm run sync:edge`, followed by backend, Edge, typecheck, lint, and build verification.
