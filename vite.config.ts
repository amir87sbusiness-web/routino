// این پروژه یک SPA خالص است (بدون SSR). خروجی یکسان است چه برای اپ موبایل
// (با Capacitor) و چه برای انتشار وب/دسکتاپ (مثلاً بعداً با Electron یا هر
// هاست استاتیک ساده). فقط پوشه‌ی خروجی متفاوت است تا با پیکربندی Capacitor
// (که www/ را انتظار دارد) تداخل نکند.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "url";

// BUILD_TARGET=mobile npm run build → خروجی در www/ (برای Capacitor)
// در غیر این صورت (وب/دسکتاپ) → خروجی در dist/
const isMobile = process.env.BUILD_TARGET === "mobile";

// وب: اپ زیر مسیر /app سرو می‌شود و ریشه‌ی دامنه (routino.me) صفحه‌ی معرفی است
// که `scripts/build-landing.mjs` می‌سازد. پس خروجی وب داخل dist/app می‌نشیند و
// لندینگ در خودِ dist — یک دامنه، دو چیز.
//
// موبایل: کپسیتور فایل‌ها را از ریشه‌ی WebView سرو می‌کند، پس base باید '/'
// بماند و خروجی در www/. هر جای دیگری که مسیر لازم دارد از
// `import.meta.env.BASE_URL` می‌خواند، نه از یک رشته‌ی ثابت — تا هر دو حالت
// خودبه‌خود درست باشند.
const outDir = isMobile ? "www" : "dist/app";
const base = isMobile ? "/" : "/app/";

export default defineConfig({
  base,
  plugins: [
    // autoCodeSplitting: هر صفحه یک فایل جدا می‌شود تا لود اول فقط چیزهای لازم
    // را بیاورد (سریع‌تر روی نت ضعیف). PWA همه را precache می‌کند، پس آفلاین
    // هیچ فرقی نمی‌کند.
    TanStackRouterVite({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // ---------------------------------------------------------------------
      // خاموش روی بیلد موبایل — این غیرقابل مذاکره است.
      //
      // سرویس‌ورکر داخل WebView کپسیتور در بهترین حالت اضافی است (اسست‌ها از قبل
      // محلی‌اند) و در بدترین حالت مخرب: اسست‌های `https://localhost` را کش می‌کند،
      // از آپدیت اپ جان سالم به در می‌برد، و بعد از آپدیت از پلی‌استور همچنان
      // باندل قدیمی را سرو می‌کند — بدون هیچ نشانه‌ی واضحی.
      // ---------------------------------------------------------------------
      disable: isMobile,

      // 'prompt' نه 'autoUpdate': با autoUpdate یک تب باز، وسط کار چانک‌های
      // جاوااسکریپت را زیر پای اپِ در حال اجرا عوض می‌کند و خطای chunk-load
      // می‌دهد. اینجا از کاربر می‌پرسیم.
      registerType: "prompt",
      injectRegister: null, // ثبت را خودمان در client.tsx انجام می‌دهیم

      manifest: false, // مانیفست دستی در public/ نگه‌داری می‌شود
      includeAssets: ["favicon.svg", "icons/*.png"],

      workbox: {
        // روتینگ سمت کلاینت: باز کردن مستقیم /habits در حالت آفلاین باید
        // index.html را بگیرد وگرنه ۴۰۴ می‌شود.
        // با base=/app/ این باید /app/index.html باشد وگرنه باز کردن مستقیم
        // /app/habits در حالت آفلاین به ریشه‌ی دامنه (صفحه‌ی معرفی) می‌افتد.
        navigateFallback: `${base}index.html`,

        // ---------------------------------------------------------------
        // هرگز API را کش نکن.
        //
        // اگر یک پاسخ کش‌شده‌ی /v1/sync/pull سرو شود، کلاینت آن را اعمال می‌کند
        // و cursor را جلو می‌برد — یعنی گم‌شدن بی‌صدا و دائمی دیتا. داستان
        // آفلاینِ این اپ خودِ دیتابیس محلی است، نه کش شبکه.
        // ---------------------------------------------------------------
        navigateFallbackDenylist: [
          /^\/v1(?:\/|$)/,
          /^\/admin(?:\/|$)/,
          /^\/payments\/callback(?:\/|$)/,
        ],
        runtimeCaching: [],

        // woff2 در globPatterns پیش‌فرض ورک‌باکس **نیست**
        // ({js,css,html,ico,png,svg}). وزیرمتن woff2 است و بدون این، متن فارسی
        // در حالت آفلاین با فونت سیستمی و RTL خراب رندر می‌شود.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],

        // باندل ~۵۹۰KB است؛ سقف پیش‌فرض ۲MB است ولی صریح بودنش بهتر از
        // «چرا فایل اصلی کش نشد؟» است.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,

        cleanupOutdatedCaches: true,
      },

      devOptions: {
        // در dev خاموش: یک سرویس‌ورکر فعال، HMR را غیرقابل‌پیش‌بینی می‌کند.
        // تست آفلاین روی بیلد پروداکشن انجام می‌شود (`npm run preview`).
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      // این خط آدرس‌دهی دقیق و بدون باگ در ویندوز/مک/لینوکس را تضمین می‌کند
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    // در توسعه‌ی وب، API را same-origin پروکسی می‌کنیم تا CORS اصلاً درگیر نشود.
    // بیلد موبایل این را ندارد و با VITE_API_URL به آدرس کامل سرور می‌زند.
    proxy: {
      "/v1": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
