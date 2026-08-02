/**
 * می‌سازد: landing/dist/index.html  (سایت اصلی routino.me)
 *
 * قالب از `landing/index.template.html` می‌آید و متنِ قوانین/حریم خصوصی و کد
 * اینماد از `src/lib/legal-text.ts` — همان ماژولی که اپ هم از آن می‌خواند. پس
 * متن حقوقی یک منبع دارد و سایت و اپ نمی‌توانند از هم جدا بیفتند.
 *
 * اجرا:  npm run build:landing
 *
 * چرا فارسی‌فقط؟ سایت اصلی ویترین و مرجعِ بررسی اینماد است؛ نسخه‌ی دوزبانه‌ی
 * کامل داخل خود اپ (تنظیمات ← قوانین) هست.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "landing", "index.template.html");
// ریشه‌ی همان dist که اپ داخل dist/app آن می‌نشیند: یک دامنه، صفحه‌ی معرفی روی
// `/` و برنامه روی `/app/`. پس این باید بعد از `vite build` اجرا شود، وگرنه
// `emptyOutDir` پاکش می‌کند.
const OUT_DIR = join(ROOT, "dist");
const OUT = join(OUT_DIR, "index.html");

/** HTML-escape. متن حقوقی از ما می‌آید نه از کاربر، ولی یک `<` بی‌جا نباید صفحه
 * را خراب کند. کد اینماد عمداً از این مسیر رد نمی‌شود (باید عیناً درج شود). */
const esc = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** فارسیِ هر جفت [fa, en]. */
const fa = (pair) => pair[0];

