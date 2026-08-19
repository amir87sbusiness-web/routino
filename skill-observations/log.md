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
