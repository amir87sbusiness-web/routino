# Routino — single project guide
Updated 2026-09-07. Read this, then only relevant source files; do not re-analyze the repo. Explain in plain Persian. This replaces the old project documentation.

## Rules
- Keep changes narrow; check git status and preserve unrelated edits.
- Windows worktree cleanup: detach dependency junctions without traversing them before recursive deletion.
- Production has real users. Never delete/reset their data for tests or print secrets.
- Distinguish local tests, deployed code, applied SQL and real SMS/bank/device evidence.
- Authorization persists across turns. Read-only audits do not authorize migrations, cleanup or real provider calls.
- Canonical logic is backend/src/. Run npm run sync:edge after changes.
- Manually mirror backend/src/routes/ changes into supabase/functions/api/routes/.
- Never hand-edit generated shared/, src/routeTree.gen.ts, dist/ or www/.
- src/lib/phone.ts and backend/src/lib/phone.ts must stay byte-identical.
- High risk: src/lib/db/ and backend/src/services/payment-flow.ts.
- Keep this guide current; do not add more project documentation files.

## Source map
- UI: src/routes/ (TanStack file routing), src/routes/__root.tsx, src/components/AppShell.tsx; preserve Outlet. No Next.js pages/layout conventions.
- Local state: AppProvider, src/lib/db/{local,persist,hydrate,diff,migrate,vault}.ts; product logic src/lib/logic.ts.
- Access/API: src/lib/access-state.ts, src/lib/api/; sync client src/lib/sync/engine.ts.
- Backend sync: backend/src/services/{sync,sync-record-validation,task-month-archive,user-activity}.ts.
- Auth: backend/src/services/{otp,password,tokens,login-throttle,admin-auth}.ts.
- Money: backend/src/services/{payment-flow,pricing,entitlement,provider-capacity}.ts; result HTML backend/src/lib/pay-result-page.ts.
- Admin: backend/src/services/admin*.ts, backend/src/routes/admin*.ts.
- DB: backend/src/db/{schema,ddl,client}.ts; supabase/migrations/ and supabase/manual-production/.
- Server: backend/src/app.ts (Fastify); supabase/functions/api/ (production Hono).
- Routing/hosting: cloudflare/api-worker.js, functions/v1/[[path]].js, vite.config.ts.
- Landing: landing/index.template.html, scripts/build-landing.mjs; legal copy src/lib/legal-text.json.
- Native: capacitor.config.ts, Android/iOS directories; scripts/build-android-release.mjs.
- Icons: scripts/generate-icons.mjs (npm run icons); theme rendering src/components/ui.tsx.
- Tests: beside frontend sources, backend/test/, supabase/tests/.

## Commands and deployment
- Dev: npm run dev (:5173), npm --prefix backend run dev (:3000; /admin).
- Frontend: npm test; npm run build (includes landing).
- Backend: npm --prefix backend run typecheck; npm --prefix backend test -- --maxWorkers=1.
- Backend changes: npm run sync:edge then npm run test:edge (includes generated parity).
- DDL generation: node scripts/gen-setup-sql.mjs. Never use setup.sql or db:push as a production migration.
- Native: npm run android:release; npm run cap:sync. Preserve signing keys; PWA SW disabled on mobile.
- Project: axychfrteevhfdhgvfuv. Verify target before mutations.
- Deploy API: npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
- Download current API first: supabase functions download api --use-api --workdir <isolated-directory> with explicit project ref.
- API-only deployment does not publish Cloudflare Pages or APK. Inspect full artifact diff before release.
- App https://routino.me/app/; API https://api.routino.me; /health/ready and /v1/plans are read-only canaries.
- Web uses relative /v1 through Pages proxy; missing proxy yields SPA HTML instead of JSON.
- Mobile uses CapacitorHttp; deep link routino://pay/result. ANDROID_DOWNLOAD_URL overrides the signed APK in landing/downloads/; build-landing copies it to /downloads/ outside PWA precache.
- Production provider is ZarinPal/Kavenegar; fake PSP/console SMS only for local tests.
- Before production SQL: usable backup plus isolated restore/precheck. Never guess migration application from local files.

## Data contracts
- AppProvider holds one Db. Immutable changes -> diffDb/applyChanges -> Dexie dirty rows/tombstones.
- Product update(fn) requires active trial/paid; expired remains readable. Server none -> activation.
- Sticky tampered clears only with authoritative entitlement/payment; default category updatedAt:0 is intentional.
- Cursor lives in IndexedDB syncMeta with records, never localStorage. Skip syncMeta in dirty-table walkers.
- After remote hydrate rebase lastPersisted before setDb, preventing every row becoming dirty.
- Auth JWT stateless (default30days); no refresh polling, device tracking, revoke or block controls.
- Boot one exchange; edits batch; foreground pulls remote changes. No idle periodic sync.
- Sync v2 pushes then pulls from initial cursor. logs map to habitMonths; internal taskMonths expands losslessly.
- Newer live task wins over archive. Preserve UTF-8 byte/body/batch bounds, outbox, tombstones and clock clamp.
- Quota rejection keeps that version dirty:2 until retryAt; unknown DB errors remain errors.
- Row cap50,000; annual positive JSON growth10MiB/365days, not lifetime cap. Shrink/delete do not refund budget.
- Reset preserves dirty/outbox rows; old cursor below gc_seq triggers safe full resync.
- Task compaction only completed tasks after month end+7days and edit age+7days, chunks<=32/96KiB expanded.
- Retention requires proven trial/registration-only eligibility, no financial/admin history. Never run manual cleanup for tests.
- Export always available; import active-paid only. Content reset is not account deletion.

