# Skill Observations

---

### Observation 1: Launch documentation needs a live-status checkpoint

**Status:** OPEN
**Date:** 2026-08-18
**Session context:** Readiness audit before a production launch.
**Skill:** New skill candidate: launch-readiness audit
**Type:** internal
**Phase/Area:** Evidence collection

**Issue:** The deployment guide still described test SMS and a sandbox payment gateway as launch blockers, while the live secret fingerprints and public endpoints showed production SMS, a non-sandbox merchant, healthy API/database, required indexes, and scheduled cleanup jobs.

**Suggested improvement:** Add a final read-only live-environment checklist to launch audits: health endpoints, production-provider fingerprints, required database indexes/jobs, and the current branch's test/lint gates.

**Principle:** Static deployment notes are useful context, but launch approval must be based on current, independently verified production state.

### Observation 2: Inspect named reference artifacts before proposing copy direction

**Status:** OPEN
**Date:** 2026-08-18
**Session context:** Refining a launch landing page from a user-provided PDF reference.
**Skill:** brainstorming / impeccable clarify
**Type:** open-source
**Phase/Area:** Direction setting

**Issue:** A prose-only tone proposal became more detailed and technical than the user wanted. The named visual reference already encoded the desired hierarchy: one promise, a short introduction, and benefit-led feature sections.

**Suggested improvement:** When a user names an available reference artifact, inspect it before presenting copy or visual directions; derive hierarchy, density, and tone from the artifact, then ask only about unresolved product truth.

**Principle:** Concrete reference artifacts should shape the first proposal, not merely validate a direction chosen from an abstract brief.

### Observation 3: Separate security cadence from data-refresh cadence

**Status:** OPEN
**Date:** 2026-08-18
**Session context:** Reducing serverless and database usage without weakening rapid device revocation.
**Skill:** test-driven-development / pwa-development
**Type:** internal
**Phase/Area:** Architecture and performance

**Issue:** One periodic call fetched the full device overview and then refreshed entitlement every minute, coupling a high-frequency security requirement to two comparatively expensive reads.

**Suggested improvement:** For local-first apps, split periodic work by freshness need: keep a minimal authenticated security ping frequent, refresh entitlement on a longer TTL, and tighten only near expiry or after an explicit recovery event.

**Principle:** A fast security reaction does not require every related account datum to share the same polling interval.

### Observation 4: Policy windows need executable boundary tests

**Status:** OPEN
**Date:** 2026-08-18
**Session context:** Changing the allowed device-replacement window from 30 days to 15 days before launch.
**Skill:** test-driven-development / verification-before-completion
**Type:** internal
**Phase/Area:** Security policy consistency

**Issue:** User-facing documentation had been updated to 15 days while the server constants, admin counts, and account UI still enforced and displayed 30 days.

**Suggested improvement:** When changing a time-based policy, inventory the enforcement constant, API counters, admin UI, user UI, legal copy, and docs; add a boundary test that fails at the first day outside the new window before changing implementation.

**Principle:** A security policy is only changed when its executable boundary, reported counter, and user-facing promise all move together.

### Observation 5: Verify deployment identity through the live binding

**Status:** OPEN
**Date:** 2026-08-18
**Session context:** Deploying the Cloudflare Worker after the owner completed Wrangler login.
**Skill:** systematic-debugging / verification-before-completion
**Type:** internal
**Phase/Area:** Deployment reliability

**Issue:** Wrangler successfully deployed the service name in `wrangler.toml`, but `api.routino.me` continued running old code because its custom domain actually belonged to another Worker service.

**Suggested improvement:** Before production Worker deployment, query the account-level custom-domain binding and assert that its service name matches the committed Wrangler name; then verify a version-specific response header or body on the custom domain, not only on `workers.dev`.

**Principle:** A successful upload proves that code reached a Worker, not that the production hostname reached that code.

### Observation 6: Distinguish edge protection from fixed egress identity

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Diagnosing Zibal result 115 and designing a low-usage production payment path.
**Skill:** systematic-debugging / verification-before-completion
**Type:** internal
**Phase/Area:** Payment infrastructure

**Issue:** Both Supabase Edge and Cloudflare Worker improved reachability and protected the public API, but neither standard service provided the stable outbound IPv4 required by the payment provider's allowlist. The generic client error hid the provider result until live function logs were searched.

**Suggested improvement:** Payment launch checks should record the PSP result/message safely, verify whether every outbound dependency requires a fixed source IP, and test the actual production egress path before approving checkout. Treat ingress proxying, CDN security, and outbound identity as separate architecture decisions.

