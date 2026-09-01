# Routino Lossless Task Archive and Annual Growth Quota Design

**Date:** 2026-09-01

**Status:** Approved design; awaiting written-spec review
**Scope:** Reduce long-term task row and byte growth without changing the client data model, losing history, increasing normal request count, or risking live user data.

## Objectives

- Preserve every user-authored task, journal entry, habit fact, and its original meaning for years.
- Keep yearly, monthly, search, export, offline, and multi-device behavior unchanged.
- Reduce old completed-task row pressure and repeated JSON structure in PostgreSQL.
- Enforce a hard 10 MiB positive-growth allowance per account-owned 365-day period.
- Add no polling, no new client request, no new service, and no append-only usage ledger.
- Roll out through an archive-aware compatibility release, verified backup, bounded canary, and reversible stages.

## Non-goals

- No summarization, deletion, truncation, or lossy transformation of product history.
- No compaction of incomplete tasks, journals, timer sessions, or habit history in this release.
- No client protocol-version change and no requirement to upgrade installed PWAs or Android clients before reading existing history.
- No R2/object-storage dependency, compression microservice, realtime connection, or background Edge invocation.
- No change to payments, subscriptions, authentication, admin access, task UX, or chart formulas.

## Architecture decision

Use a transparent, server-only `taskMonths` archive representation inside the existing sync-record store.

Clients continue to upload and consume ordinary `tasks`. The server accepts only ordinary task writes from clients. During pull, archive-aware server code expands internal `taskMonths` rows into the exact ordinary task envelopes expected by every existing client. Raw archive rows are never exposed through the API.

This keeps IndexedDB and all UI code unchanged. A yearly chart still reads the same individual task objects from IndexedDB; it does not query or understand archives.

The archive is structural compaction, not lossy compression. PostgreSQL may additionally TOAST-compress the compact JSONB naturally. Routino will not manually gzip application rows, avoiding CPU cost, binary corruption handling, and a second storage format.

## Archive eligibility

A task is eligible only when all of the following are true:

- it is a live, completed task;
- its task month ended at least seven days ago;
- its last modification is at least seven days old;
- it is still stored as an ordinary `tasks` record;
- it is not already represented by a verified archive item.

Incomplete tasks always stay granular, regardless of age. Recent or recently edited completed tasks remain granular until the safety delay passes.

The seven-day delay reduces races with offline devices while still compacting a completed calendar month soon after it becomes cold.

## Archive format and invariants

Each internal archive row is immutable and contains:

- format version `v: 1`;
- owner-bound calendar month;
- deterministic chunk number;
- a bounded list of compact task tuples;
- for every tuple: original task id, original `updatedAt`, and the complete validated task payload required to reconstruct the ordinary task record;
- item count and a deterministic semantic checksum for verification.

The archive id is derived from owner, month, version, and chunk. Creation is idempotent: retrying the same compaction cannot create a second logical archive.

Chunks are bounded by both expanded record count and expanded UTF-8 response size. One archive row must always fit by itself inside the pull response budget after expansion. A target chunk is deliberately smaller than the global response ceiling so normal pagination remains predictable.

Archive version 1 is permanent read compatibility. Future encodings may add version 2, but must retain the version 1 decoder until every version 1 row has been transactionally re-encoded and verified. Existing archives are never silently reinterpreted under a changed schema.

## Read and sync behavior

The pull query remains cursor-ordered. Before calculating the final response page, the server expands any internal archive candidate into ordinary `tasks` records and measures the serialized expanded envelopes.

- The response byte cap is enforced against expanded API bytes, not compact database bytes.
- `cursor` advances only past a database row whose complete expanded contents were returned.
- `hasMore` remains true when the next ordinary row or archive chunk does not fit.
- At least one valid bounded database row can progress a page, preventing a stuck cursor.
- Raw `taskMonths` rows are never included in API output or accepted from a client.

An existing device may receive archived copies of tasks it already has. Their original ids and `updatedAt` values are unchanged, so the existing last-write-wins merge is idempotent. A new device receives the same ordinary tasks and reconstructs complete local history.

