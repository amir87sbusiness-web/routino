# Task Form and Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full Tasks page quick add with one complete add/edit flow, support binary/count/time tasks, connect time tasks to the existing timer flow, and rotate colors for quick tasks added from Today.

**Architecture:** Keep the existing Task record and sync contract unchanged. Put draft conversion, color selection, and the reusable task form in `src/components/tasks.tsx`; routes supply calendar and update callbacks.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, Tailwind CSS, Zod sync validation.

## Global Constraints

- Do not modify habit files or habit behavior.
- Do not run or create a database migration, DDL, data cleanup, deploy, or real provider call.
- Preserve existing Task records and treat new fields as optional.
- Preserve AnimatedCompletionList, swipe, completion feedback, and current timer accounting behavior.
- Keep quick add only in TodayTodosCard; use the complete form on `/tasks`.

---

### Task 1: Backward-compatible task draft and quick colors

**Files:**

- Modify: `src/components/tasks.test.tsx`
- Modify: `src/components/tasks.tsx`

**Interfaces:**

- Produces: `TaskDraft`, `emptyTaskDraft(dateKey)`, `taskToDraft(task)`, `draftToTask(draft, existing?)`, and `nextQuickTaskColor(tasks, dateKey)`.

- [ ] Add failing unit tests for legacy conversion, binary/count/time normalization, editing identity, and consecutive quick colors.
- [ ] Run `npm test -- src/components/tasks.test.tsx` and confirm the new tests fail because the exports do not exist.
- [ ] Implement the minimal conversion/color helpers using the existing Task fields.
- [ ] Update `addQuickTask` to assign `nextQuickTaskColor` while preserving every existing field contract.
- [ ] Run `npm test -- src/components/tasks.test.tsx` and confirm it passes.

### Task 2: Reusable add/edit form and row edit action

**Files:**

- Modify: `src/components/tasks.test.tsx`
- Modify: `src/components/tasks.tsx`

**Interfaces:**

- Produces: `TaskFormModal` and optional `TaskRow.onEdit`.

- [ ] Add failing interaction tests that the row edit button calls `onEdit` without toggling completion and that the modal exposes binary/count/time choices.
- [ ] Run the focused test and confirm the expected controls/callback are absent.
- [ ] Implement TaskFormModal with the incumbent Modal, Input, DurationPicker, DatePickerCalendar, TimePicker24, icon and color controls.
- [ ] Add an accessible Pencil edit button to TaskRow and display count units without changing swipe behavior.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Wire full Tasks and Today editing flows

**Files:**

- Modify: `src/routes/tasks.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/components/tasks.tsx`
- Test: `src/components/tasks.test.tsx`

**Interfaces:**

- Consumes: Task draft helpers and TaskFormModal.
- Produces: add/edit behavior on `/tasks` and edit behavior inside TodayTodosCard.

- [ ] Add a failing test proving TodayTodosCard retains quick add and can open an existing task for edit.
- [ ] Replace `/tasks` quick input and Advanced button with one add control that opens the complete form.
- [ ] Use the same form for TaskRow edits in `/tasks`; save by id and keep reminder date/time coherent.
- [ ] Pass calendar context into TodayTodosCard and wire its TaskRow edit callback to the same modal.
- [ ] Run focused component tests.

### Task 4: Verification and visual inspection

**Files:**

- Verify all modified files; do not deploy.

- [ ] Run focused frontend and backend tests.
- [ ] Run `npm test` and `npm run build`.
- [ ] Run `npm --prefix backend run typecheck` and the relevant backend tests.
- [ ] Run Impeccable detector once over changed UI targets.
- [ ] Inspect `/tasks` and Today at mobile and desktop widths in a real browser, then fix any concrete visual or interaction defect in one bounded pass.
- [ ] Review `git diff` and `git status` to confirm no migration, habit file, unrelated user file, or generated forbidden file changed.
