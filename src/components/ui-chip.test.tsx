import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Chip } from "./ui";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Chip selection semantics", () => {
  let host: HTMLDivElement | undefined;

  afterEach(() => host?.remove());

  it("exposes its active state to assistive technology", () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(<Chip active>Week</Chip>));

    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    act(() => root.unmount());
  });
});
