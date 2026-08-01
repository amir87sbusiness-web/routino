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
const OUT_DIR = join(ROOT, "landing", "dist");
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

function renderSections(list) {
  return list
    .map(
      (sec) =>
        `        <h3>${esc(fa(sec.title))}</h3>\n` +
        sec.paras.map((p) => `        <p>${esc(fa(p))}</p>`).join("\n"),
    )
    .join("\n");
}

async function main() {
  // `legal-text.ts` تایپ‌اسکریپت است، پس این اسکریپت با tsx اجرا می‌شود.
  const { TERMS, PRIVACY, ENAMAD_SEAL } = await import("../src/lib/legal-text.ts");
  const { LEGAL_INFO } = await import("../src/lib/legal-info.ts");

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
  console.log(
    `[build-landing] ${OUT}  (${TERMS.length} بند قوانین، ${PRIVACY.length} بند حریم خصوصی)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
