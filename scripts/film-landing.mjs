/**
 * فیلمِ واقعی از خودِ برنامه، برای صفحه‌ی معرفی.
 *
 *   node scripts/film-landing.mjs            (نیاز: dev server روی :5180)
 *   node scripts/film-landing.mjs timer      (فقط یک صحنه)
 *
 * تفاوتش با `shoot-landing.mjs`: آن یک قابِ ثابت می‌گیرد، این با برنامه **کار
 * می‌کند** — تیک می‌زند، تایمر را راه می‌اندازد، حال‌وهوا انتخاب می‌کند — و از
 * همان لحظه‌ها فریم می‌گیرد. چیزی شبیه‌سازی نمی‌شود؛ هرچه در فایل می‌بینی واقعاً
 * روی صفحه اتفاق افتاده.
 *
 * چرا WebP متحرک و نه ویدیو؟ چون playwright فقط WebM/VP8 می‌دهد و سافاری و iOS
 * با آن خوب نیستند، و برای تبدیل به MP4 به ffmpeg نیاز بود که روی این سیستم
 * نصب نیست. WebP متحرک از سافاری ۱۴ به بعد همه‌جا کار می‌کند، با sharp که از
 * قبل در پروژه هست ساخته می‌شود، و اگر مرورگری انیمیشن را اجرا نکند خودش
 * فریمِ اول را نشان می‌دهد. یعنی حالتِ خرابش هم قابل قبول است.
 *
 * کنار هر کلیپ یک `-still.webp` هم نوشته می‌شود: همان فریمِ اول، برای کسی که
 * `prefers-reduced-motion` روشن دارد.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/* قابِ گوشی، همان اندازه‌ای که اپ در آن رندر می‌شود. */
const PHONE = { width: 402, height: 874 };

/**
 * اندازه‌ی خودِ کلیپ، کوچک‌تر از قابِ ضبط.
 *
 * دو دلیل: روی سایت با عرضِ ~۲۸۰ پیکسل دیده می‌شود پس ۳۲۰ کافی‌ست، و مهم‌تر
 * اینکه کدگذارِ WebP متحرک کلِ انیمیشن را با هم در حافظه نگه می‌دارد. با
 * ۴۰۲×۸۷۴ و ۲۶ فریم (۲۷ مگابایت خام) کنارِ کرومِ باز، libvips کم می‌آورد و
 * **بی‌صدا** فقط ۵-۶ فریم می‌نوشت؛ هر بار هم یک عدد. اینجا ۴۰٪ کمتر است و
 * assertِ پایینِ همین تابع هم اگر باز کم بنویسد بیلد را می‌شکند.
 */
const CLIP = { width: 320, height: 696 };
const FPS = 12;
const FRAME_MS = Math.round(1000 / FPS);

// کشِ libvips اینجا فقط حافظه می‌خورد؛ هر فریم یک بار خوانده می‌شود.
sharp.cache(false);
sharp.concurrency(1);

/**
 * صحنه‌ها. هرکدام یک `act` دارد که با صفحه کار می‌کند و بین کارهایش
 * `shoot()` صدا می‌زند تا فریم بیفتد.
 *
 * `hold(ms)` یعنی «همین‌طور فیلم بگیر و کاری نکن» — برای وقتی که خودِ برنامه
 * دارد انیمیشنش را اجرا می‌کند و ما فقط تماشاچی هستیم.
 */