## Editing or deleting an archived task

Archives stay immutable. If a user later edits or deletes an archived task, the client sends the normal individual `tasks` record or tombstone with a newer `updatedAt`.

The server stores that normal row as a small override. A pull may contain the older archive version and the newer override; the existing last-write-wins rule selects the newer version. This avoids rewriting a whole month for one edit and preserves cross-device conflict behavior.

The compactor never archives an override while an older version of the same id is still present in an archive. This prevents duplicate archive ownership. Overrides remain granular in this release; they are rare and bounded by the existing account row cap.

## Compaction transaction

Compaction runs as a database-owned, bounded operation. It creates no Cloudflare request and no Edge Function invocation.

For one owner-month group, one transaction:

1. locks only the selected eligible source task rows;
2. validates every payload using the canonical task rules;
3. builds deterministic bounded archive chunks;
4. inserts archive rows with new sync sequence values;
5. expands the inserted rows inside the database-side verification path;
6. compares source and reconstructed id count, ids, timestamps, payloads, and semantic checksum;
7. deletes only the source rows proven equal;
8. updates exact lifetime byte/row counters and commits.

Any malformed source, count mismatch, checksum mismatch, conflict, timeout, or unexpected exception rolls back the entire owner-month transaction. No partly archived month is committed.

A small scheduled PostgreSQL job selects only a bounded amount of eligible work per run and exits immediately when no work exists. It resumes safely on the next schedule without a job-state/event table. Batch size and statement timeout are conservative so user sync traffic retains priority.

## Annual 10 MiB growth quota

The account receives exactly `10 * 1024 * 1024` bytes of positive stored-data growth in each account-owned 365-day period.

- Existing production data is grandfathered. At migration, current data remains untouched and annual usage starts at zero.
- Each account period starts at the migration time for an existing account and account creation time for a new account.
- When 365 days have elapsed, the next eligible write atomically opens a new period and resets used growth to zero.
- Inserts and positive byte deltas consume the allowance.
- Same-size or shrinking edits consume no additional allowance.
- Deletion does not refund previously consumed allowance, preventing write-delete recycling.
- Valid deletion remains allowed at the annual byte ceiling; the existing 50,000-row account cap and validation/rate controls still bound fabricated tombstones.
- Internal archive creation and deletion change the exact lifetime byte/row counters but consume zero annual user-growth allowance because they only re-encode already-counted user content.

Only a fixed set of database-owned fields records period start and used bytes. There is no per-write or per-day quota log. Annual accounting is atomic in the same transaction as the record mutation, so concurrent devices cannot overspend the remaining bytes.

The existing 128 MiB lifetime byte ceiling is removed because permanent history and a lifetime cap conflict. The exact non-negative lifetime byte counter remains for operations and auditing. The 50,000 cloud-row cap remains as a separate abuse bound; task archiving materially extends its useful lifetime.

When a write exceeds the annual allowance, only that record is rejected with the stable `account_quota_exceeded` code. Other valid records and the pull continue. The server handles both PGlite `constraint` and production postgres-js `constraint_name` error shapes. The client keeps rejected content durable locally and must not turn the rejection into an unbounded 500 retry loop.

## Simplicity and cost boundaries

- One existing sync exchange remains the only normal product-data request.
- No archive lookup is performed during normal push; ordinary overrides are appended through the current path.
- No client archive code, no new public endpoint, no queue, no object storage, and no archive cache are added.
- The scheduled compactor is database-local and bounded.
- Archives are immutable; a small edit never rewrites a month.
- Pull is incremental and byte-bounded; an unchanged archive is not resent after the cursor advances.
- Quota state is constant-size per account and produces no usage-history rows.

## Safe rollout for live data

### Stage 0: local proof only

- Add failing tests before implementation.
- Test fresh bootstrap, existing-schema compatibility, archive encode/decode, malformed rollback, idempotent retry, same-id override, deletion override, pagination, response-byte cap, and account isolation.
- Generate realistic multi-year fixtures and compare source versus reconstructed task ids, timestamps, and canonical payload hashes.
- Run frontend, backend, Edge, parity, typecheck, build, and migration tests. No stress test targets production.

