import { describe, expect, it } from "vitest";
import { completionDisplayOrder, mergeSubsetOrder } from "./local-order";

describe("completionDisplayOrder", () => {
  it("groups completed items last without changing their manual base order", () => {
    const base = ["a", "b", "c", "d"];
    const completed = new Set(["b", "d"]);

    expect(completionDisplayOrder(base, completed)).toEqual(["a", "c", "b", "d"]);
    expect(completionDisplayOrder(base, new Set(["d"]))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("mergeSubsetOrder", () => {
  it("reorders only the visible subset and preserves every other global slot", () => {
    expect(mergeSubsetOrder(["a", "hidden", "b", "other", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "hidden",
      "a",
      "other",
      "b",
    ]);
  });

  it("ignores duplicate and unknown ids from a drag result", () => {
    expect(mergeSubsetOrder(["a", "b", "c"], ["c", "c", "missing", "a"])).toEqual(["c", "b", "a"]);
  });
});
