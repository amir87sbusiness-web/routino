import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler, EDIT_SYNC_DELAY_MS } from "./scheduler";

describe("10-second lifecycle sync scheduler", () => {
  const flush = vi.fn(async () => undefined);
  const hasPending = vi.fn(async () => true);

  beforeEach(() => {
    vi.useFakeTimers();
    flush.mockClear();
    hasPending.mockClear().mockResolvedValue(true);
  });

  it("uses a trailing ten-second edit window", async () => {
    const scheduler = createSyncScheduler({ flush, hasPending });
    scheduler.markDirty("u1");
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS - 1);
    expect(flush).not.toHaveBeenCalled();

    scheduler.markDirty("u1");
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("u1", { pullRequired: false });
  });

  it("flushes immediately on background with keepalive", async () => {
    const scheduler = createSyncScheduler({ flush, hasPending });
    scheduler.markDirty("u1");
    await scheduler.flushNow("u1", { keepalive: true, pullRequired: false });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("u1", { keepalive: true, pullRequired: false });
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not make an online request when nothing is pending and no run failed", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = createSyncScheduler({ flush, hasPending });
    await scheduler.onOnline("u1");
    expect(flush).not.toHaveBeenCalled();
  });

  it("retries a failed run when connectivity returns", async () => {
    flush.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    hasPending.mockResolvedValue(false);
    const scheduler = createSyncScheduler({ flush, hasPending });

    await expect(scheduler.flushNow("u1", { pullRequired: true })).rejects.toThrow("offline");
    await scheduler.onOnline("u1");

    expect(flush).toHaveBeenLastCalledWith("u1", { pullRequired: true });
  });

  it("pulls on a real foreground event and cancels timers on dispose", async () => {
    const scheduler = createSyncScheduler({ flush, hasPending });
    scheduler.markDirty("u1");
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledWith("u1", { pullRequired: true });

    scheduler.markDirty("u1");
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("coalesces redundant clean foreground pulls for ten seconds", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = createSyncScheduler({ flush, hasPending });

    await scheduler.flushNow("u1", { pullRequired: true });
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS);
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith("u1", { pullRequired: true });
  });
});
