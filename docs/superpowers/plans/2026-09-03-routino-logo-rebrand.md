# Routino Logo Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every user-facing Routino logo, launcher icon, favicon, and native splash with the approved light/dark artwork while keeping the static installed icon light and the favicon small.

**Architecture:** `assets/brand/` holds the two immutable 1254px source PNGs. A single deterministic Sharp pipeline in `scripts/generate-icons.mjs` creates optimized UI logos, tiny favicons, PWA icons, Android legacy/adaptive icons, iOS AppIcon, and native splash assets. The React `Logo` primitive selects light/dark artwork from the app's `.dark` class, while the always-dark public pages explicitly use the dark asset.

**Tech Stack:** Node.js ESM, Sharp, React 19, Tailwind CSS 4, Vitest/JSDOM, Vite PWA, Capacitor Android/iOS assets.

## Global Constraints

- Preserve the exact ring/check geometry and colors of the supplied images; do not redraw or AI-regenerate the mark.
- Use the light artwork for the fixed favicon, PWA icon, Android/iOS launcher icon, and native splash.
- Use the light artwork in the app's light theme and the dark artwork in the app's dark theme.
- Keep favicons bounded to 16px/32px PNG plus a compact ICO; do not embed a large raster in SVG.
- Never hand-edit `dist/` or `www/`.
- Do not change backend, payments, auth, sync, persistence, product copy, or unrelated layout.
- Do not deploy, publish to stores, or build a release APK.

---

### Task 1: Lock the deterministic asset contract with failing tests

**Files:**
- Create: `scripts/generate-icons.test.mjs`
- Modify: `scripts/generate-icons.mjs`
- Test: `scripts/generate-icons.test.mjs`

**Interfaces:**
- Consumes: source files `assets/brand/logo-light-source.png` and `assets/brand/logo-dark-source.png`.
- Produces: exported `generateIcons({ root }: { root?: string }): Promise<void>` for isolated tests and CLI execution.

- [ ] **Step 1: Write the failing generator test**

Create a temporary root, copy both source PNGs into `assets/brand/`, call `generateIcons({ root: sandbox })`, and assert the exact public/native output contract:

```js
import { generateIcons } from "./generate-icons.mjs";

await generateIcons({ root: sandbox });

const expected = [
  ["public/brand/logo-light.webp", 256, 256],
  ["public/brand/logo-dark.webp", 256, 256],
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
];
```

For each output, inspect with `sharp(file).metadata()`. Also assert:

```js
assert.ok(statSync(join(sandbox, "public/icons/favicon-16.png")).size <= 6 * 1024);
assert.ok(statSync(join(sandbox, "public/icons/favicon-32.png")).size <= 12 * 1024);
assert.ok(statSync(join(sandbox, "public/favicon.ico")).size <= 24 * 1024);
```

