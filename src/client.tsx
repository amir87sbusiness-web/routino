import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
// وارد کردن درخت مسیرها که توسط TanStack تولید شده است
import { routeTree } from "./routeTree.gen";
// وارد کردن استایل‌های اصلی (Tailwind)
import "./styles.css";
import { initPwa } from "./lib/pwa";
import { preloadCompletionCue } from "./lib/completion-feedback";
import { parsePaymentDeepLink } from "./lib/payment-deep-link";

// ایجاد یک نمونه از روتر
//
// basepath از خودِ بیلد می‌آید، نه از یک رشته‌ی ثابت: روی وب `/app/` است (چون
// ریشه‌ی routino.me صفحه‌ی معرفی است) و روی بیلد موبایل `/`. با خواندن از
// BASE_URL هر دو حالت بدون شرط‌گذاری درست می‌شوند. اسلشِ آخر حذف می‌شود چون
// روتر مسیرها را با `/` شروع می‌کند و `/app//habits` تولید نشود.
const basepath = import.meta.env.BASE_URL.replace(/\/$/, "");
const router = createRouter({ routeTree, basepath });

// ثبت تایپ‌ها برای جلوگیری از خطاهای تایپ‌اسکریپت
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// سرویس‌ورکر / نصب / استوریج پایدار. روی کپسیتور خودش no-op می‌کند.
initPwa();
preloadCompletionCue();

// دیپ‌لینک بازگشت از درگاه پرداخت (فقط نیتیو):
// صفحه‌ی callback سرور کاربر را به routino://pay/result?paymentId=… می‌فرستد.
//
// `appUrlOpen` برگشت به اپِ زنده را پوشش می‌دهد. `getLaunchUrl` هم حالت مهمی
// را پوشش می‌دهد که سیستم در زمان حضور کاربر در مرورگر/درگاه، پروسه‌ی اپ را
// کشته و custom scheme اپ را از صفر بالا می‌آورد. بدون آن، نتیجه‌ی پرداخت در
// cold launch ممکن بود قبل از ثبت listener از دست برود.
void (async () => {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;
  const { App: CapApp } = await import("@capacitor/app");

  let lastHandledUrl = "";
  const handlePaymentUrl = (url?: string) => {
    if (!url || url === lastHandledUrl) return;
    const payment = parsePaymentDeepLink(url);
    if (!payment) return;
    lastHandledUrl = url;
    void router.navigate({
      to: "/pay/result",
      search: payment,
    });
  };

  await CapApp.addListener("appUrlOpen", ({ url }) => handlePaymentUrl(url));
  const launch = await CapApp.getLaunchUrl();
  handlePaymentUrl(launch?.url);
})();

// رندر کردن اپلیکیشن در تگ root
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
