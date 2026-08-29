# Low-Usage Authentication and Sync Design

**Date:** 2026-08-30  
**Status:** Approved direction; implementation not started  
**Scope:** Remove device/account blocking infrastructure, replace stateful device sessions with a simple stateless login, and reduce normal Cloudflare/Supabase requests and database work without removing product features.

## Goals

- Allow an account to sign in on any number of devices without storing, listing, limiting, replacing, blocking, or revoking devices.
- Remove user blocking from runtime code and the admin surface.
- Keep product data local-first and immediately durable on the device.
- Make a typical cloud sync one function invocation rather than a push invocation followed by a pull invocation.
- Sync soon enough that a user can edit on a phone, close it, and open a laptop with the new data available.
- Stop periodic polling and send requests only on meaningful lifecycle or data events.
- Keep device preferences local and transfer only user content that is useful on another device.
- Preserve offline recovery, conflict handling, payment authority, subscription authority, and multi-account isolation.

## Non-goals

- No realtime socket or Supabase Realtime subscription. A permanent connection would add complexity and ongoing usage.
- No production deployment, live migration, or destructive database operation in this implementation session. Those remain separate, explicitly approved release steps.
- No change to payment amounts, payment verification, grants, subscriptions, OTP limits, or provider behavior.
- No broad UI redesign or unrelated cleanup.

## 1. Stateless Authentication

### Chosen model

Successful OTP/password authentication issues one signed access JWT valid for 30 days. The JWT contains the account subject and standard issuance/expiry claims; it contains no device identifier. The client stores only this token and its derived expiry/account identity.

There is no refresh token, refresh endpoint, device registration, installation key, device list, device replacement policy, or per-request device lookup. Signing out clears the token and account-local client state on that installation only. At expiry, the user signs in again.

### Removed behavior and storage

- Remove the `devices` and `device_security_events` runtime models, services, routes, admin output, and UI.
- Remove `users.blocked`, `users.max_active_devices`, `users.device_switches_used`, and `users.device_switch_reset_at` from runtime models and generated setup SQL.
- Remove user block/unblock admin actions and blocked-login branches.
- Remove device ping/list/revoke APIs and all client calls to them.
- Remove refresh-token rotation, refresh-token persistence, logout revocation, and password-change revocation.
- Remove installation metadata collection (`installationKey`, platform, browser, and OS) from auth requests.
- Protected middleware validates the JWT signature, expiry, and subject without a database read for a device row.

### Explicit security trade-off

A token cannot be revoked before its 30-day expiry. Password change, password recovery, sign-out on another installation, and admin actions do not invalidate already issued tokens. This trade-off is accepted in exchange for no device/session storage and no routine session-validation requests.

Legacy locally stored refresh/device fields are ignored and removed during client token-store migration. An existing old access token may be used until its embedded expiry; after that the user signs in under the new 30-day model.

## 2. Data Classification

### Cloud-synced product content

Only content that is useful on another device is synchronized:

- categories
- habits
- habit logs
- tasks
- timer sessions
- journal entries

The existing cursor, tombstone, owner-binding, clock-skew clamp, last-write-wins, chunk-size, and account-isolation rules remain in force.

### Device-local state

All settings and operational state stay on the current installation and never enter a sync payload:

- language and calendar
- theme and brand color
- onboarding state
- journal reminder preference
- notification permission/intent
- completion sound and haptics
- local notification-center items
- auth token, cached entitlement, sync cursor, diagnostics, anti-clock-tamper metadata, celebrations, and reminder bookkeeping

The Settings features remain available; only their cloud propagation is removed. Existing remote `settings` records are ignored by new clients. The release migration may delete those obsolete rows after compatible code is deployed.

## 3. One-Invocation Sync Exchange

Add one authenticated endpoint, `POST /v1/sync/exchange`, that accepts:

- the caller's current cursor;
- zero or more dirty product records, bounded by the existing count/body limits;
- an `includeAccountState` flag used only for boot/login/payment recovery.

Within one function invocation the server:

1. validates and applies incoming records with the existing atomic sequence allocation and last-write-wins rules;
2. reads records after the caller's original cursor;
3. returns the next cursor, changed records, pagination/reset state, and accepted/rejected counts;
4. includes entitlement and payment-recovery work only when `includeAccountState` is true.

Ordinary edit/background exchanges set `includeAccountState: false`, avoiding repeated entitlement and stranded-payment queries. Boot, login, foreground after a long absence, and payment-result recovery may set it to true.

Large first syncs can require additional exchange pages. Normal incremental sync remains one invocation. The old push/pull implementation may remain only as a short-lived compatibility layer during release ordering; current client code uses exchange exclusively after rollout.

## 4. Sync Scheduling

### Immediate local durability

Every accepted product mutation is persisted to IndexedDB before it is eligible for cloud sync. The UI never waits for the network. Dirty rows remain retryable until the server accepts them.

### Ten-second batch window

The first dirty write starts a trailing 10-second timer. Further writes reset the timer, so a burst of edits becomes one exchange. When the timer fires, all currently dirty records are chunked and exchanged. No request is sent when there are no dirty rows unless a pull is explicitly required.

### Lifecycle triggers