Verify that all five Android launcher density folders and all existing Android/iOS splash paths are regenerated with their pre-existing pixel dimensions.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run scripts/generate-icons.test.mjs
```

Expected: FAIL because `generateIcons` is not exported and the new brand outputs do not exist.

- [ ] **Step 3: Add an import-safe generator entry point**

Refactor the script without changing output yet:

```js
export async function generateIcons({ root = DEFAULT_ROOT } = {}) {
  // generation jobs live here
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  await generateIcons();
}
```

- [ ] **Step 4: Run the focused test and confirm it still fails for outputs**

Run `npx vitest run scripts/generate-icons.test.mjs`.

Expected: FAIL on the first missing `public/brand/logo-light.webp`, proving the test reaches the new interface.

- [ ] **Step 5: Commit the RED contract**

```powershell
git add scripts/generate-icons.mjs scripts/generate-icons.test.mjs
git commit -m "test: define Routino brand asset contract"
```

---

### Task 2: Implement the high-quality source-to-assets pipeline

**Files:**
- Create: `assets/brand/logo-light-source.png`
- Create: `assets/brand/logo-dark-source.png`
- Modify: `scripts/generate-icons.mjs`
- Delete: `assets/icon.svg`
- Delete: `public/favicon.svg`
- Generate: `public/brand/logo-light.webp`
- Generate: `public/brand/logo-dark.webp`
- Generate: `public/icons/*.png`
- Generate: `public/favicon.ico`
- Generate: `assets/icon-only.png`
- Generate: `assets/icon-background.png`
- Generate: `assets/icon-foreground.png`
- Generate: `android/app/src/main/res/**/ic_launcher*.png`
- Generate: `android/app/src/main/res/**/splash.png`
- Generate: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- Generate: `ios/App/App/Assets.xcassets/Splash.imageset/*.png`
- Test: `scripts/generate-icons.test.mjs`

**Interfaces:**
- Consumes: approved source PNGs copied byte-for-byte into `assets/brand/`.
- Produces: `generateIcons({ root })`, UI brand WebPs, favicon/PWA PNGs, compact ICO, and all committed native assets.

- [ ] **Step 1: Copy the approved sources without altering them**

```powershell
New-Item -ItemType Directory -Force assets\brand
Copy-Item -LiteralPath 'C:\Users\User\Downloads\ChatGPT Image Sep 3, 2026, 06_14_03 PM.png' -Destination 'assets\brand\logo-light-source.png'
Copy-Item -LiteralPath 'C:\Users\User\Downloads\ChatGPT Image Sep 3, 2026, 06_19_34 PM.png' -Destination 'assets\brand\logo-dark-source.png'
```

- [ ] **Step 2: Implement fixed, reproducible framing**

Use the same 974px square crop for both theme variants, centered around the approved mark:

```js
const UI_CROP = { left: 140, top: 110, width: 974, height: 974 };

const uiLogo = (source) =>
  sharp(source)
    .extract(UI_CROP)
    .resize(256, 256, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.45 })
    .webp({ quality: 94, smartSubsample: true });
```

Use the full 1254px light source for installed-icon safe-zone outputs, resizing with Lanczos and mild sharpening. Keep normal icons opaque. Build adaptive foreground from the light mark with its near-white background removed deterministically, then composite it over a pure light background for legacy previews.

- [ ] **Step 3: Implement compact favicon and ICO output**

Generate 16px and 32px optimized PNGs from the light installed-icon image:

```js
const faviconPng = (size) =>
  installedIcon.clone().resize(size, size, { kernel: sharp.kernel.lanczos3 }).png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: true,
    quality: 92,
  });
```

Write a minimal ICO container whose two directory entries embed those PNG buffers. Do not keep or generate `public/favicon.svg`.

- [ ] **Step 4: Generate native launcher and splash matrices**

Preserve the current Android output dimensions by mapping density to sizes:

```js
const ANDROID_LAUNCHER = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
```

For every existing Android `splash.png`, read its current dimensions and replace the pixels with a light background plus the approved light mark centered at 25% of the shorter edge. Generate the iOS AppIcon at 1024² and all three iOS splash files at 2732² with the same light treatment.

- [ ] **Step 5: Run the generator and focused test**

```powershell
npm run icons
npx vitest run scripts/generate-icons.test.mjs
```

Expected: PASS; both source files remain 1254×1254; every target dimension matches; favicon size budgets pass.

- [ ] **Step 6: Inspect representative generated images**

Open these files at original resolution:

```text
public/brand/logo-light.webp
public/brand/logo-dark.webp
public/icons/favicon-32.png
public/icons/icon-maskable-512.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
android/app/src/main/res/drawable-port-xxxhdpi/splash.png
ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

Acceptance: no old orange-tile mark, no clipped ring/check, balanced padding, no visible seam in the adaptive icon, and no sharpening halo.

- [ ] **Step 7: Commit the asset pipeline**

```powershell
git add assets public scripts/generate-icons.mjs scripts/generate-icons.test.mjs android/app/src/main/res ios/App/App/Assets.xcassets
git commit -m "feat: generate new Routino brand assets"
```

---

### Task 3: Switch every web and in-app logo reference

**Files:**
- Create: `src/components/ui-logo.test.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `index.html`
- Modify: `vite.config.ts`
- Modify: `landing/index.template.html`
- Modify: `landing/legal.template.html`
- Modify: `scripts/build-landing.mjs`
- Modify: `scripts/build-landing.test.mjs`
- Test: `src/components/ui-logo.test.tsx`
- Test: `scripts/build-landing.test.mjs`

**Interfaces:**
- Consumes: `public/brand/logo-light.webp`, `public/brand/logo-dark.webp`, `public/icons/favicon-16.png`, `public/icons/favicon-32.png`, and `public/favicon.ico` from Task 2.
- Produces: theme-aware `Logo({ className?: string })` and explicit dark-brand references on public pages.

- [ ] **Step 1: Write failing theme and landing tests**

Render `Logo` to static HTML and require both images and theme classes:

```tsx
const html = renderToStaticMarkup(<Logo className="h-8 w-8" />);
expect(html).toContain("brand/logo-light.webp");
expect(html).toContain("brand/logo-dark.webp");
expect(html).toContain("dark:hidden");
expect(html).toContain("dark:block");
expect(html).toContain("h-8 w-8");
```

Update the landing sandbox inputs and assert generated home/legal HTML references `/brand/logo-dark.webp`, while favicon links reference `/icons/favicon-32.png` and `/favicon.ico` and contain no `favicon.svg`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npx vitest run src/components/ui-logo.test.tsx scripts/build-landing.test.mjs
```

Expected: FAIL because `Logo` and public templates still use `favicon.svg`.

- [ ] **Step 3: Implement the theme-aware React primitive**

Keep callers unchanged by applying their sizing class to the wrapper:

```tsx
export function Logo({ className }: { className?: string }) {
  const base = import.meta.env.BASE_URL;
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-[22%]", className)}
    >
      <img src={`${base}brand/logo-light.webp`} alt="" className="h-full w-full object-cover dark:hidden" />
      <img src={`${base}brand/logo-dark.webp`} alt="" className="hidden h-full w-full object-cover dark:block" />
    </span>
  );
}
```

- [ ] **Step 4: Replace favicon and public-page references**

Remove the SVG favicon link from `index.html`, retain 16/32 PNG links, and add `%BASE_URL%favicon.ico`. Update Vite's `includeAssets` to include `favicon.ico`, `brand/*.webp`, and `icons/*.png`.

Change all three visible public-page logos to `/brand/logo-dark.webp`. Replace `copyLogo()` with `copyBrandAssets()` that copies the dark WebP, favicon PNGs, and ICO into the landing output without copying any old SVG.

- [ ] **Step 5: Run focused tests and build the landing**

```powershell
npx vitest run src/components/ui-logo.test.tsx scripts/build-landing.test.mjs
npm run build:landing
```

Expected: PASS; generated public HTML has only new dark-logo references and compact favicon references.

- [ ] **Step 6: Commit the consuming UI changes**

```powershell
git add src/components/ui.tsx src/components/ui-logo.test.tsx index.html vite.config.ts landing scripts/build-landing.mjs scripts/build-landing.test.mjs
git commit -m "feat: apply themed Routino logo across web surfaces"
```

---

### Task 4: Update documentation and verify every shipped surface

**Files:**
- Modify: `docs-fa/CODEBASE_GUIDE.md`
- Modify: `docs-fa/01-FRONTEND.md`
- Verify: all files changed by Tasks 1–3

**Interfaces:**
- Consumes: final asset pipeline and references.
- Produces: current Persian guidance and verification evidence; no deploy or release artifact.

- [ ] **Step 1: Update the two stale guide sections**

Document that `assets/brand/` contains approved light/dark sources, `npm run icons` regenerates web/PWA/native icon and splash outputs, `Logo` follows the app's `.dark` class, public pages use the dark mark, and installed icons/favicons remain light.

- [ ] **Step 2: Prove no old logo reference remains**

```powershell
rg -n "favicon\.svg|assets/icon\.svg|rounded orange tile|LOGO =|open progress ring" src public assets landing scripts index.html vite.config.ts docs-fa android ios
```

Expected: no live reference to the retired SVG/artwork; historical prose outside touched guides may remain only if clearly marked historical.

- [ ] **Step 3: Run formatting and focused tests**

```powershell
npx prettier --check scripts/generate-icons.mjs scripts/generate-icons.test.mjs src/components/ui.tsx src/components/ui-logo.test.tsx index.html vite.config.ts landing/index.template.html landing/legal.template.html scripts/build-landing.mjs scripts/build-landing.test.mjs docs-fa/CODEBASE_GUIDE.md docs-fa/01-FRONTEND.md
npx vitest run scripts/generate-icons.test.mjs src/components/ui-logo.test.tsx scripts/build-landing.test.mjs
```

Expected: all checks PASS.

- [ ] **Step 4: Run project-level verification**

```powershell
npm test
npm run build
npm run build:mobile
```

Expected: frontend tests PASS, web/landing build succeeds into generated `dist/`, and mobile build succeeds into generated `www/`.

- [ ] **Step 5: Perform one bounded visual QA pass**

Inspect the app at mobile and desktop widths in light and dark themes. Check the 32px mobile header, 40px desktop sidebar, 56px subscription/payment, and 64px splash/auth uses in one pass. Inspect the built landing header/footer/legal logo and representative PWA/native icons. Fix all discovered framing defects in one batch, then perform at most one confirmation pass.

- [ ] **Step 6: Commit docs and any bounded visual corrections**

```powershell
git add docs-fa/CODEBASE_GUIDE.md docs-fa/01-FRONTEND.md scripts src public assets landing index.html vite.config.ts android ios
git commit -m "docs: document Routino brand asset workflow"
```

- [ ] **Step 7: Report completion boundaries**

Report separately: source/code changed, automated checks passed, visual checks completed, and not performed (deploy, store publication, release APK, physical-device validation).
