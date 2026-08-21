# Routino Read-only Paid Access Design

## Decision

Expired accounts stay authenticated, hydrated, navigable, exportable, and synchronized. They lose only new product-value mutations and product reminders. A successful server entitlement restores writes and reminders immediately.

## Access model

`accessState()` returns `unauthenticated`, `checking`, `pretrial`, `active-trial`, `active-paid`, `expired`, or `needs-online-verification`. Only unauthenticated and pretrial own redirects; expired renders the normal app with a persistent read-only notice. Tamper/session uncertainty renders the existing reconnect gate and never a purchase message.

## Mutation boundary

`AppProvider.update()` remains the product mutation API and returns `false` without invoking its updater unless access is active. A single AppShell modal handles blocked attempts and links to `/subscribe`.

The context exposes only narrow non-product operations: update visual/device preferences, apply authoritative entitlement, mark notifications read, submit feedback, sign out locally, and reset synchronized content. Trial activation uses one narrow authoritative commit that stores the returned trial and prepared habit atomically. Sync/hydration continue through their existing internal `setDb` paths.

## Reminders

Native and foreground product reminders are enabled only while writes are active. Lifecycle reminders remain enabled. Trial lifecycle emits one final-day event and one expiry event; paid behavior stays three-days/expiry. Copy states that data remains local and cloud-synced.

## Paywall and data operations

The existing checkout stays unchanged. Expired trial progress derives the exact window from `expiresAt - 7 days`; expired paid progress uses a recent window and never pretends to be a first trial. Metrics come only from local habits/logs and omit weak best-habit claims. Export stays available, import stays active-paid-only, and explicit reset means synchronized-account content erase with tombstones preserved for normal sync.

## Verification

Pure access/progress/reminder tests plus AppProvider integration tests cover active writes, expired blocked writes, allowed system actions, reactivation, sync continuity, and reminder restoration. Targeted route tests cover the centralized blocked-action UX and preserved history/navigation.
