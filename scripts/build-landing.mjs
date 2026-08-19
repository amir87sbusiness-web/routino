/**
 * می‌سازد: ریشه‌ی `dist/` — یعنی سایت عمومی routino.me
 *
 *   dist/index.html        صفحه‌ی معرفی محصول
 *   dist/legal/index.html  قوانین + حریم خصوصی + تماس
 *   dist/fonts/*.woff2     وزیرمتن (از node_modules، بدون CDN)
 *   dist/_redirects        SPA fallback برای /app/*
 *   dist/_headers          کنترل کش
 *
 * خودِ برنامه در `dist/app/` می‌نشیند و `vite build` می‌سازدش، پس این اسکریپت
 * باید بعد از آن اجرا شود (`npm run build` همین ترتیب را دارد) وگرنه
 * `emptyOutDir` خروجی این را پاک می‌کند.
 *
 * متنِ حقوقی از `src/lib/legal-text.json` می‌آید — همان ماژولی که اپ هم از آن
 * می‌خواند. یک منبع، دو مصرف‌کننده، بدون هیچ وابستگی تایپ‌اسکریپتی در بیلد.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "dist");

/** آدرسِ عمومی سایت. در متاتگ‌ها، sitemap و robots تکرار می‌شود، پس یک‌جا. */
const SITE = "https://routino.me";

/** HTML-escape. متن از ما می‌آید نه از کاربر، ولی یک `<` بی‌جا نباید صفحه را
 * خراب کند. کد اینماد عمداً از این مسیر رد نمی‌شود (باید عیناً درج شود). */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The APK is uploaded outside this repository. Until its final HTTPS URL is
 * known, the public page must show a real disabled button instead of a link
 * that goes nowhere. Keeping this renderer in the build step means adding the
 * cloud URL later needs no hand-edit inside the landing template.
 */
export function renderAndroidDownload(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    return (
      '          <button type="button" class="btn ghost soon" id="android-btn" disabled>\n' +
      '            <svg class="ic" aria-hidden="true"><use href="#i-droid" /></svg>\n' +
      '            دانلود اندروید <span class="tag">بعد از انتشار</span>\n' +
      "          </button>"
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ANDROID_DOWNLOAD_URL باید یک آدرس HTTPS معتبر باشد");
  }
  if (url.protocol !== "https:") {
    throw new Error("ANDROID_DOWNLOAD_URL باید با HTTPS شروع شود");
  }
  return (
    `          <a class="btn ghost" id="android-btn" href="${esc(url.href)}" rel="noreferrer">\n` +
    '            <svg class="ic" aria-hidden="true"><use href="#i-droid" /></svg>\n' +
    "            دانلود نسخه اندروید\n" +
    "          </a>"
  );
}

/** فارسیِ هر جفت [fa, en]. سایت عمومی فارسی‌ست؛ نسخه‌ی دوزبانه داخل خود اپ است. */
const fa = (pair) => pair[0];

/**
 * اعتبارسنجی متن حقوقی — اینجا، چون اینجا بیلد را می‌شکند.
 *
 * قبلاً این بررسی در `src/lib/legal-text.ts` بود و در زمان اجرا throw می‌کرد؛
 * نتیجه این بود که یک جفتِ ناقص در JSON کلِ صفحه‌ی تنظیمات را از کار می‌انداخت
 * و کاربر به «گرفتن پشتیبان» و «خروج از حساب» دسترسی نداشت. هیچ‌کدام از دو
 * بیلد هم آن را نمی‌گرفتند، پس داده‌ی خراب منتشر می‌شد.
 */
function validate(list, which) {
  list.forEach((sec, i) => {
    const where = `${which}[${i}] «${sec?.title?.[0] ?? "?"}»`;
    if (!Array.isArray(sec?.title) || sec.title.length !== 2)
      throw new Error(`legal-text.json: ${where} — title باید [فارسی, English] باشد`);
    if (!Array.isArray(sec?.paras)) throw new Error(`legal-text.json: ${where} — paras آرایه نیست`);
    sec.paras.forEach((p, j) => {
      if (!Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== "string" || !x.trim()))
        throw new Error(`legal-text.json: ${where} بند ${j + 1} — باید [فارسی, English] باشد`);
    });
  });
}

/** تلگرام/اینستاگرام از `legal-info.ts` — با regex، نه import، تا این
 * اسکریپت با node خالی اجرا شود و بیلد Cloudflare به ابزار تایپ‌اسکریپت نیاز
 * نداشته باشد. اگر شکل آن فایل عوض شد، اینجا با خطای صریح می‌ایستد. */
