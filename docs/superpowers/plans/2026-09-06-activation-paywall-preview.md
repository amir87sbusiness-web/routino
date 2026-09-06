# Activation Paywall Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one isolated, reviewable Persian activation/paywall preview without changing or connecting the current application.

**Architecture:** Create a single self-contained HTML preview under `docs/superpowers/previews/`. It uses static copies of the currently configured plan names and prices, local-only visual interactions, and no imports, API requests, application routes, storage writes, trial calls, or payment calls.

**Tech Stack:** Semantic HTML, self-contained CSS, minimal local-only JavaScript, Playwright CLI visual verification.

## Global Constraints

- Do not modify anything under `src/`, `backend/`, `supabase/`, `cloudflare/`, `public/`, `android/`, or `ios/`.
- Do not add a route, import, API call, navigation target, storage write, trial call, payment call, or deployment configuration.
- Preserve the current Routino visual identity: Vazirmatn, warm orange primary, rounded surfaces, light and dark themes.
- Show the current static plan facts only: one month 59,000 Toman; three months 149,000 Toman; one year 449,000 Toman.
- The primary visual action is «شروع ۷ روز رایگان»; it must remain a disconnected preview control.
- The page must work at 360px mobile width and a compact desktop viewport without horizontal overflow.

---

### Task 1: Standalone activation/paywall preview

**Files:**
- Create: `docs/superpowers/previews/activation-paywall.html`
- Test: visual inspection only; no production test file is appropriate for a disconnected static artifact

**Interfaces:**
- Consumes: existing Routino colors and the static plan facts listed in Global Constraints
- Produces: one standalone HTML file that can be opened locally for visual approval

- [ ] **Step 1: Establish the isolation baseline**

Run:

```powershell
git status --short
git diff --name-only
```

Expected: the only pre-existing uncommitted file is `skill-observations/log.md`; no application file is changed by this task.

- [ ] **Step 2: Create the standalone preview**

Create `docs/superpowers/previews/activation-paywall.html` with:

- `lang="fa" dir="rtl"` and mobile viewport metadata
- a self-contained warm light/dark visual system using CSS custom properties
- an accessible top brand mark and single conversion-focused headline
- three concise benefit rows using consistent authored SVG icons
- three compact plan choices with the one-year plan visually recommended
- a sticky-safe primary CTA labelled «شروع ۷ روز رایگان»
- a secondary text control labelled «خرید مستقیم اشتراک»
- local-only plan selection and theme-preview buttons; all action controls must show «نسخه نمایشی — هنوز به برنامه وصل نیست» and must not navigate or send a request
- visible keyboard focus, reduced-motion support, styled selection and scrollbar, and no horizontal overflow

- [ ] **Step 3: Prove the preview has no application connection**

Run:

```powershell
rg -n "fetch\(|XMLHttpRequest|axios|/v1/|startTrial|localStorage|sessionStorage|location\.href|window\.open" docs/superpowers/previews/activation-paywall.html
git diff --name-only
```

Expected: the connection-pattern search returns no matches; the only new product artifact is the standalone preview HTML and no current application path appears in the diff.

- [ ] **Step 4: Render and inspect the page once at both sizes**

Serve the repository locally, open the preview with Playwright, and capture:

- mobile: 360×800
- compact desktop: 1100×850

Inspect both themes in the same bounded pass for content coverage, clipping, horizontal overflow, CTA visibility, contrast, keyboard focus, and honest disconnected-preview feedback. Apply one consolidated correction batch if needed, then perform at most one confirmation pass.

- [ ] **Step 5: Run the mechanical design detector**

Run:

```powershell
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json docs/superpowers/previews/activation-paywall.html
```

Expected: no unresolved blocking finding for the preview.

- [ ] **Step 6: Verify isolation and commit only the preview**

Run:

```powershell
git diff --check
git status --short
git add -- docs/superpowers/previews/activation-paywall.html
git commit -m "design: add isolated activation paywall preview"
```

Expected: the preview is committed; `skill-observations/log.md` remains uncommitted; no production application file is modified.
