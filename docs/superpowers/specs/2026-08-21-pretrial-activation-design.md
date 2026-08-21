# Pre-trial activation design

## Decision

The detailed Prompt 5 specification is the approved product design. A new authenticated account is not eligible for the app shell until its server entitlement is authoritative, its bounded legacy migration is resolved, and a real starter habit is prepared or already active.

## Access state

A pure access-state helper separates `unauthenticated`, `checking`, `pretrial`, `active`, `expired`, and `needs-online-verification`. Only authenticated, migration-resolved, authoritative `none` reaches `pretrial`; it routes to `/activation`. Expired access continues to the existing subscription path and never returns to pretrial.

## Activation

`/activation` is a standalone, short screen. It offers six curated existing presets or the existing custom-habit modal, and may use an existing active habit. The preset-to-draft conversion and default-category restoration move out of `habits.tsx` into a small shared helper.

The selected existing habit or draft is stored per local vault. On commit, the page validates it, calls the existing server trial endpoint, accepts only an active trial response, then makes one normal AppProvider mutation that caches the entitlement and appends the habit if needed. Transport failure leaves the selection intact and never creates local trial access. Reminder permission is requested only after the successful explicit commit.

## Verification

Pure tests cover access states and preset conversion. Route tests cover no-auto-start, invalid selection, failed and successful activation, existing-habit reuse, syncable mutation, and notification denial. Targeted frontend tests plus web/mobile builds provide final evidence.
