/**
 * Generates every icon the web app needs.
 *
 *   npm run icons
 *
 * This script is the source of truth for the artwork, and writes
 * `assets/icon.svg` as a human-readable preview of what it produced.
 *
 * Why the artwork lives here rather than in a static .svg: the plain icon and
 * the Android maskable icon are NOT the same picture. The plain one is a rounded
 * tile. The maskable one must be full-bleed background with the logo inset into
 * a safe zone — compositing the rounded tile onto a background instead leaves a
 * visible seam where its corners meet the padding. Both need to be built from
 * one definition of the logo, or they drift apart.
 *
 * To rebrand: change BRAND, re-run. Committed output, not a build step — icons
 * change roughly never, and making `npm run build` depend on a native image
 * library is a bad trade.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}public/icons`;

const BRAND = { light: "#FB923C", dark: "#EA580C" };

/**
 * The mark: a routine is a cycle, and a habit is something you check off. So an
 * open progress ring (repetition, still going) with a check inside (done). It
 * reads at 16px, which a letterform would not.
 *
 * Pure paths, no <text>, deliberately: rasterisers resolve fonts through the OS,
 * so a text-based icon renders differently — or not at all — depending on what
 * happens to be installed.
 */
const LOGO = `
  <path d="M 352 118 A 168 168 0 1 0 424 256"
        fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" opacity="0.55" />
  <polygon points="424,182 456,250 392,250" fill="#fff" opacity="0.55" />
  <path d="M 178 258 L 234 314 L 342 206"
        fill="none" stroke="#fff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round" />
`;

const gradient = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND.light}" />
      <stop offset="1" stop-color="${BRAND.dark}" />
    </linearGradient>
  </defs>
`;

/** The app icon: a rounded tile. Radius ~22% approximates the platform squircle
 * closely enough to look intentional where the OS does not mask it. */
const tileSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${gradient}
  <rect width="512" height="512" rx="114" fill="url(#bg)" />
${LOGO}
</svg>`;

/**
 * The Android adaptive icon.
 *
 * Launchers mask this to their own shape — circle, squircle, teardrop — and can
 * clip ~20% off every edge. So the background runs corner to corner (the mask
 * needs something to bite into) and the logo is scaled into the middle 80% safe
 * zone. Handing Android the plain tile is what produces those icons that look
 * shaved along the sides.
 */
const maskableSvg = () => {
  const scale = 0.72; // a little inside the 80% safe zone; masks vary
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${gradient}
  <rect width="512" height="512" fill="url(#bg)" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">
${LOGO}
  </g>
</svg>`;
};

/**
 * Native launcher icon sources for @capacitor/assets (`npx @capacitor/assets generate`).
 * Same artwork as the web favicon, split into the layers Android's adaptive icon needs:
 *   - background: the full-bleed gradient (masks bite into it)
 *   - foreground: just the mark, inset into the adaptive safe zone (center ~60%), transparent
 *   - icon-only:  the rounded tile, for launchers/OSes without adaptive icons
 */
const backgroundSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
${gradient}
  <rect width="512" height="512" fill="url(#bg)" />
</svg>`;

const foregroundSvg = () => {
  const scale = 0.6; // inside Android's ~66% adaptive safe zone
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
  <g transform="translate(${offset} ${offset}) scale(${scale})">
${LOGO}
  </g>
</svg>`;
};

const render = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

await mkdir(out, { recursive: true });

const jobs = [
  // Chrome's installability minimum: a 192 and a 512.
  ["icon-192.png", render(tileSvg(), 192)],
  ["icon-512.png", render(tileSvg(), 512)],
  ["icon-maskable-192.png", render(maskableSvg(), 192)],
  ["icon-maskable-512.png", render(maskableSvg(), 512)],
  // iOS ignores manifest icons and reads this instead. It also does not honour
  // transparency, so the opaque tile is the right source.
  ["apple-touch-icon.png", render(tileSvg(), 180)],
  ["favicon-32.png", render(tileSvg(), 32)],
  ["favicon-16.png", render(tileSvg(), 16)],
];

for (const [name, work] of jobs) {
  await writeFile(`${out}/${name}`, await work);
  console.log(`  ✓ icons/${name}`);
}

// One SVG favicon covers modern browsers crisply at any size; the PNGs above are
// the fallback for those that don't support it.
await writeFile(`${root}public/favicon.svg`, tileSvg());
console.log("  ✓ favicon.svg");

// Preview of what was generated, so the artwork is reviewable in a diff.
await writeFile(`${root}assets/icon.svg`, tileSvg());
console.log("  ✓ assets/icon.svg (preview — generated, edit this script instead)");

// Native (Android/iOS) launcher icon sources, consumed by @capacitor/assets.
const nativeJobs = [
  ["assets/icon-background.png", render(backgroundSvg(), 1024)],
  ["assets/icon-foreground.png", render(foregroundSvg(), 1024)],
  ["assets/icon-only.png", render(tileSvg(), 1024)],
];
for (const [name, work] of nativeJobs) {
  await writeFile(`${root}${name}`, await work);
  console.log(`  ✓ ${name}`);
}
