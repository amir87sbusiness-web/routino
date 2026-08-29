import { describe, expect, it } from "vitest";
import {
  initialCompletionOrder,
  moveCompletionItem,
  reconcileCompletionOrder,
  type CompletionItem,
} from "./completion-order";

const items = (...entries: Array<[string, boolean]>): CompletionItem[] =>
  entries.map(([id, completed]) => ({ id, completed }));

describe("initialCompletionOrder", () => {
  it("groups incomplete items first while preserving source order inside both groups", () => {
    expect(
      initialCompletionOrder(
        items(["done-a", true], ["open-a", false], ["done-b", true], ["open-b", false]),
      ),
    ).toEqual(["open-a", "open-b", "done-a", "done-b"]);
  });
});

describe("moveCompletionItem", () => {
  it("moves each newly completed item below every earlier completed item", () => {
    const afterA = moveCompletionItem(
      ["a", "b", "c"],
      "a",
      true,
      items(["a", true], ["b", false], ["c", false]),
    );
    expect(afterA).toEqual(["b", "c", "a"]);

    const afterB = moveCompletionItem(
      afterA,
      "b",
      true,
      items(["a", true], ["b", true], ["c", false]),
    );
    expect(afterB).toEqual(["c", "a", "b"]);
  });

  it("returns a reopened item to the end of the incomplete section", () => {
    expect(
      moveCompletionItem(
        ["open", "done-b", "done-a"],
        "done-a",
        false,
        items(["open", false], ["done-a", false], ["done-b", true]),
      ),
    ).toEqual(["open", "done-a", "done-b"]);
  });

  it("keeps the target id unique after repeated status changes", () => {
    const reopened = moveCompletionItem(
      ["b", "a"],
      "a",
      false,
      items(["a", false], ["b", false]),
    );
    expect(reopened).toEqual(["b", "a"]);
    expect(new Set(reopened).size).toBe(reopened.length);
  });
});

describe("reconcileCompletionOrder", () => {
  it("removes deleted ids and inserts new items into their current completion section", () => {
    expect(
      reconcileCompletionOrder(
        ["deleted", "open", "done-a"],
        items(["open", false], ["done-a", true], ["new-open", false], ["new-done", true]),
      ),
    ).toEqual(["open", "new-open", "done-a", "new-done"]);
  });

  it("does not move an existing id merely because source completion changed", () => {
    expect(
      reconcileCompletionOrder(
        ["a", "b", "c"],
        items(["a", true], ["b", false], ["c", false]),
      ),
    ).toEqual(["a", "b", "c"]);
  });
});
