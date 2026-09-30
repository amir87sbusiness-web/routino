import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateGuide,
  prepareGuide,
  readGuide,
  replayGuide,
  saveGuideProgress,
} from "./product-guide";

describe("account-local product guide", () => {
  beforeEach(() => localStorage.clear());

  it("does not enroll existing accounts, and waits for personalization", () => {
    expect(readGuide("existing").enabled).toBe(false);
    activateGuide("existing");
    expect(readGuide("existing").enabled).toBe(false);
    prepareGuide("new");
    expect(readGuide("new").enabled).toBe(false);
    activateGuide("new");
    expect(readGuide("new").enabled).toBe(true);
  });

  it("persists independent steps and completion without touching another account", () => {
    prepareGuide("a");
    activateGuide("a");
    saveGuideProgress("a", "today", "habits", false);
    saveGuideProgress("a", "tasks", "save", true);
    expect(readGuide("a").progress.today).toEqual({ step: "habits", done: false });
    expect(readGuide("a").progress.tasks.done).toBe(true);
    expect(readGuide("b").progress).toEqual({});
    prepareGuide("a");
    activateGuide("a");
    expect(readGuide("a").progress.tasks.done).toBe(true);
  });

  it("replays only the selected account and accepts corrupt storage safely", () => {
    saveGuideProgress("b", "today", "date", true);
    replayGuide("a");
    expect(readGuide("a")).toMatchObject({ enabled: true, progress: {} });
    expect(readGuide("b").progress.today.done).toBe(true);
    localStorage.setItem("routino:guide:v1:broken", "not json");
    expect(readGuide("broken").enabled).toBe(false);
  });

  it("keeps usable session progress when local storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("denied");
    });
    prepareGuide("unavailable");
    activateGuide("unavailable");
    saveGuideProgress("unavailable", "today", "date", false);
    expect(readGuide("unavailable").progress.today.step).toBe("date");
    get.mockRestore();
    set.mockRestore();
  });

  it("keeps progress when storage reads work but writes hit quota", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    prepareGuide("quota");
    activateGuide("quota");
    expect(readGuide("quota").enabled).toBe(true);
    set.mockRestore();
  });
});
