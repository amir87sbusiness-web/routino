import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_SYNC_STALE_MS,
  createSyncScheduler,
  EDIT_SYNC_DELAY_MS,
  FOREGROUND_MIN_BACKGROUND_MS,
  FOREGROUND_SYNC_COOLDOWN_MS,
} from "./scheduler";

describe("lifecycle sync scheduler", () => {
  const flush = vi.fn(async () => undefined);
  const hasPending = vi.fn(async () => true);
  const lastSyncedAt = vi.fn(async () => 0);
  const makeScheduler = () => createSyncScheduler({ flush, hasPending, lastSyncedAt });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
    flush.mockClear().mockResolvedValue(undefined);
    hasPending.mockClear().mockResolvedValue(true);
    lastSyncedAt.mockClear().mockResolvedValue(0);
  });

  it("uses a trailing ninety-second edit window", async () => {
    const scheduler = makeScheduler();
    scheduler.markDirty("u1");
    await vi.advanceTimersByTimeAsync(90_000 - 1);
    expect(flush).not.toHaveBeenCalled();

    scheduler.markDirty("u1");
    await vi.advanceTimersByTimeAsync(90_000 - 1);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("u1", { pullRequired: false });
  });

  it("flushes pending edits immediately on background with keepalive", async () => {
    const scheduler = makeScheduler();
    scheduler.markDirty("u1");
    await scheduler.flushNow("u1", { keepalive: true, pullRequired: false });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("u1", { keepalive: true, pullRequired: false });
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not run a clean background flush", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { keepalive: true, pullRequired: false });

    expect(flush).not.toHaveBeenCalled();
  });

  it("does not make an online request when nothing is pending and no run failed", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();
    await scheduler.onOnline("u1");
    expect(flush).not.toHaveBeenCalled();
    expect(hasPending).toHaveBeenCalledWith("u1");
  });

  it("retries a failed pull when connectivity returns", async () => {
    flush.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await expect(scheduler.flushNow("u1", { pullRequired: true })).rejects.toThrow("offline");
    await scheduler.onOnline("u1");

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith("u1", { pullRequired: true });
  });

  it("keeps a failed pull pending across a clean background event", async () => {
    flush.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await expect(scheduler.flushNow("u1", { pullRequired: true })).rejects.toThrow("offline");
    await scheduler.flushNow("u1", { pullRequired: false });
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FOREGROUND_MIN_BACKGROUND_MS);
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith("u1", { pullRequired: true });
  });

  it("skips clean foreground pulls after a brief app or tab switch", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { pullRequired: false });
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    await scheduler.onForeground("u1");

    expect(flush).not.toHaveBeenCalled();
  });

  it("pulls after a long foreground absence when no recent sync exists", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { pullRequired: false });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await scheduler.onForeground("u1");

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("u1", { pullRequired: true });
  });

  it("coalesces redundant clean foreground pulls for fifteen minutes", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { pullRequired: true });
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await scheduler.onForeground("u1");
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith("u1", { pullRequired: true });
  });

  it("uses the shared IndexedDB sync timestamp to de-duplicate another tab", async () => {
    hasPending.mockResolvedValue(false);
    lastSyncedAt.mockResolvedValue(Date.now() - 30_000);
    const scheduler = makeScheduler();

    await scheduler.onForeground("u1");

    expect(lastSyncedAt).toHaveBeenCalledWith("u1");
    expect(flush).not.toHaveBeenCalled();
  });

  it("skips a clean boot pull when the shared cursor was synced within ten minutes", async () => {
    hasPending.mockResolvedValue(false);
    lastSyncedAt.mockResolvedValue(Date.now() - BOOT_SYNC_STALE_MS + 1);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { includeAccountState: true, pullRequired: true });

    expect(flush).not.toHaveBeenCalled();
  });

  it("does not repeat the successful login pull two seconds later", async () => {
    hasPending.mockResolvedValue(false);
    const scheduler = makeScheduler();

    await scheduler.flushNow("u1", { includeAccountState: true, pullRequired: true });
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.flushNow("u1", { pullRequired: true });

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancels edit timers on dispose", async () => {
    const scheduler = makeScheduler();
    scheduler.markDirty("u1");
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DELAY_MS);
    expect(flush).not.toHaveBeenCalled();
  });
});