## Auth and payment invariants
- OTP TTL120s, cap5 attempts; consume conditionally with consumed_at IS NULL RETURNING.
- claimSendSlot locks IP then phone in one transaction; count in a separate SQL statement after locks.
- Same-statement advisory-lock CTE has stale READ COMMITTED snapshot under concurrency. Do not restore it.
- Durable phone/IP/global provider limits live in DB, not isolate memory.
- Password accepts canonical phone/lowercase username; generic errors and dummy hashing prevent enumeration.
- Client sends plan/code; server owns amount, entitlement and PSP result. Toman->Rial only in pricing.ts.
- Verify exact PSP amount before atomic grant. Preserve ambiguous/nonterminal payments for recovery.
- Checkout and Verify share PSP_PROVIDER_MAX_CONCURRENCY leases. Release in finally; no DB transaction over network.
- Callback/poll/recovery obey nextVerifyAt. Known pending callback keeps payment ID for app polling.
- Unbound Authority callback retains original URL: max3 automatic retries at server delay, then manual link.
- Closing that rare unbound callback requires reopening original URL. Never bind unverified Authority.
- Grants remain idempotent; entitlement stacking atomic. Discounts count in-flight reservations, not just used_count.
- App opening reconciles bounded open payments; it is not an unrestricted recovery sweep.

## Cost changes and pending archive rollout
- Activity is now in exchange pull CTE, physical write at most once/Tehran day.
- Local1000-account/6000-exchange fixture:17000->11000 top-level SQL (-35.3%);1000empty exchanges:2000->1000.
- These are synthetic local SQL counts, not production capacity or billing guarantees.
- API dual reader supports archive v1/v2; compact writer migration NOT applied to production.
- Pending: supabase/manual-production/20260906_task_archive_v2.sql; generator scripts/gen-task-archive-v2-migration.mjs.
- Sequence: verified backup -> dual-reader API -> dedicated3-function migration -> postcheck/history. No old archive rewrite/new cron.
- Updated postcheck/restore SQL needs new expansion helper; do not run against unmigrated schema.
- v2 preserves missing/null/empty values and expanded checksum; reconstructs repeated fields.
- Writer keeps v1 when fresh v2 JSONB<2048bytes to avoid loss of TOAST compression.
- Nine synthetic shapes:0–20.9% physical archive saving;10k-task JSON -33.8% but equal physical space.
- After any v2 archive exists, do not roll back to a v1-only reader. Archive migration is separate from launch fixes.

## Verified release state — recheck next time
- Audit branch codex/reduce-sync-storage-cost, base06d8fec; cost/launch changes uncommitted.
- 2026-09-07: backend520 tests; Edge117passed/9opt-in skipped; real local PostgreSQL stress8passed, fake providers.
- Stress:1000sync+50login+20checkout; same OTP accepted once; same-phone slot once; Verifycapacity1 peak1.
- Twenty pending payments recovered to20grants/0leases; no extra Verify during backoff.
- APIv75 deployed and ACTIVE on2026-09-07; /health, /health/ready, /v1/plans and /app/ returned200; readiness db=up.
- Downloaded production source:45 files matched local source (normalized line endings), zero mismatches.
- Rollback source: C:/Users/User/AppData/Local/Temp/routino-api-before-launch-fixes-20260907.
- Runtime delta: routes/{payments,subscriptions,sync}.ts; shared/{lib/pay-result-page,services/otp,services/payment-flow}.ts.
- No schema/secret/cron/amount changes in this release; synthetic local tests do not touch real users.
- Logs: artifacts/launch-audit-2026-09-06/{auth-payment-fixed,backend-launch-fixes-final,edge-launch-fixes-final}.log.
- Scoped review found/fixed unbound-Authority retry loss; follow-up found no further important issue.
- Public health is not real OTP/bank/device proof; those launch smoke checks remain unverified here.
- Owner reported the launch smoke checks OK after APIv75; this is owner confirmation, not agent-observed bank evidence.
- Cleanup2026-09-07: removed20 unreferenced declarations/341 canonical lines across15 files; generated Edge copies refreshed. No behavior changes or SQL migrations. Preserve active SQL maintenance and Edge-only imports when auditing dead code.
- Cleanup validation: frontend326/backend516/Edge117 passed;13 optional tests skipped (local PostgreSQL/stress not enabled). Both TypeScript unused checks, web/landing build and independent deletion review passed. Logs: artifacts/dead-code-*-tests.log and dead-code-build.log.
- Launch publication: APIv76 ACTIVE. Signed Android1.0 built and verified; APK SHA256 8a482f50218cb3dc9090821562d1f63e899c7031b32cbd1bfcc8c3f4533abb16. Web release includes /downloads/routino-android-1.0.apk with working CTA. Source is published through origin/main to existing Cloudflare build integration; verify live assets after push. Archive writer SQL remains unapplied.
