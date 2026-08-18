export interface StorageHealth {
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

const unsupported = (): StorageHealth => ({
  supported: false,
  persisted: false,
  usageBytes: null,
  quotaBytes: null,
});

export async function readStorageHealth(): Promise<StorageHealth> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage) return unsupported();

  const [persisted, estimate] = await Promise.all([
    storage.persisted?.().catch(() => false) ?? false,
    storage.estimate?.().catch(() => ({})) ?? {},
  ]);

  return {
    supported: true,
    persisted,
    usageBytes: typeof estimate.usage === "number" ? estimate.usage : null,
    quotaBytes: typeof estimate.quota === "number" ? estimate.quota : null,
  };
}

export async function requestPersistentStorage(): Promise<StorageHealth> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage) return unsupported();
  try {
    await storage.persist?.();
  } catch {
    // A denial is a normal browser decision. The app remains fully usable and
    // Settings explains the backup/install options instead of treating it as an
    // application error.
  }
  return readStorageHealth();
}
