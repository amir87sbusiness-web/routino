# Production Reminders Design

## Goal

Make Routino's native reminders deterministic, local-only, schedule-correct, permission-aware, and safe to reconcile repeatedly from the current `Db` state.

## Architecture

- `src/lib/reminder-planner.ts` is pure. It converts `Db` plus `now`, capacity, and policy options into a bounded list of Routino-owned notification descriptions.
- Habit occurrence validity always calls `isDueOn`. Daily habits use one daily calendar trigger, weekday habits use one native weekday trigger per selected weekday, and odd/even habits use sorted one-shot occurrences inside a rolling horizon.
- Tasks, journal, and subscription/trial lifecycle reminders are planned from current state. Completed/deleted/past tasks produce no notification.
- Product and lifecycle reminder policy are separate so expiry gating can later disable product reminders without disabling lifecycle alerts.
- `src/lib/native-notifications.ts` owns the Capacitor boundary. It checks permission without prompting, cancels only pending items tagged as Routino-owned, and schedules the fresh deterministic plan.
- AppProvider reconciles on boot, foreground/focus, and relevant DB changes. It never requests permission. Settings is the explicit permission-request surface.

## Capacity and precision

- The planner defaults to at most 60 pending local notifications, leaving headroom below iOS's practical 64-request ceiling.
- Candidates are ordered by next delivery time, then deterministic ID. Closest reminders win when capacity is exhausted.
- Precise user reminders use `allowWhileIdle: true`. Android declares `SCHEDULE_EXACT_ALARM`; Settings can check and explicitly open the exact-alarm settings screen.
- Capacitor's bundled Android restore receiver already restores stored alarms after reboot. Hardware behavior after kill, battery saver, reboot, and vendor-specific power management still requires a physical-device run.

## Permission and web behavior

- New installations default notifications to off. Existing persisted true/false values survive unchanged; legacy blobs missing the field migrate to off.
- Background reconciliation only checks permission. A denied permission results in no schedules and an accurate off preference, without repeated prompts.
- Browser `Notification` delivery remains web/PWA-only. Native uses Local Notifications while the in-app notification history remains unchanged.

## Verification

Pure tests cover all habit schedules/calendars/boundaries, task lifecycle, journal/calendar changes, stable IDs, capacity and duplicates. Boundary tests cover permission-safe reconciliation and ownership-scoped cancellation. A manual native checklist records what cannot be proven without a physical device.