/**
 * اعتبارسنجی متن حقوقی — اینجا، چون اینجا بیلد را می‌شکند.
 *
 * قبلاً این بررسی در `src/lib/legal-text.ts` بود و در زمان اجرا throw می‌کرد؛
 * نتیجه این بود که یک جفتِ ناقص در JSON کلِ صفحه‌ی تنظیمات را از کار می‌انداخت
 * و کاربر به «گرفتن پشتیبان» و «خروج از حساب» دسترسی نداشت. هیچ‌کدام از دو
 * بیلد هم آن را نمی‌گرفتند، پس داده‌ی خراب منتشر می‌شد.
 *
 * حالا `npm run build` روی داده‌ی خراب با پیام صریح می‌ایستد — قبل از انتشار.
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

function renderSections(list) {
  return list
    .map(
      (sec) =>
        `        <h3>${esc(fa(sec.title))}</h3>\n` +
        sec.paras.map((p) => `        <p>${esc(fa(p))}</p>`).join("\n"),
    )
    .join("\n");
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

async function main() {
  // JSON خام — نه import تایپ‌اسکریپت — تا این بیلد هیچ وابستگی‌ای نخواهد.
  const data = JSON.parse(readFileSync(join(ROOT, "src", "lib", "legal-text.json"), "utf8"));
  const { terms: TERMS, privacy: PRIVACY, enamadSeal: ENAMAD_SEAL } = data;
  validate(TERMS, "terms");
  validate(PRIVACY, "privacy");
  if (!ENAMAD_SEAL?.includes("trustseal.enamad.ir"))
    throw new Error("legal-text.json: مهر اینماد گم یا خراب شده");
  const LEGAL_INFO = readLegalInfo();

  const legal =
    `      <div class="card">\n` +
    `        <h2>قوانین و مقررات</h2>\n` +
    `        <p class="updated">آخرین به‌روزرسانی: ${esc(LEGAL_INFO.lastUpdatedFa)}</p>\n` +
    renderSections(TERMS) +
    `\n      </div>\n\n` +
    `      <div class="card">\n` +
    `        <h2>حریم خصوصی</h2>\n` +
    renderSections(PRIVACY) +
    `\n      </div>\n\n` +
    `      <div class="card contact">\n` +
    `        <h2>تماس با ما و پشتیبانی</h2>\n` +
    `        <p>ایمیل: <a href="mailto:${esc(LEGAL_INFO.email)}">${esc(LEGAL_INFO.email)}</a></p>\n` +
    `        <p>تلگرام: <a href="https://t.me/${esc(LEGAL_INFO.telegram)}" target="_blank" rel="noreferrer">@${esc(LEGAL_INFO.telegram)}</a></p>\n` +
    `        <p>اینستاگرام: <a href="https://instagram.com/${esc(LEGAL_INFO.instagram)}" target="_blank" rel="noreferrer">@${esc(LEGAL_INFO.instagram)}</a></p>\n` +
    `      </div>`;

  const template = readFileSync(TEMPLATE, "utf8");
  if (!template.includes("<!--LEGAL-->") || !template.includes("<!--ENAMAD-->")) {
    throw new Error("قالب جای‌گاه <!--LEGAL--> یا <!--ENAMAD--> را ندارد");
  }

  const html = template
    .replace("<!--LEGAL-->", legal)
    // عیناً و بدون escape — مهر اینماد باید همان HTMLی باشد که صادر شده.
    .replace("<!--ENAMAD-->", ENAMAD_SEAL);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, html);

  // ⚠️ `_redirects` و `_headers` باید در ریشه‌ی خروجی باشند — Cloudflare Pages
  // فقط همان‌جا را می‌خواند. قبلاً در `public/` بودند و Vite آن‌ها را کنار اپ
  // می‌گذاشت؛ حالا که اپ در `dist/app/` است، آنجا نادیده گرفته می‌شدند. پس
  // اینجا ساخته می‌شوند، با مسیرهای به‌روزشده برای /app/.
  // ASCII only, deliberately. The first version of this file had Persian
  // comments and Cloudflare silently ignored the whole thing: /app/ worked
  // (a real file) but /app/habits fell through to the root index.html, i.e.
  // every deep link — including the payment return page — served the landing
  // page instead of the app. Keep comments ASCII so the rule always parses.
  writeFileSync(
    join(OUT_DIR, "_redirects"),
    [
      "# SPA fallback for the app only, never the landing page at /.",
      "# /app/habits is not a real file and must serve /app/index.html,",
      "# otherwise a refresh or a direct link 404s (or worse, silently",
      "# renders the landing page).",
      "/app/* /app/index.html 200",
      "",
    ].join("\n"),
  );

  // کنترل کش. قانون طلایی: هر چیزی که اسمش ثابت است (index.html، sw.js،
  // manifest) نباید کش شود، وگرنه کاربر آپدیت نمی‌گیرد و روی نسخه‌ی قدیمی یخ
  // می‌زند. مسیرها با /app/ جلو آمده‌اند چون اپ آنجاست.
  //
  // ⚠️ اندازه‌گیریِ واقعی روی پروداکشن (۱۴۰۵/۰۵/۰۸): قاعده‌ی `/assets/*` عملاً
  // اعمال نمی‌شود — Cloudflare Pages هدر خودش را می‌گذارد
  // (`Cache-Control: max-age=14400`). چیزی که فعلاً جلوی دام «بعد از آپدیت،
  // سایت بالا نمی‌آید» را می‌گیرد این است که index.html با no-cache سرو می‌شود و
  // سرویس‌ورکر PWA هم assetها را جدا precache می‌کند. برای بستن کامل باید در
  // داشبورد Cloudflare یک Transform Rule گذاشت.
  writeFileSync(
    join(OUT_DIR, "_headers"),
    [
      "# ASCII only, same reason as _redirects above.",
      "# Anything with a stable name must not be cached, or users freeze on an",
      "# old version and never receive an update.",
      "/",
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
      "/app/assets/*",
      "  Cache-Control: no-cache",
      "",
    ].join("\n"),
  );
  console.log(
    `[build-landing] ${OUT}  (${TERMS.length} بند قوانین، ${PRIVACY.length} بند حریم خصوصی)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
