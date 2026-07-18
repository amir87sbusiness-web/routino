import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
// وارد کردن درخت مسیرها که توسط TanStack تولید شده است
import { routeTree } from './routeTree.gen';
// وارد کردن استایل‌های اصلی (Tailwind)
import './styles.css';
import { initPwa } from './lib/pwa';

// ایجاد یک نمونه از روتر
const router = createRouter({ routeTree });

// ثبت تایپ‌ها برای جلوگیری از خطاهای تایپ‌اسکریپت
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// سرویس‌ورکر / نصب / استوریج پایدار. روی کپسیتور خودش no-op می‌کند.
initPwa();

// دیپ‌لینک بازگشت از درگاه پرداخت (فقط نیتیو):
// صفحه‌ی callback سرور کاربر را به routino://pay/result?paymentId=… می‌فرستد.
void (async () => {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  const { App: CapApp } = await import('@capacitor/app');
  CapApp.addListener('appUrlOpen', ({ url }) => {
    const m = url.match(/pay\/result\??(.*)$/);
    if (!m) return;
    const params = new URLSearchParams(m[1] ?? '');
    void router.navigate({
      to: '/pay/result',
      search: {
        paymentId: params.get('paymentId') ?? undefined,
        status: params.get('status') ?? undefined,
      },
    });
  });
})();

// رندر کردن اپلیکیشن در تگ root
const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
