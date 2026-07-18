import { describe, expect, it } from "vitest";
import { normalizePhone, toAsciiDigits, toLocalPhone } from "./phone";

const CANON = "989123334444";

describe("toAsciiDigits", () => {
  it("converts Persian and Arabic-Indic digits", () => {
    expect(toAsciiDigits("۰۹۱۲۳۳۳۴۴۴۴")).toBe("09123334444");
    expect(toAsciiDigits("٠٩١٢٣٣٣٤٤٤٤")).toBe("09123334444");
  });

  it("leaves ASCII and separators alone", () => {
    expect(toAsciiDigits("0912-333 4444")).toBe("0912-333 4444");
  });
});

describe("normalizePhone", () => {
  it("accepts every form the same number is typed in", () => {
    for (const input of [
      "09123334444",
      "+989123334444",
      "989123334444",
      "00989123334444",
      "9123334444",
      "۰۹۱۲۳۳۳۴۴۴۴",
      "٠٩١٢٣٣٣٤٤٤٤",
      "0912 333 4444",
      "0912-333-4444",
      " +98 912 333 4444 ",
    ]) {
      expect(normalizePhone(input), input).toBe(CANON);
    }
  });

  it("keeps the 98 mobile prefix intact", () => {
    // 0998… is a real number whose national form starts with "98". Stripping a
    // leading "98" as if it were the country code would corrupt it.
    expect(normalizePhone("09981234567")).toBe("989981234567");
    expect(normalizePhone("9981234567")).toBe("989981234567");
    expect(normalizePhone("989981234567")).toBe("989981234567");
  });

  it("is idempotent", () => {
    expect(normalizePhone(CANON)).toBe(CANON);
    expect(normalizePhone(normalizePhone("09123334444")!)).toBe(CANON);
  });

  it("rejects non-mobile and malformed input", () => {
    for (const input of [
      "",
      "0212223344", // landline
      "0812334444", // not a 9-prefixed mobile
      "091233344", // too short
      "091233344445", // too long
      "abcdefghijk",
      "+1 415 555 2671", // non-IR
    ]) {
      expect(normalizePhone(input), input).toBeNull();
    }
  });
});

describe("toLocalPhone", () => {
  it("round-trips back to the display form", () => {
    expect(toLocalPhone(CANON)).toBe("09123334444");
    expect(normalizePhone(toLocalPhone(CANON))).toBe(CANON);
  });
});