function readLegalInfo() {
  const src = readFileSync(join(ROOT, "src", "lib", "legal-info.ts"), "utf8");
  const pick = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    if (!m) throw new Error(`legal-info.ts: کلید ${key} پیدا نشد`);
    return m[1];
  };
  return {
    telegram: pick("telegram"),
    instagram: pick("instagram"),
    lastUpdatedFa: pick("lastUpdatedFa"),
  };
}

const renderSections = (list) =>
  list
    .map(
      (sec) =>
        `        <h3>${esc(fa(sec.title))}</h3>\n` +
        sec.paras.map((p) => `        <p>${esc(fa(p))}</p>`).join("\n"),
    )
    .join("\n");

/** وزیرمتن از خود پکیج پروژه — بدون CDN، بدون فونت بیرونی. عربی برای فارسی و
 * لاتین برای «Routino» و اعداد انگلیسی.
 *
 * چهار وزنِ عربی، چون سلسله‌مراتبِ صفحه‌ی اصلی را وزن می‌سازد نه اندازه‌ی تنها:
 * ۹۰۰ تیتر، ۷۰۰ برچسب و دکمه، ۵۰۰ متنِ پررنگ، ۴۰۰ بدنه. اگر وزنی اینجا نباشد
 * مرورگر بی‌صدا وزنِ نزدیک را چاق می‌کند و تیتر مصنوعی به‌نظر می‌رسد.
 * لاتین همان دو وزن می‌ماند؛ در این صفحه فقط برای «Routino» و اعداد است. */
const FONTS = [
  ["vazirmatn-arabic-400-normal.woff2", "vazirmatn-arabic-400.woff2"],
  ["vazirmatn-arabic-500-normal.woff2", "vazirmatn-arabic-500.woff2"],
  ["vazirmatn-arabic-700-normal.woff2", "vazirmatn-arabic-700.woff2"],
  ["vazirmatn-arabic-900-normal.woff2", "vazirmatn-arabic-900.woff2"],
  ["vazirmatn-latin-400-normal.woff2", "vazirmatn-latin-400.woff2"],
  ["vazirmatn-latin-700-normal.woff2", "vazirmatn-latin-700.woff2"],
];

function copyFonts() {
  const src = join(ROOT, "node_modules", "@fontsource", "vazirmatn", "files");
  const dest = join(OUT_DIR, "fonts");
  mkdirSync(dest, { recursive: true });
  let bytes = 0;
  for (const [from, to] of FONTS) {
    const p = join(src, from);
    copyFileSync(p, join(dest, to));
    bytes += readFileSync(p).length;
  }
  return bytes;
}

/**
 * لوگو را کنار صفحه‌های عمومی می‌گذارد.
 *
 * همان `public/favicon.svg` خودِ برنامه است، یعنی یک منبع برای هر دو: اگر روزی
 * لوگو عوض شد، سایت و اپ با هم عوض می‌شوند. صفحه‌ها به `/favicon.svg` اشاره
 * می‌کنند نه `/app/favicon.svg`، تا صفحه‌ی معرفی به خروجیِ بیلدِ اپ وابسته نباشد.
 */
function copyLogo() {
  const src = join(ROOT, "public", "favicon.svg");
  if (!existsSync(src)) throw new Error("public/favicon.svg نیست — لوگوی سایت از همان می‌آید");
  copyFileSync(src, join(OUT_DIR, "favicon.svg"));
  return statSync(src).size;
}

/** عکس‌های واقعیِ اپ که `scripts/shoot-landing.mjs` گرفته. اگر پوشه نبود، بیلد
 * می‌ایستد — صفحه‌ی معرفی بدون تصویرِ محصول یعنی یک صفحه‌ی نصفه، و بهتر است
 * همین‌جا بفهمیم تا اینکه سایت بی‌عکس منتشر شود.
 *
 * فقط عکس‌هایی کپی می‌شوند که واقعاً در HTML خروجی به آن‌ها ارجاع شده. قبلاً کلِ
 * پوشه کپی می‌شد و هر عکسی که از صفحه حذف شده بود (یا `shoot-landing` گرفته بود
 * ولی استفاده نمی‌شد) همچنان با سایت منتشر می‌شد. */
