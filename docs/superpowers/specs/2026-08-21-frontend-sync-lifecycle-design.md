# Frontend Sync Lifecycle Design

## Scope

Wire the existing `syncNow(userId)` engine into `AppProvider` without changing Dexie, dirty rows, persistence diffs, merge rules, or the HTTP protocol.

## Design

- Resolve the sync owner from authenticated `userId`; legacy sessions recover it from the JWT subject rather than using a phone as a server identity.
- Trigger an immediate/coalesced sync on authenticated activation, verified boot, online, foreground, completed vault switch, and successful syncable IndexedDB persistence. A visible-app fallback runs every ten minutes; the existing sixty-second security check does not trigger data sync.
- Debounce post-persistence sync requests. Never call the network from `update()`.
- Replace broad `changed` with `remoteChanged`, set only by applied remote rows or reset storage rebuilding.
- Track in-memory mutation revision at every public `update()` call. After a remote write, wait for persistence, hydrate, and accept only when owner and revision still match. Retry twice without blocking; otherwise leave reconciliation pending for the next trigger.
- Bind each sync request to the expected JWT subject. If sign-in changes mid-run, stop before any later request can use the new account token.
- Mark sync-returned entitlement as checked. Preserve the current isolated `none` transition behavior for Prompt 4.

## Error handling

Offline failures remain silent and dirty rows stay queued. Permanent record rejection does not stop pull. A genuine 401 is routed through the existing session validation/revocation path; a local account-change abort is not treated as revocation.

## Verification

Engine tests cover push-only outcomes, remote rows, reset, tombstones, LWW and offline close/reopen. AppProvider tests cover triggers, persist-before-sync, debounce, entitlement marking, account switching and the local-edit-during-pull regression. Existing vault and persistence tests continue to cover A to B to A isolation.
