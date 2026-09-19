import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { flattenCascadeLayers } from "./flatten-mobile-css.ts";

describe("flattenCascadeLayers", () => {
  it("keeps Tailwind utility rules usable in WebViews without cascade-layer support", () => {
    const css =
      "@layer base{body{margin:0}}@layer utilities{.flex{display:flex}}@media (width>=40rem){@layer utilities{.sm\\:flex{display:flex}}}";

    assert.equal(
      flattenCascadeLayers(css),
      "body{margin:0}.flex{display:flex}@media (width>=40rem){.sm\\:flex{display:flex}}",
    );
  });
});
