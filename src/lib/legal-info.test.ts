import { describe, expect, it } from "vitest";
import { LEGAL_INFO } from "./legal-info";

describe("public contact information", () => {
  it("contains no email address", () => {
    expect("email" in LEGAL_INFO).toBe(false);
    expect(Object.keys(LEGAL_INFO)).not.toContain("email");
  });
});
