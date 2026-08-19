import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as client from "../../src/lib/phone.js";
import * as server from "../src/lib/phone.js";

/**
 * `users.phone` is unique and derived from this function. If the client and the
 * server ever disagree, the same human signs in from two devices, normalises to
 * two different strings, gets two `users` rows, and their data splits in half —
 * with no error raised anywhere. This test is the only thing standing between
 * that and a duplicated copy-pasted file.
 */
const VECTORS = [
  // every form of one number
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
  // the 98-prefix trap: 0998… is a real number whose national form starts "98"
  "09981234567",
  "9981234567",
  "989981234567",
  "۰۹۹۸۱۲۳۴۵۶۷",
  // every mobile prefix
  "09011111111",
  "09051111111",
  "09301111111",
  "09901111111",
  // invalid
  "",
  "0212223344",
  "0812334444",
  "091233344",
  "091233344445",
  "abcdefghijk",
  "+1 415 555 2671",
  "98",
  "0",
  "۰۲۱۲۲۲۳۳۴۴",
];

describe("phone parity: client vs server", () => {
  it("keeps both source files byte-identical", () => {
    const clientSource = readFileSync(new URL("../../src/lib/phone.ts", import.meta.url));
    const serverSource = readFileSync(new URL("../src/lib/phone.ts", import.meta.url));
    expect(serverSource.equals(clientSource)).toBe(true);
  });

  it("normalizePhone agrees on every vector", () => {
    for (const v of VECTORS) {
      expect(server.normalizePhone(v), `normalizePhone(${JSON.stringify(v)})`).toBe(client.normalizePhone(v));
    }
  });

  it("toAsciiDigits agrees on every vector", () => {
    for (const v of VECTORS) {
      expect(server.toAsciiDigits(v), `toAsciiDigits(${JSON.stringify(v)})`).toBe(client.toAsciiDigits(v));
    }
  });

  it("toLocalPhone agrees", () => {
    for (const v of ["989123334444", "989981234567"]) {
      expect(server.toLocalPhone(v)).toBe(client.toLocalPhone(v));
    }
  });

  it("still canonicalises correctly (not just identically)", () => {
    // Guards against both copies drifting the same wrong way.
    expect(server.normalizePhone("۰۹۱۲۳۳۳۴۴۴۴")).toBe("989123334444");
    expect(server.normalizePhone("09981234567")).toBe("989981234567");
    expect(server.normalizePhone("0212223344")).toBeNull();
  });
});
