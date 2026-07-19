/**
 * Native (Capacitor) export path for backups.
 *
 * Android's WebView silently drops `blob:` anchor downloads — the click
 * "succeeds" but no file is ever written, so the web path can't even detect
 * the failure. On native we instead write the JSON to the app's cache and
 * open the system share sheet: the user picks where it goes (Files, Drive,
 * Telegram…), which is also the only storage-permission-free way to put a
 * file somewhere that survives an uninstall.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { backupFilename, buildBackup } from "./backup";
import type { Db } from "./store";

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** Writes the backup into cache and opens the share sheet. Throws on failure —
 * callers fall back to the clipboard path. */
export async function shareBackupNative(db: Db): Promise<void> {
  const fileName = backupFilename();
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: JSON.stringify(buildBackup(db)),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: fileName,
    text: "فایل پشتیبان روتینو — Routino backup",
    files: [uri],
  });
}