const SCENES = [
  {
    name: "today",
    path: "/app/",
    /**
     * قصه‌ی صحنه: یک کار را تیک می‌زنیم، می‌رویم پایین سراغ عادت‌ها، آن را هم
     * تیک می‌زنیم، و برمی‌گردیم بالا تا حلقه‌ی درصدِ روز را بالاتر ببینیم.
     *
     * چرا این‌قدر پیچیده؟ چون کار و عادت دقیقاً یک‌جور دکمه دارند
     * (`h-10 w-10 rounded-full border-2`) و کارها در DOM جلوترند؛ سلکتورِ ساده
     * همیشه کار را می‌گرفت و حلقه هیچ‌وقت تکان نمی‌خورد. پس بخشِ عادت‌ها را با
     * عنوانش جدا می‌کنیم. `border-border` هم یعنی «هنوز تیک نخورده».
     */
    async act({ hold, tap, scroll }) {
      await hold(400);
      await tap("button.h-10.w-10.border-border");
      await hold(650);
      await scroll(380, 650);
      await tap('section:has-text("عادت‌های امروز") button.h-10.w-10.border-border');
      // تیکِ عادت، پنجره‌ی تبریکِ خودِ برنامه را می‌آورد («۷۰٪ راه رو رفتی!»).
      // این را عمداً نگه داشته‌ایم چون بهترین لحظه‌ی محصول است؛ ولی باید بسته
      // شود، وگرنه کلیپ روی یک پس‌زمینه‌ی تارِ ناخوانا تمام می‌شود و پنجره
      // اجازه‌ی اسکرول هم نمی‌دهد که حلقه‌ی بالا رفته را نشان بدهیم.
      await hold(1400);
      await tap('button:has-text("ادامه بده")', { fallback: '[aria-label="بستن"]' });
      await hold(500);
      await scroll(-380, 550);
      await hold(1000);
    },
  },
  {
    name: "habits",
    path: "/app/habits",
    async act({ hold, scroll }) {
      await hold(500);
      await scroll(420, 1300);
      await hold(400);
    },
  },
  {
    name: "timer",
    path: "/app/timer",
    /**
     * هم کرونومتر و پومودورو را نشان می‌دهد هم تایمر را راه می‌اندازد.
     *
     * فقط «شروع زدن» کافی نبود: هر دو حالت ثانیه‌به‌ثانیه جلو می‌روند، یعنی در
     * ۲.۶ ثانیه فقط سه عدد عوض می‌شد و کلیپ خواب‌آلود درمی‌آمد. عوض‌کردنِ حالت
     * کلِ چیدمان را تغییر می‌دهد و همان حرکتی‌ست که صحنه لازم داشت.
     * دکمه‌ی شروع فقط aria-label دارد (آیکونِ تنهاست)، پس از همان می‌گیریمش.
     */
    async act({ hold, tap }) {
      await hold(350);
      await tap('button:has-text("کرونومتر")');
      await hold(700);
      await tap('button:has-text("پومودورو")');
      await hold(600);
      await tap('[aria-label="شروع"]', { fallback: '[aria-label="Start"]' });
      await hold(2100);
    },
  },
  {
    name: "journal",
    path: "/app/journal",
    async act({ hold, scroll }) {
      await hold(500);
      await scroll(340, 1200);
      await hold(400);
    },
  },
  {
    name: "analytics",
    // نمودارها موقع سوارشدن خودشان رشد می‌کنند، پس اینجا تقریباً صبر نمی‌کنیم
    // وگرنه تا دوربین برسد کار تمام شده و یک نمودارِ ثابت فیلم می‌شود.
    path: "/app/analytics",
    settle: 120,
    async act({ hold, scroll }) {
      await hold(1600);
      await scroll(460, 1300);
      await hold(400);
    },
  },
];

function pick() {
  const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!want.length) return SCENES;
  const got = SCENES.filter((s) => want.includes(s.name));
  const bad = want.filter((w) => !SCENES.some((s) => s.name === w));
  if (bad.length)
    throw new Error(
      `صحنه‌ای به اسم ${bad.join("، ")} نداریم. موجود: ${SCENES.map((s) => s.name).join("، ")}`,
    );
  return got;
}

/**
 * فریم‌های خام را به یک WebP متحرک تبدیل می‌کند.
 *
 * دو تله اینجا هست که هر دو **بی‌صدا** خراب می‌کنند، پس با assert گرفته‌شان‌ایم:
 *   ۱. `pageHeight` باید داخل `raw` باشد نه کنارش. بیرون که بگذاری، sharp یک
 *      تصویرِ بلندِ ثابت می‌سازد و هیچ خطایی نمی‌دهد.
 *   ۲. اگر اندازه‌ی یک فریم با بقیه فرق کند، `Buffer.concat` طولش با آنچه
 *      اعلام کرده‌ایم نمی‌خواند و sharp فقط بخشی از فریم‌ها را می‌نویسد —
 *      یعنی کلیپِ ۲۶ فریمی بی‌سروصدا ۵ فریمه بیرون می‌آید.
 */
