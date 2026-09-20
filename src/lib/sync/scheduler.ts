import { loadSyncState, type SyncOptions } from "./engine";

export const EDIT_SYNC_DELAY_MS = 90_000;
export const FOREGROUND_SYNC_COOLDOWN_MS = 15 * 60_000;
export const FOREGROUND_MIN_BACKGROUND_MS = 5 * 60_000;
export const BOOT_SYNC_STALE_MS = 10 * 60_000;

export interface SyncSchedulerDeps {
  flush: (owner: string, options: SyncOptions) => Promise<unknown>;
  hasPending: (owner: string) => Promise<boolean>;
  lastSyncedAt?: (owner: string) => Promise<number>;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export function createSyncScheduler({
  flush,
  hasPending,
  lastSyncedAt = async (owner) => (await loadSyncState(owner)).lastSyncedAt,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: SyncSchedulerDeps) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const failed = new Set<string>();
  const lastCompletedAt = new Map<string, number>();
  const backgroundedAt = new Map<string, number>();

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const latestSuccessfulSyncAt = async (owner: string) => {
    const local = lastCompletedAt.get(owner) ?? 0;
    try {
      return Math.max(local, await lastSyncedAt(owner));
    } catch {
      return local;
    }
  };

  const run = async (owner: string, options: SyncOptions) => {
    cancelTimer();
    try {
      const result = await flush(owner, options);
      failed.delete(owner);
      lastCompletedAt.set(owner, now());
      return result;
    } catch (error) {
      failed.add(owner);
      throw error;
    }
  };

  return {
    markDirty(owner: string) {
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        void run(owner, { pullRequired: false }).catch(() => undefined);
      }, EDIT_SYNC_DELAY_MS);
    },

    async flushNow(owner: string, options: SyncOptions = { pullRequired: false }) {
      const pending = await hasPending(owner);

      // Background/pagehide only needs to drain real local edits. Keeping a
      // failed pull marked as failed lets the next online/foreground event retry
      // it with pullRequired=true instead of clearing the failure on a no-op.
      if (options.pullRequired === false) {
        backgroundedAt.set(owner, now());
        if (!pending) {
          cancelTimer();
          return;
        }
        return run(owner, options);
      }

      // A hard refresh, a second tab, or the bounded post-login catch-up can
      // arrive seconds after a successful exchange. The cursor timestamp is in
      // shared IndexedDB, so this also de-duplicates clean pulls across tabs
      // without a leader-election protocol.
      if (!pending && !failed.has(owner)) {
        const latest = await latestSuccessfulSyncAt(owner);
        const staleAfter = options.includeAccountState
          ? BOOT_SYNC_STALE_MS
          : FOREGROUND_SYNC_COOLDOWN_MS;
        if (latest > 0 && now() - latest < staleAfter) {
          cancelTimer();
          return;
        }
      }

      return run(owner, options);
    },

    async onOnline(owner: string) {
      if (!failed.has(owner) && !(await hasPending(owner))) return;
      return run(owner, { pullRequired: failed.has(owner) });
    },

    async onForeground(owner: string) {
      const pending = await hasPending(owner);
      const backgrounded = backgroundedAt.get(owner);
      backgroundedAt.delete(owner);

      if (pending || failed.has(owner)) {
        return run(owner, { pullRequired: true });
      }

      // A brief app/tab switch is common and almost never worth a server
      // invocation. Longer absences can pull, but still respect the shared
      // fifteen-minute freshness window below.
      if (backgrounded !== undefined && now() - backgrounded < FOREGROUND_MIN_BACKGROUND_MS) {
        return;
      }

      const latest = await latestSuccessfulSyncAt(owner);
      if (latest > 0 && now() - latest < FOREGROUND_SYNC_COOLDOWN_MS) return;
      return run(owner, { pullRequired: true });
    },

    dispose() {
      cancelTimer();
      backgroundedAt.clear();
    },
  };
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>;