**Principle:** An edge front door can protect inbound traffic without giving server-to-server calls a stable outbound identity.

### Observation 7: Shorter OTPs need a complete security-contract update

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Changing a phone sign-in code from six digits to four digits while adding password recovery.
**Skill:** test-driven-development / systematic-debugging
**Type:** open-source
**Phase/Area:** Authentication policy

**Issue:** The visible input length, generator, verification-attempt budget, recovery workflow, provider-template assumption and product documentation can drift when an OTP length changes. Updating only a placeholder would leave either a confusing flow or a materially weaker brute-force boundary.

**Suggested improvement:** Treat an OTP-size change as a cross-boundary security policy change: test the generator and exact UI control, calculate and cap attempts for the smaller space, preserve a brief in-flight compatibility path, update provider-facing assumptions and test account-recovery session revocation.

**Principle:** A shorter credential is safe only when its entropy, rate limits, recovery authority and every user-facing representation change together.

### Observation 8: Focused checks need an explicit nested-worktree boundary

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Running focused landing and UI verification in a repository that contains a nested worktree.
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Test and lint command selection

**Issue:** Passing source paths to package scripts that already include a broad root caused test and lint discovery to include a nested worktree, producing unrelated failures and obscuring the requested files' result.

**Suggested improvement:** For focused checks, verify the package script's fixed arguments first. If it always scans the repository, invoke the underlying tool with explicit paths or configure an exclusion for nested worktrees; report broad-scan failures separately.

**Principle:** A command that accepts a path is not necessarily scoped to that path when its wrapper already supplies a broad discovery root.

### Observation 9: Bind background requests to an immutable account identity

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Integrating a multi-account background sync lifecycle with mutable session storage.
**Skill:** New skill candidate: owner-bound background work
**Type:** open-source
**Phase/Area:** Multi-account sync orchestration

**Issue:** A multi-request background job can start for one account while shared token storage changes before a later request, allowing later pages or batches to run under a different identity even when local storage is correctly isolated.

**Suggested improvement:** Bind each background job to the expected immutable account subject. Assert that subject immediately before transport and again after token refresh, and serialize account switching with any active job.

**Principle:** Local tenant isolation is incomplete unless every asynchronous server operation is bound to the same immutable tenant identity for its entire lifetime.

### Observation 10: Separate stored preference from effective OS capability

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Replacing automatic notification prompts with explicit permission UX and background reconciliation.
**Skill:** New skill candidate: permission-aware local features
**Type:** open-source
**Phase/Area:** Native permission state and settings UX

**Issue:** Treating a persisted feature toggle as proof that an OS permission is available makes Settings lie after permission revocation, while overwriting the preference on denial prevents the feature from recovering automatically when permission becomes available again.

**Suggested improvement:** Keep the user's persisted preference separate from the checked runtime permission. Display and execute the effective intersection, request permission only from an explicit action, and re-check capability on foreground without discarding intent.

**Principle:** A stored preference expresses user intent; effective availability is that intent intersected with current platform capability.

### Observation 11: One-time grants need dual-history checks under one durable lock

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Moving a first-use trial from automatic signup to an explicit once-per-account activation endpoint.
**Skill:** test-driven-development / systematic-debugging
**Type:** open-source
**Phase/Area:** Transactional eligibility and ledger integrity

**Issue:** Checking only the append-only grant ledger can accidentally mint access when a materialized entitlement exists without its expected history, while checking both outside a transaction lets concurrent devices pass the same eligibility decision.

**Suggested improvement:** For irreversible once-per-account benefits, lock a stable account row, inspect both immutable history and materialized current state, and write the benefit inside the same transaction. Test retries, concurrency, expired history, every prior source, and inconsistent materialization.

**Principle:** A once-only benefit is safe only when every durable representation of prior access is checked and the decision plus grant are serialized by one database lock.

### Observation 12: Migration bridges must distinguish transient from definitive failures

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Bounding a one-time migration from local-only subscription state to authoritative server entitlements.
**Skill:** test-driven-development / systematic-debugging
**Type:** open-source
**Phase/Area:** Legacy migration failure policy

**Issue:** Treating every import exception as retryable can preserve obsolete local authority forever after a deterministic rejection, while treating every 4xx as final can discard valid access during temporary rate limiting or request-timeout responses.

**Suggested improvement:** Classify offline, 5xx, 408, 425 and 429 as temporary; resolve non-retryable 4xx against the authoritative server result; and cover both branches with regression tests using server-issued time and immutable account ownership.

