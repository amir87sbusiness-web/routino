# Routino

اپ ردیابی عادت، تسک، ژورنال و تایمر — با React، TypeScript، TanStack Router
و Tailwind. یک کدبیس واحد که از دو خروجی پشتیبانی می‌کند:

- **اپ موبایل (اصل کار فعلی)** — iOS و Android، با Capacitor، شامل
  نوتیفیکیشن‌های واقعی سیستم‌عامل.
- **وب / دسکتاپ (برای بعداً)** — یک بیلد استاتیک SPA معمولی که روی هر
  هاست استاتیکی (یا در آینده Electron برای ویندوز) قابل انتشار است.

این پروژه به هیچ سرویس یا پلتفرم شخص ثالثی (Lovable یا مشابه آن) وابسته
نیست. تمام کد و تنظیمات بیلد مستقیماً در همین ریپو مدیریت می‌شود.

📚 **مستندات کامل فارسی در پوشه‌ی [`docs-fa/`](docs-fa/README.md)** — نقشه‌ی کد،
راهنمای فرانت/بک، وابستگی‌ها، استقرار و راه‌اندازی موبایل.

## معماری

- **بدون سرور (SSR-free):** اپ کاملاً client-side است. هیچ Node.js
  سروری در زمان اجرا لازم نیست — فقط یک بیلد استاتیک HTML/CSS/JS.
- **ذخیره‌سازی:** تمام داده (عادت‌ها، تسک‌ها، ژورنال، تنظیمات) در
  `localStorage` مرورگر/WebView نگه‌داری می‌شود (`src/lib/store.ts`).
  sync ابری بین دستگاه‌ها فعلاً پیاده نشده.
- **مسیریابی:** TanStack Router با file-based routing
  (`src/routes/*.tsx`؛ راهنمای کامل در `src/routes/README.md`).
- **نوتیفیکیشن:**
  - در وب: نوتیف مرورگر، فقط وقتی اپ باز است (`src/state/app.tsx`).
  - در موبایل: نوتیف بومی سیستم‌عامل، زمان‌بندی‌شده از قبل، که حتی
    وقتی اپ بسته باشد هم نمایش داده می‌شود (`src/lib/native-notifications.ts`).

## شروع سریع (توسعه)

```bash
npm install
npm run dev
```

سرور توسعه روی `http://localhost:5173` بالا می‌آید (پورت پیش‌فرض Vite).

## بیلدها

| دستور | خروجی | برای |
|---|---|---|
| `npm run build` | `dist/` | وب/دسکتاپ (هاست استاتیک، Electron بعداً) |
| `npm run build:mobile` | `www/` | Capacitor (iOS/Android) |

هر دو از یک کدبیس واحد ساخته می‌شوند؛ تنها تفاوت پوشه‌ی خروجی است
(`vite.config.ts`، متغیر `BUILD_TARGET`).

## اپ موبایل (iOS / Android)

راهنمای کامل نصب Xcode/Android Studio، افزودن پلتفرم‌ها، و تنظیم
نوتیفیکیشن در **`docs-fa/MOBILE_SETUP.md`** آمده است — از همان‌جا شروع کن.

خلاصه‌ی فرمان‌ها:

```bash
npm run build:mobile      # بیلد استاتیک برای Capacitor
npx cap add ios           # فقط بار اول
npx cap add android        # فقط بار اول
npm run cap:sync          # هر بار بعد از تغییر کد
npm run cap:ios           # باز کردن در Xcode
npm run cap:android       # باز کردن در Android Studio
```

## انتشار وب / دسکتاپ (مراحل بعدی، وقتی لازم شد)

نسخه‌ی `dist/` که با `npm run build` ساخته می‌شود یک SPA استاتیک استاندارد
است و روی هر هاست استاتیکی (Netlify، Vercel، Cloudflare Pages، یا حتی یک
سرور Nginx ساده) قابل دیپلوی است — بدون نیاز به تغییر کد.

برای نسخه‌ی دسکتاپ ویندوز، ساده‌ترین مسیر Electron یا Tauri است: همین
خروجی `dist/` را به‌عنوان صفحه‌ی اصلی یک پنجره‌ی دسکتاپ لود می‌کنند. این
یک مرحله‌ی جدا و مستقل از کار موبایل فعلی است؛ هر وقت خواستی روش کار
کنیم اطلاع بده.

## ساختار پوشه‌ها

```
src/
  routes/       صفحات (file-based routing)
  components/   کامپوننت‌های UI (shadcn/ui + کامپوننت‌های اختصاصی اپ)
  state/        AppProvider — مدیریت state سراسری و اسکجولر یادآوری‌ها
  lib/          منطق دامنه (store، logic، dates، presets) و
                native-notifications.ts (پل نوتیف بومی موبایل)
  hooks/        هوک‌های عمومی React
public/         فایل‌های استاتیک (favicon، manifest، robots.txt)
```
