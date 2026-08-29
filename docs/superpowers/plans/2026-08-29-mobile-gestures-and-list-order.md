# Mobile Gestures and Completion Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make week paging and row swipes smooth on iPhone, reverse week paging in Persian, and animate completed or reopened items to their correct list section after a short pause.

**Architecture:** Keep persistence untouched and split the work into three focused layers: pure gesture/order contracts in `src/lib`, a ref-and-requestAnimationFrame pointer primitive plus an animated completion list in `src/components`, and narrow integrations in the existing week/task/habit views. Week paging uses a three-panel transform track; list motion uses a local display order and FLIP animation on wrapper elements.

**Tech Stack:** React 19, TypeScript, Pointer Events, requestAnimationFrame, Web Animations API, Vitest/jsdom, Tailwind CSS 4, Playwright CLI.

## Global Constraints

- Persian paging is right drag = next week and left drag = previous week; English is the reverse.
- Row transforms and hint opacity must not update React state during pointer movement.
- Completion reorder delay is 450 ms and movement duration is 260 ms.
- Newly completed items move below every previously completed item; reopened items move to the end of the incomplete section.
- Repeated toggles cancel the pending move for that item and schedule only the latest state.
- Reduced-motion users keep the 450 ms pause but receive no movement animation.
- Do not change IndexedDB, sync, backend, payments, persisted habit order, or generated `dist/`, `www/`, `src/routeTree.gen.ts`, or `supabase/functions/api/shared/` by hand.
- Add no animation dependency.

---

### Task 1: Pure gesture contract and render-free pointer primitive

**Files:**
- Create: `src/lib/mobile-gestures.ts`
- Create: `src/lib/mobile-gestures.test.ts`
- Create: `src/components/useHorizontalDrag.ts`
- Create: `src/components/useHorizontalDrag.test.tsx`

**Interfaces:**
- Produces: `resolveWeekSwipe(input: WeekSwipeInput): -1 | 0 | 1`, where positive means next week.
- Produces: `weekPanelShifts(lang: Lang): readonly [-1 | 1, 0, -1 | 1]` in physical left/center/right order.
- Produces: `useHorizontalDrag(options: HorizontalDragOptions): HorizontalDragBindings`, whose move callbacks are frame-batched and do not set React state.

- [ ] **Step 1: Write failing pure gesture tests**

```ts
expect(resolveWeekSwipe({ dx: 90, velocityX: 0.2, width: 320, lang: "fa" })).toBe(1);
expect(resolveWeekSwipe({ dx: -90, velocityX: -0.2, width: 320, lang: "fa" })).toBe(-1);
expect(resolveWeekSwipe({ dx: 90, velocityX: 0.2, width: 320, lang: "en" })).toBe(-1);
expect(resolveWeekSwipe({ dx: -90, velocityX: -0.2, width: 320, lang: "en" })).toBe(1);
expect(resolveWeekSwipe({ dx: 12, velocityX: 0.1, width: 320, lang: "fa" })).toBe(0);
expect(resolveWeekSwipe({ dx: 24, velocityX: 0.75, width: 320, lang: "fa" })).toBe(1);
expect(weekPanelShifts("fa")).toEqual([1, 0, -1]);
expect(weekPanelShifts("en")).toEqual([-1, 0, 1]);
```

- [ ] **Step 2: Run the gesture test and verify RED**

Run: `npx vitest run src/lib/mobile-gestures.test.ts`

Expected: FAIL because `mobile-gestures.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal pure contract**

Use a distance threshold of `min(72 px, width * 0.22)` and accept a short flick only when `abs(dx) >= 18` and `abs(velocityX) >= 0.55 px/ms`. Map physical drag sign to calendar delta with `fa ? sign : -sign`.

- [ ] **Step 4: Run the pure gesture test and verify GREEN**

Run: `npx vitest run src/lib/mobile-gestures.test.ts`

Expected: all gesture contract tests pass.

- [ ] **Step 5: Write a failing render-frequency test for the pointer primitive**

Mount a real React harness with a render counter, dispatch pointer down/move/up events, and assert that move frames call `onMove` while the harness render count remains unchanged. Also assert horizontal intent wins only after six pixels and dominant vertical movement does not call `onMove`.

- [ ] **Step 6: Run the pointer primitive test and verify RED**

Run: `npx vitest run src/components/useHorizontalDrag.test.tsx`

Expected: FAIL because `useHorizontalDrag` does not exist.

- [ ] **Step 7: Implement `useHorizontalDrag`**

Keep start point, latest point, velocity, intent, pointer id and pending frame in refs. Batch `onMove(dx)` with requestAnimationFrame, use pointer capture after horizontal intent is established, use no component state, flush the latest sample before `onEnd`, and cancel frames/capture on pointer cancel and unmount.

- [ ] **Step 8: Run both focused tests and commit**

Run: `npx vitest run src/lib/mobile-gestures.test.ts src/components/useHorizontalDrag.test.tsx`

Expected: both files pass with no warnings.

Commit: `git commit -m "perf: add frame-batched mobile gesture primitive"`

---

### Task 2: TickTick-style three-panel week pager

**Files:**
- Modify: `src/components/WeekStrip.tsx`
- Test: `src/lib/mobile-gestures.test.ts`

**Interfaces:**
- Consumes: `resolveWeekSwipe`, `weekPanelShifts`, and `useHorizontalDrag` from Task 1.
- Produces: the existing `WeekStrip` prop contract unchanged.

- [ ] **Step 1: Add failing gesture-contract cases used by buttons and relative-day preservation**

Add literal expectations showing that the physical target panel for delta `+1` is left in Persian and right in English, and that shifting `2026-08-29` by one week yields `2026-09-05` rather than the destination week's start.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/mobile-gestures.test.ts`

