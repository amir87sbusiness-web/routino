/**
 * عکس‌های واقعی از خودِ برنامه، برای صفحه‌ی معرفی.
 *
 *   node scripts/shoot-landing.mjs      (نیاز: dev server روی :5180)
 *
 * چرا اسکریپت و نه اسکرین‌شات دستی؟ چون هر بار که UI عوض شود باید دوباره گرفته
 * شوند، و دستی‌گرفتن یعنی بالاخره یک روز عکسِ نسخه‌ی قدیمی روی سایت می‌ماند.
 *
 * از Chrome نصب‌شده‌ی همین سیستم استفاده می‌کند (playwright-core مرورگر همراه
 * خودش ندارد) و خروجی را با sharp به WebP می‌دهد — هر دو از قبل در پروژه بودند.
 *
 * داده‌ی نمایشی مستقیم داخل IndexedDB نوشته می‌شود، چون دکمه‌ی «دادهٔ آزمایشی»
 * در تنظیمات با `SHOW_DEMO_SEED=false` خاموش است و آن یک پرچمِ محصول است، نه
 * چیزی که برای عکس گرفتن روشنش کنیم.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { demoScript, findChrome, signedInFor } from "./lib/app-seed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "landing", "shots");
const BASE = process.env.SHOT_BASE ?? "http://localhost:5180";

const CHROME = findChrome(existsSync);
if (!CHROME) throw new Error("هیچ مرورگری پیدا نشد — Chrome یا Edge لازم است");

/**
 * موبایل و لپ‌تاپ، و بیشترشان تم تاریک.
 *
 * تم از settings.theme در localStorage می‌آید (تنظیمِ مخصوصِ دستگاه)، نه از
 * prefers-color-scheme سیستم — پس همان را موقع seed می‌نشانیم، و colorScheme
 * مرورگر هم هماهنگ می‌شود تا اسکرول‌بار و پس‌زمینه‌ی خودِ مرورگر هم جور دربیاید.
 */
const PHONE = { w: 402, h: 874, kind: "phone" };
const DESK = { w: 1440, h: 900, kind: "desktop" };
const SHOTS = [
  // تاریک — نسخه‌ی اصلی که در صفحه‌ی معرفی نشان داده می‌شود
  { name: "today-dark", path: "/app/", theme: "dark", ...PHONE },
  { name: "habits-dark", path: "/app/habits", theme: "dark", ...PHONE },
  { name: "analytics-dark", path: "/app/analytics", theme: "dark", ...PHONE },
  { name: "timer-dark", path: "/app/timer", theme: "dark", ...PHONE },
  { name: "journal-dark", path: "/app/journal", theme: "dark", ...PHONE },
  { name: "desktop-dark", path: "/app/", theme: "dark", ...DESK },
  { name: "desktop-analytics-dark", path: "/app/analytics", theme: "dark", ...DESK },
  // روشن — چند تا برای اینکه معلوم باشد هر دو تم هست
  { name: "today", path: "/app/", theme: "light", ...PHONE },
  { name: "analytics", path: "/app/analytics", theme: "light", ...PHONE },
  { name: "desktop", path: "/app/", theme: "light", ...DESK },
];

/**
 * فیلترِ اسم، تا بشود فقط یک عکس را دوباره گرفت:
 *
 *     node scripts/shoot-landing.mjs timer-dark
 *
 * چرا مهم است؟ داده‌ی نمایشی تصادفی ساخته می‌شود، پس گرفتنِ دوباره‌ی همه یعنی
 * هر ۱۰ فایل عوض می‌شوند حتی اگر فقط یک صفحه تغییر کرده باشد. بدون آرگومان،
 * مثل قبل همه گرفته می‌شوند.
 */
function pickShots() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!wanted.length) return SHOTS;
  const picked = SHOTS.filter((s) => wanted.includes(s.name));
  const unknown = wanted.filter((w) => !SHOTS.some((s) => s.name === w));
  if (unknown.length)
    throw new Error(
      `عکسی به اسم ${unknown.join("، ")} نداریم. اسم‌های موجود: ${SHOTS.map((s) => s.name).join("، ")}`,
    );
  return picked;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const shots = pickShots();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const written = [];

  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 2, // رتینا — روی صفحه‌های امروزی تار نشود
      locale: "fa-IR",
      colorScheme: s.theme,
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(signedInFor(s.theme));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(demoScript());
    await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400); // انیمیشن‌ها و رندر نمودارها

    const png = await page.screenshot({ type: "png" });
    const file = join(OUT, `${s.name}.webp`);
    await sharp(png).webp({ quality: 82 }).toFile(file);
    written.push([`${s.name}.webp`, readFileSync(file).length]);
    await ctx.close();
  }

  await browser.close();
  const kb = (n) => (n / 1024).toFixed(1) + "KB";
  console.log("[shoot-landing] " + OUT);
  for (const [f, n] of written) console.log("  " + f.padEnd(24) + kb(n));
  console.log("  total " + kb(written.reduce((a, [, n]) => a + n, 0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
