import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePaymentDeepLink } from "./payment-deep-link";

describe("native payment deep links", () => {
  it("parses Routino payment returns and preserves the status hint", () => {
    expect(
      parsePaymentDeepLink(
        "routino://pay/result?paymentId=7da578fc-34c7-458e-8481-4d05efb9fc31&status=paid",
      ),
    ).toEqual({
      paymentId: "7da578fc-34c7-458e-8481-4d05efb9fc31",
      status: "paid",
    });
  });

  it("accepts a result without a status hint", () => {
    expect(parsePaymentDeepLink("routino://pay/result?paymentId=p-123")).toEqual({
      paymentId: "p-123",
    });
  });

  it.each([
    "https://routino.me/pay/result?paymentId=p-1",
    "routino://other/result?paymentId=p-1",
    "routino://pay/other?paymentId=p-1",
    "routino://pay/result",
    "not a url",
  ])("rejects unrelated or incomplete URLs: %s", (url) => {
    expect(parsePaymentDeepLink(url)).toBeNull();
  });

  it("keeps Android, iOS and cold-launch wiring in sync with the routino scheme", () => {
    const root = process.cwd();
    const androidManifest = readFileSync(
      resolve(root, "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    const iosInfo = readFileSync(resolve(root, "ios/App/App/Info.plist"), "utf8");
    const client = readFileSync(resolve(root, "src/client.tsx"), "utf8");

    expect(androidManifest).toContain('android:scheme="routino"');
    expect(iosInfo).toContain("<string>routino</string>");
    expect(client).toContain('addListener("appUrlOpen"');
    expect(client).toContain("getLaunchUrl()");
    expect(client).toContain("parsePaymentDeepLink");
  });
});