function copyShots(htmlPages) {
  const src = join(ROOT, "landing", "shots");
  if (!existsSync(src))
    throw new Error("landing/shots نیست — اول `node scripts/shoot-landing.mjs` را با dev server بالا اجرا کن");
  const available = readdirSync(src).filter((f) => f.endsWith(".webp"));
  if (!available.length) throw new Error("landing/shots خالی است");

  const used = new Set();
  for (const html of htmlPages) {
    for (const m of html.matchAll(/\/shots\/([A-Za-z0-9._-]+\.webp)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((f) => !available.includes(f));
  if (missing.length)
    throw new Error(`عکس‌های ارجاع‌شده در صفحه پیدا نشدند: ${missing.join("، ")}`);
  if (!used.size) throw new Error("هیچ عکسی در صفحه ارجاع نشده — قالب خراب است");

  const dest = join(OUT_DIR, "shots");
  // پاک‌سازی قبل از کپی: `vite build` فقط dist/app را خالی می‌کند، پس عکسی که
  // اسمش عوض شده یا حذف شده تا ابد در خروجی می‌ماند و همراه سایت منتشر می‌شود.
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  let bytes = 0;
  for (const f of used) {
    copyFileSync(join(src, f), join(dest, f));
    bytes += statSync(join(src, f)).size;
  }
  return { count: used.size, skipped: available.length - used.size, bytes };
}

/**
 * عکسِ پیش‌نمایشِ اشتراک‌گذاری، ۱۲۰۰×۶۳۰.
 *
 * چرا ساخته می‌شود و مستقیم به اسکرین‌شات لینک نمی‌دهیم؟ چون `desktop-dark.webp`
 * دو چیز دارد که برای پیش‌نمایش بد است: ۲۸۸۰×۱۸۰۰ است (نسبتِ اشتباه، حجمِ زیاد)
 * و webp است — تلگرام و واتساپ که بیشترین سهمِ اشتراکِ این لینک‌اند، همیشه webp
 * را رندر نمی‌کنند. `contain` روی زمینه‌ی برند، نه `cover`: با cover بالا و
 * پایینِ نمای اپ بریده می‌شد.
 */
async function makeOgImage() {
  const src = join(ROOT, "landing", "shots", "desktop-dark.webp");
  if (!existsSync(src)) throw new Error("shots/desktop-dark.webp نیست — عکسِ پیش‌نمایش از همان ساخته می‌شود");
  const out = join(OUT_DIR, "og.jpg");
  await sharp(src)
    .resize(1200, 630, { fit: "contain", background: "#0e0a08" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  return statSync(out).size;
}

/**
 * robots و sitemap.
 *
 * ⚠️ `public/robots.txt` وجود دارد ولی `vite build` آن را داخلِ `dist/app/`
 * می‌گذارد، و خزنده فقط `/robots.txt` را می‌خواند — یعنی تا امروز عملاً هیچ
 * robotsی نداشتیم. این یکی در ریشه می‌نشیند.
 *
 * `/app/` عمداً از ایندکس بیرون است: خودِ برنامه پشتِ ورود است و صفحه‌ی خالیِ
 * لودینگ ایندکس‌شدنی نیست. ASCII، مثل بقیه‌ی فایل‌های پیکربندی.
 */
function writeSeoFiles() {
  writeFileSync(
    join(OUT_DIR, "robots.txt"),
    ["User-agent: *", "Allow: /", "Disallow: /app/", "", `Sitemap: ${SITE}/sitemap.xml`, ""].join("\n"),
  );

  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(OUT_DIR, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>`,
      `  <url><loc>${SITE}/legal/</loc><lastmod>${today}</lastmod><priority>0.3</priority></url>`,
      "</urlset>",
      "",
    ].join("\n"),
  );
}

function fill(templateName, replacements) {
  const tpl = readFileSync(join(ROOT, "landing", templateName), "utf8");
  let out = tpl;
  for (const [token, value] of Object.entries(replacements)) {
    if (!out.includes(token)) throw new Error(`${templateName}: جای‌گاه ${token} پیدا نشد`);
    out = out.replace(token, value);
  }
  return out;
}

async function main() {
  const data = JSON.parse(readFileSync(join(ROOT, "src", "lib", "legal-text.json"), "utf8"));
  const { terms: TERMS, privacy: PRIVACY, enamadSeal: ENAMAD_SEAL } = data;
  validate(TERMS, "terms");
  validate(PRIVACY, "privacy");
  if (!ENAMAD_SEAL?.includes("trustseal.enamad.ir"))
    throw new Error("legal-text.json: مهر اینماد گم یا خراب شده");
  const info = readLegalInfo();

  mkdirSync(OUT_DIR, { recursive: true });

  // ── صفحه‌ی اصلی ──────────────────────────────────────────
  // مهر اینماد عیناً درج می‌شود، بدون escape — باید همان HTMLی باشد که صادر شده.
  const homeHtml = fill("index.template.html", {
    "<!--ANDROID-DOWNLOAD-->": renderAndroidDownload(process.env.ANDROID_DOWNLOAD_URL),
    "<!--ENAMAD-->": ENAMAD_SEAL,
  });
  writeFileSync(join(OUT_DIR, "index.html"), homeHtml);

  // ── صفحه‌ی قوانین ────────────────────────────────────────
  const legalBody =
    `      <section id="terms">\n` +
    `        <h2>قوانین و مقررات</h2>\n` +
    renderSections(TERMS) +
    `\n      </section>\n\n` +
    `      <section id="privacy">\n` +
    `        <h2>حریم خصوصی</h2>\n` +
    renderSections(PRIVACY) +
    `\n      </section>\n\n` +
    `      <section id="contact" class="contact">\n` +
    `        <h2>تماس با ما و پشتیبانی</h2>\n` +
     `        <p>تلگرام: <a class="lnk" href="https://t.me/${esc(info.telegram)}" target="_blank" rel="noreferrer">@${esc(info.telegram)}</a></p>\n` +
    `        <p>اینستاگرام: <a class="lnk" href="https://instagram.com/${esc(info.instagram)}" target="_blank" rel="noreferrer">@${esc(info.instagram)}</a></p>\n` +
    `      </section>`;

  // پوشه‌ای، نه legal.html — تا آدرس تمیزِ /legal/ کار کند.
  mkdirSync(join(OUT_DIR, "legal"), { recursive: true });
  const legalHtml = fill("legal.template.html", {
    "<!--LEGAL-->": legalBody,
    "<!--ENAMAD-->": ENAMAD_SEAL,
    "<!--UPDATED-->": `آخرین به‌روزرسانی: ${esc(info.lastUpdatedFa)}`,
  });
  writeFileSync(join(OUT_DIR, "legal", "index.html"), legalHtml);

  const fontBytes = copyFonts();
  const logoBytes = copyLogo();
  const shots = copyShots([homeHtml, legalHtml]);
  const ogBytes = await makeOgImage();
  writeSeoFiles();

  // ── پیکربندی Cloudflare Pages ───────────────────────────
  // ASCII only, deliberately. The first version of this file had Persian
  // comments and Cloudflare silently ignored the whole thing.
  writeFileSync(
    join(OUT_DIR, "_redirects"),
    [
      "# SPA fallback for the app only, never the public pages.",
      "# /app/habits is not a real file and must serve /app/index.html.",
      "# NOTE: the fallback that actually works in production is the Pages",
      "# Function in functions/app/[[path]].js — this rule never took effect.",
      "/app/* /app/index.html 200",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(OUT_DIR, "_headers"),
    [
      "# ASCII only, same reason as _redirects.",
      "# Anything with a stable name must not be cached, or users freeze on an",
      "# old version and never receive an update.",
      "/",
      "  Cache-Control: no-cache",
      "",
      "/legal/*",
      "  Cache-Control: no-cache",
      "",
      "/app/index.html",
      "  Cache-Control: no-cache",
      "",
      "/app/sw.js",
      "  Cache-Control: no-cache",
      "",
      "/app/manifest.webmanifest",
      "  Cache-Control: no-cache",
      "",
      "# Fonts are content-hashed by name here only by convention, so revalidate.",
      "/fonts/*",
      "  Cache-Control: public, max-age=604800",
      "",
      "/app/assets/*",
      "  Cache-Control: no-cache",
      "",
    ].join("\n"),
  );

  const kb = (n) => (n / 1024).toFixed(1) + "KB";
  console.log(
    `[build-landing] dist/index.html + dist/legal/index.html  ` +
      `(${TERMS.length} بند قوانین، ${PRIVACY.length} بند حریم خصوصی، فونت ${kb(fontBytes)}، لوگو ${kb(logoBytes)}، ` +
      `${shots.count} عکس ${kb(shots.bytes)}` +
      (shots.skipped ? `، ${shots.skipped} عکسِ بی‌استفاده کپی نشد` : "") +
      `، og.jpg ${kb(ogBytes)}، robots.txt + sitemap.xml)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
