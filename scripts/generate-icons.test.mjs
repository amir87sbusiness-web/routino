import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sandboxes = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "routino-icons-"));
  sandboxes.push(sandbox);
  cpSync(join(ROOT, "scripts"), join(sandbox, "scripts"), { recursive: true });
  cpSync(join(ROOT, "assets"), join(sandbox, "assets"), { recursive: true });
  cpSync(join(ROOT, "public"), join(sandbox, "public"), { recursive: true });
  cpSync(join(ROOT, "android"), join(sandbox, "android"), { recursive: true });
  return sandbox;
}

function generate(sandbox) {
  execFileSync(process.execPath, [join(sandbox, "scripts", "generate-icons.mjs")], {
    cwd: sandbox,
    stdio: "pipe",
  });
}

describe("Routino brand asset generator", () => {
  it("generates every web and native brand asset at the required dimensions", () => {
    const sandbox = makeSandbox();
    generate(sandbox);

    const targets = [
      ["public/icons/favicon-16.png", 16, 16],
      ["public/icons/favicon-32.png", 32, 32],
      ["public/icons/apple-touch-icon.png", 180, 180],
      ["public/icons/pwa-192.png", 192, 192],
      ["public/icons/pwa-512.png", 512, 512],
      ["public/icons/maskable-192.png", 192, 192],
      ["public/icons/maskable-512.png", 512, 512],
      ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48, 48],
      ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72, 72],
      ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96, 96],
      ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144, 144],
      ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192, 192],
    ];

    function pngSize(path) {
      const png = readFileSync(path);
      assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    }

    for (const [relativePath, width, height] of targets) {
      assert.deepEqual(pngSize(join(sandbox, relativePath)), { width, height }, relativePath);
    }
  });

  it("keeps all browser favicon files within their strict byte budgets", () => {
    const sandbox = makeSandbox();
    generate(sandbox);

    assert.ok(statSync(join(sandbox, "public", "icons", "favicon-16.png")).size <= 8 * 1024);
    assert.ok(statSync(join(sandbox, "public", "icons", "favicon-32.png")).size <= 12 * 1024);
    assert.ok(statSync(join(sandbox, "public", "favicon.ico")).size <= 24 * 1024);
  });

  it("uses one launcher icon and a fresh Android package version", () => {
    const gradle = readFileSync(join(ROOT, "android", "app", "build.gradle"), "utf8");
    const manifest = readFileSync(
      join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml"),
      "utf8",
    );
    assert.match(gradle, /versionCode 8\b/);
    assert.match(gradle, /versionName "1\.0"/);
    assert.doesNotMatch(manifest, /android:roundIcon=/);
  });
});