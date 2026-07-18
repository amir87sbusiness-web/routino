/**
 * User-facing data export — the recovery path if anything goes wrong.
 *
 * Serialises the in-memory `Db` rather than reading localStorage directly, so it
 * keeps working unchanged once storage moves to IndexedDB.
 */
import type { Db } from "./store";

export interface Backup {
  format: "routino-backup";
  formatVersion: 1;
  exportedAt: string;
  db: Db;
}

export function buildBackup(db: Db): Backup {
  return {
    format: "routino-backup",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    db,
  };
}

export function backupFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `routino-backup-${y}-${m}-${d}.json`;
}

/**
 * Triggers a file download. Returns false when the environment refuses it —
 * notably Android's WebView, which drops `blob:` downloads unless the host app
 * registers a DownloadListener. Callers should offer clipboard as a fallback.
 */
export function downloadBackup(db: Db): boolean {
  try {
    const json = JSON.stringify(buildBackup(db));
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick; revoking synchronously can cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

export async function copyBackupToClipboard(db: Db): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildBackup(db)));
    return true;
  } catch {
    return false;
  }
}
