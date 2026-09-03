/**
 * Generate every Routino brand asset from the two approved source images.
 *
 *   npm run icons
 *
 * The light source owns installed icons and native splash screens. The light
 * and dark sources both produce compact in-app logos. Keep every platform
 * output here so its framing cannot drift independently.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_SIZE = 1254;
const LIGHT_BACKGROUND = { r: 248, g: 248, b: 248, alpha: 1 };
const UI_CROP = { left: 140, top: 110, width: 974, height: 974 };

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

const IOS_SPLASH_NAMES = [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
];

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function writeOutput(path, data) {
  await ensureParent(path);
  await writeFile(path, data);
}

async function loadApprovedSource(path) {
  const source = await readFile(path);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== SOURCE_SIZE || metadata.height !== SOURCE_SIZE) {
    throw new Error(`Brand source must be ${SOURCE_SIZE}x${SOURCE_SIZE}: ${path}`);
  }
  return source;
}

async function renderUiLogo(source) {
  return sharp(source)
    .extract(UI_CROP)
    .resize(256, 256, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.45 })
    .webp({ quality: 94, smartSubsample: true })
    .toBuffer();
}

async function renderInstalledIcon(source, size, { palette = false } = {}) {
  const pipeline = sharp(source)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: size <= 32 ? 0.65 : 0.35 });
  return pipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette, quality: 92 })
    .toBuffer();
}

async function renderSolid(size) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: LIGHT_BACKGROUND },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** Remove the near-white source background without changing the mark geometry. */
async function renderTransparentMark(source, size) {
  const { data, info } = await sharp(source)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);
  const bg = 248;

  for (let input = 0, target = 0; input < data.length; input += 3, target += 4) {
    const r = data[input];
    const g = data[input + 1];
    const b = data[input + 2];
    const distance = Math.hypot(r - bg, g - bg, b - bg);
    const alpha = Math.max(0, Math.min(1, (distance - 7) / 39));

    if (alpha === 0) {
      output[target] = 0;
      output[target + 1] = 0;
      output[target + 2] = 0;
      output[target + 3] = 0;
      continue;
    }

    output[target] = Math.max(0, Math.min(255, Math.round(bg + (r - bg) / alpha)));
    output[target + 1] = Math.max(0, Math.min(255, Math.round(bg + (g - bg) / alpha)));
    output[target + 2] = Math.max(0, Math.min(255, Math.round(bg + (b - bg) / alpha)));
    output[target + 3] = Math.round(alpha * 255);
  }

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function renderRoundIcon(source, size) {
  const tile = await renderInstalledIcon(source, size);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(tile)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function renderSplash(transparentMark, width, height) {
  const markBox = Math.round(Math.min(width, height) * 0.34);
  const mark = await sharp(transparentMark)
    .resize(markBox, markBox, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: LIGHT_BACKGROUND },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function createIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const directory = Buffer.alloc(pngs.length * 16);
  let offset = header.length + directory.length;
  pngs.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...pngs.map(({ data }) => data)]);
}

export async function generateIcons({ root = DEFAULT_ROOT } = {}) {
  const lightSource = await loadApprovedSource(
    join(root, "assets", "brand", "logo-light-source.png"),
  );
  const darkSource = await loadApprovedSource(
    join(root, "assets", "brand", "logo-dark-source.png"),
  );

  await writeOutput(
    join(root, "public", "brand", "logo-light.webp"),
    await renderUiLogo(lightSource),
  );
  await writeOutput(
    join(root, "public", "brand", "logo-dark.webp"),
    await renderUiLogo(darkSource),
  );

  const favicon16 = await renderInstalledIcon(lightSource, 16, { palette: true });
  const favicon32 = await renderInstalledIcon(lightSource, 32, { palette: true });
  const webIcons = [
    ["favicon-16.png", favicon16],
    ["favicon-32.png", favicon32],
    ["icon-192.png", await renderInstalledIcon(lightSource, 192)],
    ["icon-512.png", await renderInstalledIcon(lightSource, 512)],
    ["icon-maskable-192.png", await renderInstalledIcon(lightSource, 192)],
    ["icon-maskable-512.png", await renderInstalledIcon(lightSource, 512)],
    ["apple-touch-icon.png", await renderInstalledIcon(lightSource, 180)],
  ];
  for (const [name, data] of webIcons) {
    await writeOutput(join(root, "public", "icons", name), data);
  }
  await writeOutput(
    join(root, "public", "favicon.ico"),
    createIco([
      { size: 16, data: favicon16 },
      { size: 32, data: favicon32 },
    ]),
  );

  const installed1024 = await renderInstalledIcon(lightSource, 1024);
  const foreground1024 = await renderTransparentMark(lightSource, 1024);
  const background1024 = await renderSolid(1024);
  await writeOutput(join(root, "assets", "icon-only.png"), installed1024);
  await writeOutput(join(root, "assets", "icon-foreground.png"), foreground1024);
  await writeOutput(join(root, "assets", "icon-background.png"), background1024);

  for (const [density, size] of Object.entries(ANDROID_LAUNCHER_SIZES)) {
    const folder = join(root, "android", "app", "src", "main", "res", `mipmap-${density}`);
    await writeOutput(
      join(folder, "ic_launcher.png"),
      await renderInstalledIcon(lightSource, size),
    );
    await writeOutput(
      join(folder, "ic_launcher_round.png"),
      await renderRoundIcon(lightSource, size),
    );
    await writeOutput(join(folder, "ic_launcher_background.png"), await renderSolid(size));
    await writeOutput(
      join(folder, "ic_launcher_foreground.png"),
      await sharp(foreground1024)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    );
  }

  const androidRes = join(root, "android", "app", "src", "main", "res");
  for (const [relativePath, [width, height]] of Object.entries(ANDROID_SPLASH_SIZES)) {
    await writeOutput(
      join(androidRes, relativePath),
      await renderSplash(foreground1024, width, height),
    );
  }

  await writeOutput(
    join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"),
    installed1024,
  );
  const iosSplash = await renderSplash(foreground1024, 2732, 2732);
  for (const name of IOS_SPLASH_NAMES) {
    await writeOutput(
      join(root, "ios", "App", "App", "Assets.xcassets", "Splash.imageset", name),
      iosSplash,
    );
  }

  await rm(join(root, "public", "favicon.svg"), { force: true });
  await rm(join(root, "assets", "icon.svg"), { force: true });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await generateIcons();
  console.log("[icons] generated themed UI, favicon, PWA, Android, and iOS assets");
}
