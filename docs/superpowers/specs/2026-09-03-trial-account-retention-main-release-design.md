# Trial Account Retention Main Release Design

## Scope

Port only the trial-account retention feature onto the current `main`. Preserve the existing task archive, `taskMonths`, 10 MiB annual growth allowance, sync protocol, payment flow, and admin controls. The trial remains exactly seven days.

## Eligibility and deadlines

Deletion is allow-listed. A user is eligible only when the account has either never started a trial or has exactly one internally consistent seven-day trial grant and matching trial entitlement. The normal deadline is `greatest(created_at + 30 days, trial_expires_at when present)` and is never extended by login or activity.

The migration records one immutable deployment cutoff. Every user created before that cutoff receives a one-time floor of `deployment_cutoff + 30 days`. Users created at or after the cutoff use only the normal deadline. This guarantees existing users can receive the final-three-day warning before any cleanup can select them.

Any payment row, non-trial/admin/gift/transfer grant, redemption, used or referenced phone discount, non-trial entitlement, duplicate trial ledger, mismatch, or unknown state protects the account. Purchase and cleanup serialize on the user row and foreign keys; uncertainty always preserves the account.

## Cleanup and retained systems

PostgreSQL performs a small `FOR UPDATE SKIP LOCKED` batch with short lock and statement timeouts. The user deletion cascades through records, including internal `taskMonths`; existing record-delete accounting triggers keep quota counters consistent. Loose OTP, feedback, and a phone-specific discount are removed only after the user deletion succeeds. A discount is removable only when unused and unreferenced by any payment, redemption, or other database reference discovered by the migration contract.

The function is atomic and idempotent. The scheduled job runs once daily but the deployment floor means it cannot delete any pre-deploy account for 30 days. No manual production account deletion is part of the release.

## Auth, client, and admin

Existing auth, subscription, sync, and payment queries integrate account existence checks; no global per-request query is added. Tokens for purgeable accounts cannot outlive the effective deletion deadline. The client caches the deadline from existing responses and shows the existing-style warning only during the final three days, with export and purchase actions and no heartbeat or extra request.

Both trial-only and registration-only accounts are omitted from admin user lists/details. Financially protected, subscribed, and admin-granted accounts remain visible. Only the anonymous lifetime trial-start counter remains for trial-only usage, without phone, UUID, IP, or linkable hash.

## Release gates

Before database mutation: create and restore-verify a production backup; run the aggregate-only read-only dry-run; prove selected/protected overlap is zero; run full frontend/backend/Edge tests, typechecks, builds, parity, real PostgreSQL concurrency, and protected-population capacity tests.

Deploy incrementally: compatible Edge/frontend code, additive migration, postchecks, then the daily cron. Stop if any dry-run safety overlap is non-zero. Verify production health for login contract, sync, payment read paths, admin privacy/metric, and warning delivery without performing a real purchase or manually deleting user data.
