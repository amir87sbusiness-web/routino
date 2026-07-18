// این پروژه یک SPA خالص است (بدون SSR). خروجی یکسان است چه برای اپ موبایل
// (با Capacitor) و چه برای انتشار وب/دسکتاپ (مثلاً بعداً با Electron یا هر
// هاست استاتیک ساده). فقط پوشه‌ی خروجی متفاوت است تا با پیکربندی Capacitor
// (که www/ را انتظار دارد) تداخل نکند.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'url';

// BUILD_TARGET=mobile npm run build → خروجی در www/ (برای Capacitor)
// در غیر این صورت (وب/دسکتاپ) → خروجی در dist/
const isMobile = process.env.BUILD_TARGET === 'mobile';
const outDir = isMobile ? 'www' : 'dist';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
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
      registerType: 'prompt',
      injectRegister: null, // ثبت را خودمان در client.tsx انجام می‌دهیم

      manifest: false, // مانیفست دستی در public/ نگه‌داری می‌شود
      includeAssets: ['favicon.svg', 'icons/*.png'],

      workbox: {
        // روتینگ سمت کلاینت: باز کردن مستقیم /habits در حالت آفلاین باید
        // index.html را بگیرد وگرنه ۴۰۴ می‌شود.
        navigateFallback: '/index.html',

        // ---------------------------------------------------------------
        // هرگز API را کش نکن.
        //
        // اگر یک پاسخ کش‌شده‌ی /v1/sync/pull سرو شود، کلاینت آن را اعمال می‌کند
        // و cursor را جلو می‌برد — یعنی گم‌شدن بی‌صدا و دائمی دیتا. داستان
        // آفلاینِ این اپ خودِ دیتابیس محلی است، نه کش شبکه.
        // ---------------------------------------------------------------
        navigateFallbackDenylist: [/^\/v1\//],
        runtimeCaching: [],

        // woff2 در globPatterns پیش‌فرض ورک‌باکس **نیست**
        // ({js,css,html,ico,png,svg}). وزیرمتن woff2 است و بدون این، متن فارسی
        // در حالت آفلاین با فونت سیستمی و RTL خراب رندر می‌شود.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],

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
      "@": fileURLToPath(new URL('./src', import.meta.url)),
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
      '/v1': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/v1': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
