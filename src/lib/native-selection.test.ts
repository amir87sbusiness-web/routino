import { describe, expect, it } from "vitest";
import { allowsNativeSelection } from "./native-selection";

describe("allowsNativeSelection", () => {
  it("keeps editable controls and explicit copy targets usable", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const copyTarget = document.createElement("span");
    copyTarget.dataset.allowCopy = "true";

    expect(allowsNativeSelection(input)).toBe(true);
    expect(allowsNativeSelection(editor)).toBe(true);
    expect(allowsNativeSelection(copyTarget)).toBe(true);
  });

  it("blocks native selection menus on ordinary app content", () => {
    const label = document.createElement("span");

    expect(allowsNativeSelection(label)).toBe(false);
  });
});
