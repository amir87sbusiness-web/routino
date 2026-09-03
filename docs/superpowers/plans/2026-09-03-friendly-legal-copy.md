# Friendly Legal Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Routino's long legal and privacy copy with the approved short, friendly bilingual version and publish the resulting app and public legal page through Cloudflare Pages.

**Architecture:** `src/lib/legal-text.json` remains the single source consumed by both the React app and `scripts/build-landing.mjs`. Only the shared copy, its displayed date, one focused build test, and the matching frontend guide are changed; production publication is a normal fast-forward push of `main`, followed by live content and asset checks.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, static landing builder, GitHub-triggered Cloudflare Pages.

## Global Constraints

- Keep the approved friendly Persian and English meaning from `docs/superpowers/specs/2026-09-03-friendly-legal-copy-design.md`.
- Keep `enamadSeal`, contact handles, layout, backend, database, payment behavior, sync behavior, and generated `dist/`/`www/` sources unchanged.
- Name Cloudflare and Supabase and clearly cover internet/provider outages without claiming a legally absolute waiver.
- Publish without force push and do not deploy Supabase Edge, migrations, secrets, SMS, or payment code.

---

### Task 1: Lock and apply the shared legal copy

**Files:**
- Modify: `scripts/build-landing.test.mjs`
- Modify: `src/lib/legal-text.json`
- Modify: `src/lib/legal-info.ts`
- Modify: `docs-fa/01-FRONTEND.md`

**Interfaces:**
- Consumes: `legal-text.json` arrays of `{ title: [fa, en], paras: [[fa, en]] }` and `LEGAL_INFO.lastUpdatedFa/lastUpdatedEn`.
- Produces: five terms sections and five privacy sections used identically by the app and public legal-page builder.

- [ ] **Step 1: Write the failing landing-copy assertions**

Add these assertions after reading `legalHtml` in `scripts/build-landing.test.mjs`:

```js
assert.match(legalHtml, /Cloudflare/);
assert.match(legalHtml, /Supabase/);
assert.match(legalHtml, /اتفاق‌هایی که خارج از کنترل معقول ما هستند/);
assert.match(legalHtml, /اطلاعاتت را نمی‌فروشیم/);
assert.match(legalHtml, /۱۲ شهریور ۱۴۰۵/);
assert.equal(legalHtml.includes("فهرست دستگاه‌ها یا نشست قابل‌ابطال"), false);
```

- [ ] **Step 2: Run the focused test and confirm the old copy fails**

Run: `npx vitest run scripts/build-landing.test.mjs`

Expected: FAIL because the current legal page does not name Cloudflare/Supabase or contain the approved friendly wording and new date.

- [ ] **Step 3: Replace the shared copy and date**

Replace only `terms` and `privacy` in `src/lib/legal-text.json` with the exact bilingual text in the approved design. Preserve `enamadSeal` byte-for-byte. Set:

```ts
lastUpdatedFa: "۱۲ شهریور ۱۴۰۵",
lastUpdatedEn: "September 3, 2026",
```

Update the legal-section paragraph in `docs-fa/01-FRONTEND.md` to say the short bilingual text comes from `src/lib/legal-text.json`, is shared by the app and public page, and explicitly names Cloudflare/Supabase and the connectivity boundary.

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run scripts/build-landing.test.mjs`

Expected: PASS, including contact links, ENAMAD rendering, Cloudflare/Supabase wording, friendly Persian copy, and the September 3 date.

- [ ] **Step 5: Run production builds and static checks**

Run:

```powershell
npm run build
npx tsc --noEmit
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json src/lib/legal-text.json src/components/LegalContent.tsx landing/legal.template.html
git diff --check
```

Expected: both `/app/` and public landing/legal output build successfully, TypeScript exits 0, the design detector reports no actionable issue, and `git diff --check` exits 0.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- scripts/build-landing.test.mjs src/lib/legal-text.json src/lib/legal-info.ts docs-fa/01-FRONTEND.md
git commit -m "copy: simplify legal and privacy terms"
```

### Task 2: Publish and verify Cloudflare Pages

**Files:**
- Verify only: `dist/index.html`, `dist/legal/index.html`, `dist/app/index.html`, `dist/app/assets/*`

**Interfaces:**
- Consumes: committed `main`, GitHub remote `origin`, and the existing Cloudflare Pages Git integration.
- Produces: a fast-forward `origin/main` whose Pages deployment serves the new public legal page and the app bundle containing the same shared copy.

- [ ] **Step 1: Prove the push is fast-forward and review release scope**

Run:

```powershell
git fetch origin
git status --short
git rev-list --left-right --count origin/main...main
git log --oneline origin/main..main
```

Expected: no remote-only commits, only the already approved local logo/design/legal commits plus the legal-copy implementation, and no unrelated dirty source files included in the push.

- [ ] **Step 2: Push without force**

Run: `git push origin main`

Expected: `origin/main` advances by fast-forward. Do not retry with `--force` if rejected.

- [ ] **Step 3: Wait for the Git-triggered Pages build**

Poll `https://routino.me/legal/` at bounded intervals until it contains `۱۲ شهریور ۱۴۰۵`, `Cloudflare`, `Supabase`, and the approved outage sentence, or until the deployment window expires.

- [ ] **Step 4: Verify both live surfaces**

Verify:

```text
https://routino.me/legal/
https://routino.me/app/
```

The public page must show the new copy and date. The live app HTML must reference the same locally built production asset set (or its loaded JavaScript must contain the new legal sentence), establishing that the app release includes the shared source. Confirm `https://routino.me/` still links to `/legal/` and `/legal/#privacy`.

- [ ] **Step 5: Record final evidence**

Report the implementation commit, push result, local test/build results, live legal-page markers, live app asset evidence, and explicitly state that no Supabase Edge/database/payment deployment occurred.