Expected: FAIL because the physical-panel helper is absent.

- [ ] **Step 3: Implement the three-panel track**

Extract a private `WeekPanel` renderer, force the track to physical `dir="ltr"`, render the shifts from `weekPanelShifts(lang)`, and keep each panel's labels in the active language direction. Drive the track with `translate3d` from the pointer primitive; settle to 0%, -33.333%, or -66.666% using a 280 ms exponential ease-out. On settle, call `onSelect(addDays(selected, delta * 7))`, disable transition, and recenter before the next paint.

- [ ] **Step 4: Preserve interaction boundaries**

Keep future-day buttons disabled, retain counts/rings/emojis/sub-labels for all three panels, prevent day click after a completed drag, keep vertical page scrolling, and switch instantly when reduced motion is active.

- [ ] **Step 5: Run gesture tests and TypeScript check, then commit**

Run: `npx vitest run src/lib/mobile-gestures.test.ts`

Run: `npx tsc --noEmit`

Expected: both commands exit 0.

Commit: `git commit -m "feat: add RTL-aware week pager"`

---

### Task 3: Delayed completion order and FLIP list

**Files:**
- Create: `src/lib/completion-order.ts`
- Create: `src/lib/completion-order.test.ts`
- Create: `src/components/AnimatedCompletionList.tsx`

**Interfaces:**
- Produces: `initialCompletionOrder(items: CompletionItem[]): string[]`.
- Produces: `reconcileCompletionOrder(order: string[], items: CompletionItem[]): string[]`.
- Produces: `moveCompletionItem(order: string[], id: string, completed: boolean, items: CompletionItem[]): string[]`.
- Produces: generic `AnimatedCompletionList<T>` whose render callback receives `(item, onCompletionChange)`.

- [ ] **Step 1: Write failing ordering tests**

Use literal fixtures to verify incomplete-first initial order, latest completion at the absolute bottom, reopening immediately before the first completed item, preservation of source order inside initial groups, deletion, insertion of a new incomplete item before the completed group, and no duplicated ids during reconciliation.

- [ ] **Step 2: Run the ordering test and verify RED**

Run: `npx vitest run src/lib/completion-order.test.ts`

Expected: FAIL because the ordering module does not exist.

- [ ] **Step 3: Implement the pure ordering helpers**

Never mutate source arrays. Existing ids retain local display order during reconciliation; new incomplete ids insert before the first completed id and new completed ids append. `moveCompletionItem` removes the target once, then appends it for completion or inserts it at the incomplete/completed boundary for reopening.

- [ ] **Step 4: Run the ordering test and verify GREEN**

Run: `npx vitest run src/lib/completion-order.test.ts`

Expected: all ordering tests pass.

- [ ] **Step 5: Implement `AnimatedCompletionList`**

Initialize from grouped source order, reconcile additions/deletions, keep one timeout per id, cancel an id's older timeout before scheduling the latest 450 ms move, and clear all timers on unmount. Immediately before changing order, batch-read wrapper rectangles; in `useLayoutEffect`, batch-read new rectangles and animate non-zero Y deltas for 260 ms with `cubic-bezier(0.22, 1, 0.36, 1)`. Skip `Element.animate` when reduced motion is enabled.

- [ ] **Step 6: Run focused tests and TypeScript check, then commit**

Run: `npx vitest run src/lib/completion-order.test.ts`

Run: `npx tsc --noEmit`

Expected: both commands exit 0.

Commit: `git commit -m "feat: animate completion list ordering"`

---

