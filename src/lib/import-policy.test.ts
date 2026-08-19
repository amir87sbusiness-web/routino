import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb } from "./store";
import { canImportBackup } from "./import-policy";

const NOW = Date.UTC(2026, 7, 18);

describe("canImportBackup", () => {
  it("allows an active paid subscription", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.subscription = { planId: "p1", startedAt: NOW - 1_000, expiresAt: NOW + 1_000 };
    expect(canImportBackup(db, NOW)).toBe(true);
  });

  it("rejects trial, free, expired and missing subscriptions", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    expect(canImportBackup(db, NOW)).toBe(false);
    db.subscription = { planId: "trial", startedAt: NOW - 1_000, expiresAt: NOW + 1_000, trial: true };
    expect(canImportBackup(db, NOW)).toBe(false);
    db.subscription = { planId: "free", startedAt: NOW - 1_000, expiresAt: NOW + 1_000 };
    expect(canImportBackup(db, NOW)).toBe(false);
    db.subscription = { planId: "p1", startedAt: NOW - 2_000, expiresAt: NOW - 1 };
    expect(canImportBackup(db, NOW)).toBe(false);
  });
});
