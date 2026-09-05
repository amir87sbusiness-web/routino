import type { SyncOptions } from "./engine";

export const EDIT_SYNC_DELAY_MS = 10_000;
export const FOREGROUND_SYNC_COOLDOWN_MS = 20_000;

export interface SyncSchedulerDeps {
  flush: (owner: string, options: SyncOptions) => Promise<unknown>;
  hasPending: (owner: string) => Promise<boolean>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export function createSyncScheduler({
  flush,
  hasPending,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: SyncSchedulerDeps) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const failed = new Set<string>();
  const lastCompletedAt = new Map<string, number>();

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const run = async (owner: string, options: SyncOptions) => {
    cancelTimer();
    try {
      const result = await flush(owner, options);
      failed.delete(owner);
      lastCompletedAt.set(owner, Date.now());
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

    flushNow(owner: string, options: SyncOptions = { pullRequired: false }) {
      return run(owner, options);
    },

    async onOnline(owner: string) {
      if (!failed.has(owner) && !(await hasPending(owner))) return;
      return run(owner, { pullRequired: failed.has(owner) });
    },

    async onForeground(owner: string) {
      const pending = await hasPending(owner);
      const last = lastCompletedAt.get(owner) ?? 0;
      if (!pending && Date.now() - last < FOREGROUND_SYNC_COOLDOWN_MS) return;
      return run(owner, { pullRequired: true });
    },

    dispose() {
      cancelTimer();
    },
  };
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>;