**Principle:** A bounded migration remains bounded only when temporary failures retry and definitive outcomes permanently return authority to the new source of truth.

### Observation 13: Server-authoritative activation must isolate post-commit device capabilities

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Adding an explicit first-habit activation flow that starts a server-authoritative trial before configuring reminder permission.
**Skill:** test-driven-development / systematic-debugging
**Type:** open-source
**Phase/Area:** Post-commit device capability handling

**Issue:** An OS capability prompt can fail after an irreversible server grant; allowing that exception to escape turns a completed activation into a misleading client failure or retry path.

**Suggested improvement:** Commit and cache the authoritative entitlement and domain state first, then make capability setup non-fatal with explicit denial and thrown-error regression tests.

**Principle:** Irreversible server decisions must never be rolled back or misrepresented by follow-up device configuration.

### Observation 14: Read-only bypasses must be capability-specific

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Converting the default application updater into a paid-access product mutation gate while preserving account and device operations.
**Skill:** test-driven-development / task-observer
**Type:** open-source
**Phase/Area:** Client mutation authorization

**Issue:** A generic system or forced updater recreates an unauditable escape hatch, while routing every operation through the paid gate breaks login, logout, entitlement refresh, notification preferences and destructive account-content reset.

**Suggested improvement:** Keep product mutation as the secure default and expose only narrow, named operations for each audited bypass. Exercise those capabilities under expired access in provider-level tests.

**Principle:** Authorization boundaries remain auditable only when every bypass declares the specific capability it needs.

### Observation 15: Calendar analytics tests must own their clock

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Verifying read-only history and analytics with a test fixture whose day keys were fixed to an earlier date.
**Skill:** systematic-debugging / test-driven-development
**Type:** open-source
**Phase/Area:** Deterministic time-based tests

**Issue:** Tests can build logs around a fixed reference day while production helpers still call the real current date, causing an otherwise unchanged formula suite to fail as soon as wall time moves beyond the fixture.

**Suggested improvement:** Freeze the test clock to the fixture's reference day whenever any function under test reads `Date.now()` or `todayKey()` implicitly, and restore real timers after the suite.

**Principle:** A time-based test is deterministic only when its data and its clock share the same explicit reference.

### Observation 16: Supplemental feedback must receive an accepted transition

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Adding non-blocking completion sound and haptics to a local-first application with a read-only product gate.
**Skill:** test-driven-development
**Type:** open-source
**Phase/Area:** Interaction side effects

**Issue:** Observing persisted state globally cannot distinguish a local click from hydration or remote synchronization, while running feedback before the mutation gate accepts a write makes blocked actions appear successful.

**Suggested improvement:** Model completion feedback as a pure transition decision that requires a direct source and an accepted mutation, then call the platform side effect only from the initiating interaction path.

**Principle:** Supplemental interaction effects need the same source and authorization context as the mutation they acknowledge.

### Observation 17: Launch evidence must identify the version it verifies

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Reconciling a living launch-readiness document with healthy production endpoints while launch changes still existed only in the working tree.
**Skill:** task-observer / verification-before-completion
**Type:** open-source
**Phase/Area:** Release verification and operational documentation

**Issue:** A live health check can prove that the currently deployed service is reachable without proving that pending schema, backend, or frontend changes are deployed. Mixing those facts turns evidence for an old release into an accidental readiness claim for a new one.

**Suggested improvement:** Record live service health, local suite results, deployment state, SQL application state, and physical-device validation as separate evidence classes with explicit dates and versions. Never let one substitute for another.

**Principle:** Release evidence is meaningful only when it names both what was verified and which version received that verification.

### Observation 18: Release verification must inspect built endpoint bindings

**Status:** OPEN
**Date:** 2026-08-21
**Session context:** Preparing a production release after source tests and mobile compilation passed while the native bundle still used a relative development API path.
**Skill:** verification-before-completion
**Type:** open-source
**Phase/Area:** Production build and release tagging

**Issue:** Unit tests, typechecks, and successful native compilation did not prove that the generated mobile bundle contained the production API origin. The misconfiguration was visible only in the built artifact, after the release tag had already been pushed.

**Suggested improvement:** Before tagging a release, inspect each platform's final bundle for its effective API/backend endpoint and forbidden development fallbacks. Make this a build-level regression test, then create the release tag only after that test passes.

**Principle:** A production build is not verified until its generated artifact proves where it will send real traffic.