### Stage 1: archive-aware code, no archive data

- Regenerate Edge shared files from canonical `backend/src` code.
- Deploy server code that can safely read/expand version 1 archives but leaves the scheduler disabled.
- Verify function-backed readiness, plans, authenticated test-account sync, old-client-compatible response shape, and bounded error behavior.
- This stage changes no existing product row and is the rollback-safe compatibility floor.

### Stage 2: additive schema and canary

- Take a non-empty, encrypted, timestamped backup of the affected `records`, sequence state, user counters, and quota fields; verify row counts and hashes without printing credentials or content.
- Dry-run the exact migration against a restored local copy.
- Apply only additive/check-constraint changes required to permit internal archives and annual counters.
- Compact one controlled test owner-month, verify server reconstruction and a fresh-device sync, then verify edit and delete overrides.

### Stage 3: bounded production compaction

- Enable the database schedule with conservative batch/timeout limits.
- After each initial batch, compare task/archive counts, semantic hashes, account counters, function errors, database load, response bytes, and sync latency.
- Stop the schedule automatically on any invariant failure. Existing committed groups remain readable because the archive-aware code was deployed first.
- Do not roll server code back below the archive-aware compatibility floor while archive rows exist.

### Stage 4: recovery proof

- Keep a tested inverse restore script that expands archives back into ordinary task rows with original ids, timestamps, and payloads.
- Test the inverse path against a backup copy before declaring the rollout complete.
- Retain the pre-compaction backup according to the production recovery policy.

## Test matrix

### Losslessness and years of history

- Empty, one-task, maximum-size task, Persian/emoji text, and many-chunk months round-trip byte-semantically.
- Five- and twenty-year fixtures reconstruct every task exactly and retain chronological chart inputs.
- A yearly chart/search/export fixture produces identical results before and after server compaction.
- Unknown archive versions fail closed without advancing the cursor.

### Concurrency and failure

- Two devices edit different archived tasks and converge.
- Two devices edit the same archived task and converge by timestamp.
- Edit/delete races during compaction either remain granular or become a newer override; no update is lost.
- Crash after archive insert, verification failure, statement timeout, and duplicate job execution leave a fully valid state.
- Account A can never read, compact, checksum, or affect account B.

### Quota

- Exactly 10 MiB positive growth succeeds and the next byte is rejected.
- Concurrent writes cannot cross the ceiling.
- Shrinking updates and valid deletions work at the ceiling.
- Delete/recreate cycles do not refund usage.
- Period reset occurs once after 365 days and is race-safe.
- Existing data is grandfathered and remains readable.
- Compaction changes physical/lifetime counters but consumes no annual allowance.
- Native PGlite and postgres-js error metadata produce the same bounded rejection.

### Performance and cost

- Report database rows and indexed bytes per active user-year before and after compaction.
- Report expanded sync response bytes and number of pages for a fresh five-year account.
- Verify normal idle use adds zero requests and normal edit sync remains one exchange.
- Verify the scheduler's empty run, bounded batch, lock duration, and statement timeout do not delay foreground sync materially.

## Release gates

- No production migration before a verified backup, restored dry-run, and explicit deploy approval.
- No source task row is deleted unless the same transaction proves exact reconstruction.
- No archive row is created from malformed or ambiguous source data.
- No raw archive kind reaches any client.
- No claim of success without fresh local evidence and separate production canary evidence.
- `backend/src` remains canonical; generated Edge shared files are updated only with `npm run sync:edge`, followed by `npm run test:edge`.

## Success criteria

- Users see no behavior or data-format change in the app or web client.
- Complete task history remains available offline after synchronization, including yearly charts.
- Old completed tasks occupy materially fewer PostgreSQL rows and fewer repeated JSON bytes.
- Normal request count does not increase.
- Annual account growth is atomically capped at 10 MiB without an append-only accounting table.
- Migration, compaction, retry, rollback, and inverse restoration cannot silently lose or reinterpret real-user data.