- **Initial authenticated boot:** one exchange with account state, fetching remote changes and authoritative entitlement.
- **Successful sign-in on a new installation:** immediate exchange plus one bounded catch-up pull a few seconds later. This second request is login-only and covers the race where the previous device is finishing its background upload at the same time.
- **Visibility hidden / pagehide:** flush persisted dirty rows with authenticated `fetch(..., { keepalive: true })`, within the existing 64 KB request limit. This is best-effort because browsers do not guarantee arbitrary work during termination.
- **Native app background:** flush on Capacitor app-state transition using the native HTTP path.
- **Internet returns:** exchange only when dirty rows exist or a previous pull is known to have failed.
- **Foreground:** pull only if the last successful pull is stale or a previous sync failed; do not poll while continuously visible.

There is no one-minute security ping, ten-minute visible sync interval, refresh-token request, or always-on realtime connection.

### Close-race behavior

The normal path uploads within 10 seconds of the final edit. Closing or backgrounding overrides the timer and starts the flush immediately. If the OS kills the process before the request completes, IndexedDB keeps the dirty rows and the next boot/online event retries them. The design provides fast best-effort cross-device availability without falsely promising that a browser can guarantee network completion after a hard kill.

## 5. Correctness and Failure Handling

- A running exchange remains bound to the immutable expected account subject before transport and after any account switch.
- Push still precedes pull inside the exchange so local dirty edits cannot be overwritten by older remote data.
- The client never adopts a server cursor merely because its own rows were accepted; the exchange response must account for all rows after the caller's original cursor.
- Concurrent calls for one owner share one in-flight promise. A later owner waits until the earlier owner-bound operation stops.
- Accepted dirty flags are cleared only when the local row's timestamp still equals the sent timestamp.
- Permanent 4xx record rejection leaves those rows dirty, reports a rejected count, and does not block other chunks or the pull.
- Offline, timeout, and termination failures are silent/retryable and never erase local content.
- Tombstone reset/full-resync behavior remains unchanged.
- Payment recovery remains server-authoritative and runs only in account-state exchanges or explicit payment follow-up, not on every edit flush.

## 6. Database and Network Reduction

- No device/session row per installation.
- No device lookup/update on protected requests.
- No minute-level ping traffic.
- No refresh-token lookup/rotation traffic.
- No settings records or settings indexes/writes in the sync stream.
- One function invocation for a normal push-plus-pull exchange.
- No entitlement/payment-recovery queries for ordinary edit/background exchanges.
- No empty periodic requests while the app remains open.
- Payloads contain only dirty product rows and cursor/account-state flags; no device metadata or local preferences.

At two meaningful exchanges per daily active user, the 500,000 free monthly Edge Function invocations have an arithmetic ceiling near 8,300 DAU before safety margin and exceptional auth/payment/admin traffic. This is a model, not a production guarantee; dashboards remain the release-time source of truth.

## 7. Migration and Release Ordering

Implementation produces source code, tests, regenerated Edge shared files, and migration/setup SQL. It does not apply the migration or deploy anything.

A later approved release uses this order:

1. deploy compatibility-capable backend/auth and exchange endpoint;
2. deploy frontend/native builds using stateless tokens and exchange;
3. confirm new auth/sync traffic and error rates;
4. apply the reviewed destructive migration that drops obsolete device/security tables, user columns, cron cleanup, indexes, and old settings records;
5. remove any temporary compatibility endpoints in a later cleanup release if needed.

The migration must target the verified Routino Supabase project and requires a current backup and separate explicit approval.

## 8. Test and Acceptance Plan

### Authentication

- OTP and password login return a 30-day JWT with no device ID or refresh token.
- Unlimited parallel logins create no device/session rows.
- protected middleware accepts a valid token without querying a device row.
- expiry requires re-login; logout is local and idempotent.
- password change/recovery does not revoke other tokens.
- device routes and user-block routes/UI no longer exist.

### Data boundary

- every device-local setting change produces no dirty synced row and no network request;
- only categories, habits, logs, tasks, timer sessions, and journal entries appear in exchange payloads;
- legacy remote settings are ignored safely;
- export/import and local settings behavior remain intact.

### Scheduler

- multiple writes inside 10 seconds produce one exchange;
- the timer resets on each write;
- hidden/pagehide/native-background flush immediately;
- no dirty rows means no background/online request;
- boot performs one account-state exchange;
- new-installation login performs exactly the immediate exchange and one bounded catch-up;
- there is no minute or ten-minute polling.

### Sync correctness

- exchange preserves push-before-pull ordering, cursor safety, conflict resolution, tombstones, reset, chunking, account switching, and offline retry;
- rapid phone edit + immediate hide + laptop login returns the phone edit;
- a failed exit request leaves the row dirty and retries on the next opportunity;
- concurrent devices editing different and identical records converge deterministically.

### Budget and regression gates

- quota tests model the new request schedule and storage slope;
- backend, frontend, Edge parity, auth, sync, payment recovery, account isolation, build, lint, and typecheck suites pass;
- generated `supabase/functions/api/shared/` is produced only through `npm run sync:edge`;
- documentation is updated to remove old device/polling/refresh claims and state the 10-second lifecycle-driven contract.

## Acceptance Criteria

- Normal visible idle use sends zero periodic API requests.
- A burst of product edits is locally durable immediately and normally reaches the cloud within 10 seconds after the last edit.
- Closing/backgrounding starts an immediate best-effort authenticated flush.
- A newly signed-in device fetches current cloud content immediately and performs one bounded catch-up for the close/login race.
- Settings and device metadata never appear in cloud sync payloads.
- No product feature is removed other than the explicitly requested device management, device restrictions, and user/device blocking.
- No live deployment or destructive migration occurs without separate approval.
