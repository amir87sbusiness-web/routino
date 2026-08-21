# Launch Entitlement Lifecycle Design

## Scope

Prompt 4 changes only server-side trial issuance and the client's authoritative entitlement cache. It does not add activation UI, alter prices, replace custom authentication, change payment idempotency, or move product data out of Dexie and the generic `records` sync system.

## Chosen architecture

The server remains the only authority that can mint access. New OTP and admin-created accounts receive `none`. `startTrialOnce(db, userId, now)` runs in a database transaction, locks the existing user row, checks both the append-only `grants` ledger and the materialized `entitlements` row, and calls the existing `grantInterval` with exactly seven days only when both are empty. The Fastify and Edge HTTP routes are authenticated adapters around this canonical service.

The client stores `legacyEntitlementMigrationResolved` inside existing vault-local `meta`; it is never included in synced product records. A small resolver accepts a complete `ServerEntitlement`, the current vault DB, and an injected legacy-import function. Active or expired server answers win immediately. A server `none` imports one still-active unresolved legacy subscription once; a transient request failure preserves that local subscription and leaves the flag false for a later server response to retry. Once resolved, `none` clears the cached subscription and every successful server answer re-baselines clock-tamper state.

`loginAs` distinguishes omitted from explicit null using an `undefined` check. Production login always supplies the authoritative result. The offline-only `SKIP_SMS` path explicitly passes the current local subscription to preserve it.

## Alternatives considered

1. An in-memory mutex was rejected because separate Fastify/Edge instances and two devices do not share memory.
2. A new trial-claim table or synced client flag was rejected because the existing user row, grant ledger, materialized entitlement and vault-local metadata already provide the required durable boundaries.
3. Treating server `none` as a permanent no-op was rejected because it would turn a bounded migration bridge into indefinite locally asserted access.

## Transaction and response contract

`startTrialOnce` returns `{ entitlement, started, reason? }`. A prior ledger row returns `previous_grant`; an orphan materialized entitlement returns `entitlement_exists`. Retries return the unchanged current entitlement. Locking the user row serializes all trial-start requests for that account before either eligibility check and before `grantInterval` writes the ledger.

## Error and clock behavior

Authentication failures keep existing middleware behavior. Import transport/server failures are temporary and do not resolve migration. Any successful import response is definitive even when `imported` is false. Explicit server `none` is authoritative only after migration is resolved or no usable legacy plan exists. A successful server response always clears `meta.tampered` and sets `meta.lastSeen` from the device clock; the client never derives trial dates.

## Verification

Backend tests cover no grants at signup/admin creation, owner bootstrap preservation, first/retry/concurrent/device trial starts, all prior-grant sources, expired trials and orphan entitlements. Payment regression tests explicitly start a trial only in the stacking scenario. Client tests cover explicit null, temporary import failure, successful resolution, authoritative future `none`, no repeated import and clock recovery. Edge route tests mirror auth and subscription behavior, followed by generated-shared sync/parity, typecheck and targeted suites.
