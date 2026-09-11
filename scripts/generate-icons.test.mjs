// @vitest-environment node

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, it } from "vitest";
import { generateIcons } from "./generate-icons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ANDROID_LAUNCHER_SIZES = {
  ldpi: 36,
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const ANDROID_SPLASH_SIZES = {
  "drawable/splash.png": [320, 480],
  "drawable-night/splash.png": [320, 240],
  "drawable-land-ldpi/splash.png": [320, 240],
  "drawable-land-mdpi/splash.png": [480, 320],
  "drawable-land-hdpi/splash.png": [800, 480],
  "drawable-land-xhdpi/splash.png": [1280, 720],
  "drawable-land-xxhdpi/splash.png": [1600, 960],
  "drawable-land-xxxhdpi/splash.png": [1920, 1280],
  "drawable-land-night-ldpi/splash.png": [320, 240],
  "drawable-land-night-mdpi/splash.png": [480, 320],
  "drawable-land-night-hdpi/splash.png": [800, 480],
  "drawable-land-night-xhdpi/splash.png": [1280, 720],
  "drawable-land-night-xxhdpi/splash.png": [1600, 960],
  "drawable-land-night-xxxhdpi/splash.png": [1920, 1280],
  "drawable-port-ldpi/splash.png": [240, 320],
  "drawable-port-mdpi/splash.png": [320, 480],
  "drawable-port-hdpi/splash.png": [480, 800],
  "drawable-port-xhdpi/splash.png": [720, 1280],
  "drawable-port-xxhdpi/splash.png": [960, 1600],
  "drawable-port-xxxhdpi/splash.png": [1280, 1920],
  "drawable-port-night-ldpi/splash.png": [240, 320],
  "drawable-port-night-mdpi/splash.png": [320, 480],
  "drawable-port-night-hdpi/splash.png": [480, 800],
  "drawable-port-night-xhdpi/splash.png": [720, 1280],
  "drawable-port-night-xxhdpi/splash.png": [960, 1600],
  "drawable-port-night-xxxhdpi/splash.png": [1280, 1920],
};

async function expectPngSize(path, width, height) {
  const metadata = await sharp(readFileSync(path)).metadata();
  assert.equal(metadata.format, "png", path);
  assert.equal(metadata.width, width, path);
  assert.equal(metadata.height, height, path);
}

async function expectVisibleMarkCentered(path) {
  const { data, info } = await sharp(readFileSync(path))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * 3;
      const distanceFromWhite = Math.hypot(
        255 - data[index],
        255 - data[index + 1],
        255 - data[index + 2],
      );
      if (distanceFromWhite <= 35) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  assert.ok(maxX >= minX && maxY >= minY, `${path} must contain a visible mark`);
  assert.ok(
    Math.abs((minX + maxX) / 2 - (info.width - 1) / 2) <= 1,
    `${path} mark must be horizontally centered`,
  );
  assert.ok(
    Math.abs((minY + maxY) / 2 - (info.height - 1) / 2) <= 1,
    `${path} mark must be vertically centered`,
  );
}

async function expectComfortableAndroidMarkScale(path) {
  const { data, info } = await sharp(readFileSync(path))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let maxX = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * 3;
      if (Math.hypot(255 - data[index], 255 - data[index + 1], 255 - data[index + 2]) <= 35) {
        continue;
      }
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  const occupancy = (maxX - minX + 1) / info.width;
  assert.ok(occupancy >= 0.7 && occupancy <= 0.72, `${path} mark occupancy was ${occupancy}`);
}

describe("Routino brand asset generator", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "routino-icons-test-"));

  beforeAll(async () => {
    cpSync(join(ROOT, "assets", "brand"), join(sandbox, "assets", "brand"), {
      recursive: true,
    });
    await generateIcons({ root: sandbox });
  }, 30_000);

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("generates every web and native brand asset at the required dimensions", async () => {
    const fixedPngOutputs = [
      ["public/icons/favicon-16.png", 16, 16],
      ["public/icons/favicon-32.png", 32, 32],
      ["public/icons/icon-192.png", 192, 192],
      ["public/icons/icon-512.png", 512, 512],
      ["public/icons/icon-maskable-192.png", 192, 192],
      ["public/icons/icon-maskable-512.png", 512, 512],
      ["public/icons/apple-touch-icon.png", 180, 180],
      ["assets/icon-only.png", 1024, 1024],
      ["assets/icon-background.png", 1024, 1024],
      ["assets/icon-foreground.png", 1024, 1024],
      ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024, 1024],
      ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png", 2732, 2732],
      ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png", 2732, 2732],
      ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png", 2732, 2732],
    ];

    for (const [relativePath, width, height] of fixedPngOutputs) {
      await expectPngSize(join(sandbox, relativePath), width, height);
    }

    for (const [density, size] of Object.entries(ANDROID_LAUNCHER_SIZES)) {
      const folder = join(sandbox, "android", "app", "src", "main", "res", `mipmap-${density}`);
      await expectPngSize(join(folder, "ic_launcher.png"), size, size);
      await expectVisibleMarkCentered(join(folder, "ic_launcher.png"));

      for (const obsolete of [
        "ic_launcher_round.png",
        "ic_launcher_background.png",
        "ic_launcher_foreground.png",
      ]) {
        assert.equal(existsSync(join(folder, obsolete)), false, `${obsolete} must be removed`);
      }
    }

    assert.equal(
      existsSync(join(sandbox, "android", "app", "src", "main", "res", "mipmap-anydpi-v26")),
      false,
      "obsolete adaptive launcher resources must be removed",
    );
    await expectComfortableAndroidMarkScale(
      join(sandbox, "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher.png"),
    );

    for (const [relativePath, [width, height]] of Object.entries(ANDROID_SPLASH_SIZES)) {
      await expectPngSize(
        join(sandbox, "android", "app", "src", "main", "res", relativePath),
        width,
        height,
      );
    }

    const lightLogo = await sharp(
      readFileSync(join(sandbox, "public", "brand", "logo-light.webp")),
    ).metadata();
    const darkLogo = await sharp(
      readFileSync(join(sandbox, "public", "brand", "logo-dark.webp")),
    ).metadata();
    assert.deepEqual([lightLogo.format, lightLogo.width, lightLogo.height], ["webp", 256, 256]);
    assert.deepEqual([darkLogo.format, darkLogo.width, darkLogo.height], ["webp", 256, 256]);
  });

  it("keeps all browser favicon files within their strict byte budgets", () => {
    assert.ok(statSync(join(sandbox, "public", "icons", "favicon-16.png")).size <= 6 * 1024);
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
