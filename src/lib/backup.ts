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

/* ---------------------------------------------------------------- restore --- */

/** Why an import file was rejected, so the UI can explain it to the user. */
export class BackupError extends Error {
  constructor(public reason: "not-json" | "bad-format") {
    super(reason);
    this.name = "BackupError";
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Parses and validates the text of a backup file.
 *
 * Throws `BackupError` on anything that isn't a Routino backup we can safely
 * restore — a corrupt paste, someone else's JSON, a future format we don't
 * understand. It checks the collections a user would actually mourn are the
 * right kind (arrays/objects), not their full contents: a partially hand-edited
 * backup is still worth restoring what it does carry.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("not-json");
  }
  if (
    !isRecord(raw) ||
    raw.format !== "routino-backup" ||
    raw.formatVersion !== 1 ||
    !isRecord(raw.db)
  ) {
    throw new BackupError("bad-format");
  }
  const db = raw.db;
  if (
    !Array.isArray(db.habits) ||
    !Array.isArray(db.categories) ||
    !isRecord(db.logs) ||
    !isRecord(db.settings)
  ) {
    throw new BackupError("bad-format");
  }
  return raw as unknown as Backup;
}

/** A quick tally of what a backup holds, for the "are you sure?" dialog. */
export function backupSummary(db: Db): {
  habits: number;
  logs: number;
  journal: number;
  tasks: number;
} {
  return {
    habits: db.habits.length,
    logs: Object.keys(db.logs).length,
    journal: Object.keys(db.journal).length,
    tasks: db.tasks.length,
  };
}

/**
 * The next in-memory `Db` after restoring `backup` over `current`.
 *
 * REPLACES the user's content — habits, logs, tasks, timer history, journal,
 * categories, feedback — and the account-level settings (language, calendar,
 * brand colour, onboarded, journal reminder).
 *
 * KEEPS this device's identity and preferences: the signed-in `auth`, the
 * `subscription` entitlement, the device-local `theme`/`notificationsEnabled`,
 * the in-app `notifications`, and `meta`. A restore happens AFTER the user has
 * signed in and passed the paywall on this device, so those must not be
 * overwritten by whatever was in the file.
 *
 * Restoring runs through the normal `update()` path, so `diffDb` turns the whole
 * swap into the right set of writes — including tombstones for anything the
 * backup no longer has. Fields are guarded so an older or partial backup can't
 * blank out data it simply didn't carry.
 */
export function restoreDb(current: Db, backup: Backup): Db {
  const b = backup.db;
  const bs = b.settings as Partial<Db["settings"]>;
  return {
    ...current,
    categories: Array.isArray(b.categories) ? b.categories : current.categories,
    habits: Array.isArray(b.habits) ? b.habits : current.habits,
    logs: isRecord(b.logs) ? b.logs : current.logs,
    tasks: Array.isArray(b.tasks) ? b.tasks : [],
    timerSessions: Array.isArray(b.timerSessions) ? b.timerSessions : [],
    journal: isRecord(b.journal) ? b.journal : {},
    feedback: Array.isArray(b.feedback) ? b.feedback : [],
    settings: {
      ...current.settings,
      lang: bs.lang ?? current.settings.lang,
      calendar: bs.calendar ?? current.settings.calendar,
      brandColor: bs.brandColor ?? current.settings.brandColor,
      onboarded: current.settings.onboarded || !!bs.onboarded,
      journalReminder:
        "journalReminder" in bs ? (bs.journalReminder ?? null) : current.settings.journalReminder,
    },
  };
}
