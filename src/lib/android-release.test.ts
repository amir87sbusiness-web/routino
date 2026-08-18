import { describe, expect, it } from "vitest";

describe("Android release packaging guards", () => {
  it("fails clearly when signing configuration is absent", async () => {
    // @ts-expect-error build-only JavaScript module.
    const { validateSigningProperties } = await import("../../scripts/build-android-release.mjs");
    expect(() => validateSigningProperties({}, () => false)).toThrow(/keystore\.properties/i);
  });

  it("rejects debug certificates and accepts a verified production signer", async () => {
    // @ts-expect-error build-only JavaScript module.
    const { validateSignerOutput } = await import("../../scripts/build-android-release.mjs");
    expect(() =>
      validateSignerOutput(
        "Verifies\nSigner #1 certificate DN: CN=Android Debug,O=Android,C=US\nSigner #1 certificate SHA-256 digest: aa",
      ),
    ).toThrow(/debug/i);
    expect(
      validateSignerOutput(
        "Verifies\nSigner #1 certificate DN: CN=Routino Release,O=Routino,C=IR\nSigner #1 certificate SHA-256 digest: A1:B2:C3",
      ),
    ).toEqual({
      certificateSha256: "A1:B2:C3",
      certificateDn: "CN=Routino Release,O=Routino,C=IR",
    });
  });

  it("requires the expected package and extracts version metadata", async () => {
    // @ts-expect-error build-only JavaScript module.
    const { parseBadging } = await import("../../scripts/build-android-release.mjs");
    const line = "package: name='com.routino.app' versionCode='1' versionName='1.0'";
    expect(parseBadging(line)).toEqual({
      packageName: "com.routino.app",
      versionCode: 1,
      versionName: "1.0",
    });
    expect(() =>
      parseBadging("package: name='com.example.debug' versionCode='1' versionName='1'"),
    ).toThrow(/com\.routino\.app/);
  });
});
