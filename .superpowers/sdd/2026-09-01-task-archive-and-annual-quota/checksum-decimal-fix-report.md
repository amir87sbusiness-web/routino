# Archive checksum decimal / collation fix

Date: 2026-09-02 (local-only)

## Scope

This residual fix only changes the permanent `taskMonths` v1 decoder's numeric
checksum serialization and makes task-id archive ordering explicitly C/byte
ordered. No deploy, production database operation, migration application,
cron run, secret, payment, or live account action was performed.

## RED

`cd backend && npx vitest run test/task-compaction.test.ts -t "PostgreSQL decimal numeric text" --maxWorkers=1`

Before the implementation: 1 failed / 30 skipped. The test inserted three
valid completed quantity tasks, invoked the real `routino_compact_task_months`,
then called real `pullRecords`. PostgreSQL's archive contained `1e-7` and
`1e-10` as plain jsonb decimals; the old runtime recomputed them with
`JSON.stringify` exponent tokens and threw `invalid_task_month_archive` from
the checksum verification path.

## GREEN

`postgresJsonbNumber` starts from `JSON.stringify`'s canonical finite-number
token. Only exponent notation is transformed: it joins the existing mantissa
digits and moves the decimal point by the parsed exponent, padding with zeroes
as needed. It performs no floating-point arithmetic or custom rounding, keeps
the TextEncoder-only MD5 implementation, and rejects non-finite input.

Examples covered by codec tests:

- `0` and `-0` -> `0`
- `1.125` -> `1.125`
- `1e-7` -> `0.0000001`; `-1e-7` -> `-0.0000001`
- `Number.MIN_VALUE` (`5e-324`) -> `0.` + 323 zeroes + `5`
- maximum validated task value `1e9` -> `1000000000`
- `1.2e+21` -> `1200000000000000000000` and its negative counterpart

The real compactor/pull test now asserts the archive id order, exact archived
timestamps and quantity payloads, and a non-error cursor advance. Its IDs
`Z-decimal`, `a-small`, and `b-tiny` exercise the C/JavaScript byte ordering
that can differ from a locale collation.

## Archive ordering

Canonical DDL, the task-compactor migration, and generated setup SQL now use
`COLLATE "C"` for source selection that defines chunks, item-array aggregation,
archive-id/checksum construction, and checksum re-verification. The manual
restore script uses the same ordering for its independently reconstructed
archive id and checksum. A static test asserts all three sources carry these
explicit clauses.

## Verification

- Focused backend codec/compactor/sync/quota/launch-DDL/parity: 6 files, 157
  tests passed (`--maxWorkers=1`).
- Edge sync: 1 file, 15 tests passed (`--maxWorkers=1`).
- Full backend suite: 36 files, 429 tests passed in 64.31s (`--maxWorkers=1`).
- Full Edge suite (including quota): 11 files, 114 tests passed in 109.58s
  (`--maxWorkers=1`). The quota file itself completed 7 tests in 91.88s.
- `npm run sync:edge` copied 28 files; `node scripts/gen-setup-sql.mjs`
  regenerated `supabase/setup.sql`.
- Root `npx tsc --noEmit`; backend `npm run typecheck`; backend `npm run build`;
  root `npm run build`; and `git diff --check` passed.
