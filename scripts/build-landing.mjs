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
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "dist");

/** HTML-escape. متن از ما می‌آید نه از کاربر، ولی یک `<` بی‌جا نباید صفحه را
 * خراب کند. کد اینماد عمداً از این مسیر رد نمی‌شود (باید عیناً درج شود). */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

/** ایمیل/تلگرام/اینستاگرام از `legal-info.ts` — با regex، نه import، تا این
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
    email: pick("email"),
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

/** وزیرمتن از خود پکیج پروژه — بدون CDN، بدون فونت بیرونی. فقط دو وزنی که
 * صفحه‌های عمومی لازم دارند (۴۰۰ و ۷۰۰)، عربی برای فارسی و لاتین برای «Routino»
 * و اعداد انگلیسی. */
const FONTS = [
  ["vazirmatn-arabic-400-normal.woff2", "vazirmatn-arabic-400.woff2"],
  ["vazirmatn-arabic-700-normal.woff2", "vazirmatn-arabic-700.woff2"],
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

/** عکس‌های واقعیِ اپ که `scripts/shoot-landing.mjs` گرفته. اگر پوشه نبود، بیلد
 * می‌ایستد — صفحه‌ی معرفی بدون تصویرِ محصول یعنی یک صفحه‌ی نصفه، و بهتر است
 * همین‌جا بفهمیم تا اینکه سایت بی‌عکس منتشر شود. */
function copyShots() {
  const src = join(ROOT, "landing", "shots");
  if (!existsSync(src))
    throw new Error("landing/shots نیست — اول `node scripts/shoot-landing.mjs` را با dev server بالا اجرا کن");
  const dest = join(OUT_DIR, "shots");
  // پاک‌سازی قبل از کپی: `vite build` فقط dist/app را خالی می‌کند، پس عکسی که
  // اسمش عوض شده یا حذف شده تا ابد در خروجی می‌ماند و همراه سایت منتشر می‌شود.
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  let bytes = 0;
  const names = readdirSync(src).filter((f) => f.endsWith(".webp"));
  if (!names.length) throw new Error("landing/shots خالی است");
  for (const f of names) {
    copyFileSync(join(src, f), join(dest, f));
    bytes += statSync(join(src, f)).size;
  }
  return { count: names.length, bytes };
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

function main() {
  const data = JSON.parse(readFileSync(join(ROOT, "src", "lib", "legal-text.json"), "utf8"));
  const { terms: TERMS, privacy: PRIVACY, enamadSeal: ENAMAD_SEAL } = data;
  validate(TERMS, "terms");
  validate(PRIVACY, "privacy");
  if (!ENAMAD_SEAL?.includes("trustseal.enamad.ir"))
    throw new Error("legal-text.json: مهر اینماد گم یا خراب شده");
  const info = readLegalInfo();

  mkdirSync(OUT_DIR, { recursive: true });

  // ── صفحه‌ی اصلی ──────────────────────────────────────────
  writeFileSync(
    join(OUT_DIR, "index.html"),
    // مهر اینماد عیناً درج می‌شود، بدون escape — باید همان HTMLی باشد که صادر شده.
    fill("index.template.html", { "<!--ENAMAD-->": ENAMAD_SEAL }),
  );

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
    `        <p>ایمیل: <a class="lnk" href="mailto:${esc(info.email)}">${esc(info.email)}</a></p>\n` +
    `        <p>تلگرام: <a class="lnk" href="https://t.me/${esc(info.telegram)}" target="_blank" rel="noreferrer">@${esc(info.telegram)}</a></p>\n` +
    `        <p>اینستاگرام: <a class="lnk" href="https://instagram.com/${esc(info.instagram)}" target="_blank" rel="noreferrer">@${esc(info.instagram)}</a></p>\n` +
    `      </section>`;

  // پوشه‌ای، نه legal.html — تا آدرس تمیزِ /legal/ کار کند.
  mkdirSync(join(OUT_DIR, "legal"), { recursive: true });
  writeFileSync(
    join(OUT_DIR, "legal", "index.html"),
    fill("legal.template.html", {
      "<!--LEGAL-->": legalBody,
      "<!--ENAMAD-->": ENAMAD_SEAL,
      "<!--UPDATED-->": `آخرین به‌روزرسانی: ${esc(info.lastUpdatedFa)}`,
    }),
  );

  const fontBytes = copyFonts();
  const shots = copyShots();

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
      `(${TERMS.length} بند قوانین، ${PRIVACY.length} بند حریم خصوصی، فونت ${kb(fontBytes)}، ` +
      `${shots.count} عکس ${kb(shots.bytes)})`,
  );
}

main();