### Task 4: Integrate optimized rows and ordered lists

**Files:**
- Modify: `src/components/habits.tsx`
- Modify: `src/components/tasks.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/tasks.tsx`
- Modify: `src/styles.css`
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Modify: `docs-fa/01-FRONTEND.md`

**Interfaces:**
- Consumes: `useHorizontalDrag` and `AnimatedCompletionList` from Tasks 1 and 3.
- Changes: `HabitRow` and `TaskRow` gain optional `onCompletionChange(completed: boolean): void` and call it only after an accepted mutation that crosses the completion boundary.

- [ ] **Step 1: Add a failing accepted-mutation ordering regression test**

Extend the real hook/component harness to prove that a rejected mutation callback does not invoke the completion-order notifier, while an accepted false-to-true change invokes it once with `true`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/components/useHorizontalDrag.test.tsx`

Expected: FAIL until the row integration exposes accepted completion transitions.

- [ ] **Step 3: Replace row pointer state with the shared primitive**

Attach content and hint refs in `HabitRow` and `TaskRow`. Apply horizontal transform and hint opacity directly during frame callbacks, reset with a transform-only 220 ms ease, and call the existing toggle path at the 76 px threshold. Only run flash, check-pop, feedback and completion notifier when `update()` returns true.

- [ ] **Step 4: Wrap all requested lists**

Use `AnimatedCompletionList` for home habits, home tasks and the tasks page. Key each list by its selected date so a date change starts from incomplete-first source order. Pass the notifier returned for each item into its row.

- [ ] **Step 5: Add the minimal motion styles and documentation updates**

Add only compositor-safe row reset and list-wrapper containment utilities needed by the implementation. Update both Persian guides to describe frame-batched row swipes, the three-panel RTL-aware week pager and 450 ms completion ordering; leave unrelated documentation untouched.

- [ ] **Step 6: Run focused tests and the full local verification suite**

Run: `npx vitest run src/lib/mobile-gestures.test.ts src/components/useHorizontalDrag.test.tsx src/lib/completion-order.test.ts`

Run: `npm test -- --maxWorkers=1`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run build:mobile`

Run: `git diff --check`

Expected: every command exits 0 with zero failed tests and no lint/type/build errors.

- [ ] **Step 7: Run bounded mobile visual verification**

Start the existing frontend and use Playwright CLI at an iPhone-sized viewport. Verify one Persian and one English pass: horizontal week movement follows the pointer, Persian/English deltas are opposite, vertical scrolling still works, completion pauses then moves to the bottom, reopening moves above completed items, quick retoggle cancels stale motion, and reduced motion has no travel animation. Capture artifacts under `output/playwright/` only.

- [ ] **Step 8: Run Impeccable's detector and commit**

Run: `node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json src/components/WeekStrip.tsx src/components/habits.tsx src/components/tasks.tsx src/routes/index.tsx src/routes/tasks.tsx src/styles.css`

Address only findings caused by this change, rerun affected tests, then commit:

`git commit -m "perf: smooth mobile gestures and completion motion"`

---

### Task 5: Integrate and deploy the frontend safely

**Files:**
- Review only: all feature commits and current branch state.
- No backend, migration, secret, Supabase Function or payment changes.

**Interfaces:**
- Consumes: verified feature branch from Tasks 1-4.
- Produces: a fast-forwarded `main` pushed to the configured origin, which is the documented Cloudflare Pages frontend deployment trigger if current repository configuration confirms it.

- [ ] **Step 1: Review release scope and remote state**

Run: `git status --short --untracked-files=all`

Run: `git fetch origin`

Run: `git log --oneline --decorate --graph origin/main..HEAD`

Run: `git diff --stat origin/main...HEAD`

Run: `git diff origin/main...HEAD -- src docs-fa docs/superpowers package.json`

Expected: only the approved gesture/order code, its tests/docs and the already-approved design/plan commits are present; no backend/payment/generated output or unrelated workspace file is included.

- [ ] **Step 2: Re-run release verification from the exact commit**

Run: `npm test -- --maxWorkers=1`

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run build:mobile`

Run: `git diff --check origin/main...HEAD`

Expected: all commands exit 0.

- [ ] **Step 3: Fast-forward main and push without force**

Verify `origin/main` is an ancestor of the release commit. Fast-forward local `main` to the feature branch, then run `git push origin main`. Never force-push.

- [ ] **Step 4: Verify the deployed frontend**

Wait for the configured Cloudflare Pages deployment, then fetch the live HTML/assets and run a bounded browser smoke on the deployed `/app/`. Confirm the deployed asset hash/version includes the release and the page loads; do not describe this as physical-iPhone proof unless a real device was used.