async function encode(frames, file, { width, height }) {
  const per = width * height * 3;
  const odd = frames.findIndex((f) => f.length !== per);
  if (odd !== -1)
    throw new Error(
      `فریم ${odd} اندازه‌اش ${frames[odd].length} بایت است ولی باید ${per} باشد ` +
        `(${width}×${height}×3). یعنی اسکرین‌شات با viewport یکی نیست.`,
    );

  const strip = Buffer.concat(frames);
  if (process.env.FILM_DEBUG) {
    console.log(
      `  [debug] frames=${frames.length} per=${per} strip=${strip.length} ` +
        `declared=${width * height * frames.length * 3} match=${strip.length === width * height * frames.length * 3}`,
    );
    writeFileSync(file + ".raw", strip);
  }
  await sharp(strip, {
    raw: { width, height: height * frames.length, channels: 3, pageHeight: height },
  })
    .webp({ quality: 70, effort: 5, loop: 0, delay: FRAME_MS })
    .toFile(file);

  /**
   * فریم‌های پشت‌سرهمِ یکسان را کدگذارِ WebP در هم ادغام می‌کند و به‌جایش مدتِ
   * فریمِ قبلی را بلندتر می‌کند. پس `pages` کمتر از تعدادِ عکس‌ها طبیعی‌ست و
   * خودش فشرده‌سازی است، نه خرابی.
   *
   * ولی همین عدد یک سنجه‌ی خوب است: اگر خیلی کم باشد یعنی صفحه تکان نخورده و
   * ما داریم از یک تصویرِ ثابت «فیلم» می‌گیریم — که دقیقاً همان اشتباهی بود که
   * اول کردیم و کلیک‌هایمان به هدف نمی‌خورد.
   */
  const pages = (await sharp(file, { animated: true }).metadata()).pages;
  if (pages < 4)
    throw new Error(
      `کلیپ فقط ${pages} فریمِ متمایز دارد از ${frames.length} عکس — یعنی صفحه تکان نخورده. ` +
        `احتمالاً سلکتورِ کلیک به هدف نخورده.`,
    );
  return { bytes: readFileSync(file).length, pages };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scenes = pick();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const written = [];

  for (const s of scenes) {
    const ctx = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 1,
      locale: "fa-IR",
      colorScheme: "dark",
      reducedMotion: "no-preference", // انیمیشن‌های خودِ اپ باید بیفتند
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(signedInFor("dark"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(demoScript());
    await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(s.settle ?? 1200); // نشستنِ صفحه قبل از شروعِ ضبط

    const frames = [];
    const shoot = async () => {
      const png = await page.screenshot({ type: "png" });
      frames.push(
        await sharp(png)
          .resize(CLIP.width, CLIP.height, { fit: "fill" })
          .removeAlpha()
          .raw()
          .toBuffer(),
      );
    };
    /** به‌اندازه‌ی ms فیلم بگیر بدون اینکه کاری بکنی. */
    const hold = async (ms) => {
      const n = Math.max(1, Math.round(ms / FRAME_MS));
      for (let i = 0; i < n; i++) await shoot();
    };
    /** اگر سلکتور نبود، صحنه نباید بشکند — فقط همان لحظه فیلم می‌گیریم. */
    const tap = async (sel, { fallback } = {}) => {
      for (const q of [sel, fallback].filter(Boolean)) {
        const el = page.locator(q).first();
        if (await el.count().catch(() => 0)) {
          await el.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
      }
      return false;
    };
    const tapText = async (words) => {
      for (const w of words) {
        const el = page.getByText(new RegExp(w, "i")).first();
        if (await el.count().catch(() => 0)) {
          await el.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
      }
      return false;
    };
    const scroll = async (dy, ms) => {
      const steps = Math.max(1, Math.round(ms / FRAME_MS));
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, dy / steps);
        await shoot();
      }
    };

    await s.act({ page, hold, tap, tapText, scroll, shoot });

    const clip = join(OUT, `clip-${s.name}.webp`);
    const { bytes, pages } = await encode(frames, clip, CLIP);

    // فریمِ اول، جدا، برای prefers-reduced-motion
    const still = join(OUT, `clip-${s.name}-still.webp`);
    await sharp(frames[0], { raw: { width: CLIP.width, height: CLIP.height, channels: 3 } })
      .webp({ quality: 80 })
      .toFile(still);

    written.push([`clip-${s.name}.webp`, bytes, `${frames.length} عکس → ${pages} فریم`]);
    written.push([`clip-${s.name}-still.webp`, readFileSync(still).length, "ثابت"]);
    await ctx.close();
  }

  await browser.close();
  const kb = (n) => (n / 1024).toFixed(1) + "KB";
  console.log("[film-landing] " + OUT);
  for (const [f, n, fr] of written)
    console.log("  " + f.padEnd(28) + kb(n).padStart(9) + "  " + fr);
  console.log("  total " + kb(written.reduce((a, [, n]) => a + n, 0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
