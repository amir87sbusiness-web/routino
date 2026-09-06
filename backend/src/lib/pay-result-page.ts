/**
 * The browser-facing payment result page.
 *
 * Rendered to the user's browser after the gateway. Not part of the SPA — the
 * user may land here with the app closed. Its one job: state the outcome and get
 * the user back into the app (web URL, or deep link on Android/iOS).
 *
 * Framework-free (returns a plain HTML string) so the Fastify backend and the
 * Supabase Edge Function render the byte-identical page.
 */

export interface ResultPagePayment {
  id: string;
  platform: string | null;
  refNumber: string | null;
}

export interface ResultPageInput {
  outcome: "paid" | "canceled" | "failed" | "verify_failed" | "pending";
  payment?: ResultPagePayment;
  message?: string;
  retryCallbackAfterSeconds?: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderResultPage(
  env: { PUBLIC_WEB_URL: string; APP_DEEP_LINK: string },
  input: ResultPageInput,
): string {
  const { outcome, payment } = input;
  const native = payment?.platform === "android" || payment?.platform === "ios";
  const params = payment ? `paymentId=${payment.id}&status=${outcome}` : `status=${outcome}`;
  const webUrl = `${env.PUBLIC_WEB_URL}/pay/result?${params}`;
  const deepLink = `${env.APP_DEEP_LINK}?${params}`;
  const target = native ? deepLink : webUrl;

  const ok = outcome === "paid";
  const retrySeconds =
    outcome === "pending" && input.retryCallbackAfterSeconds
      ? Math.max(5, Math.min(300, Math.ceil(input.retryCallbackAfterSeconds)))
      : 0;
  const title = ok
    ? "پرداخت موفق بود 🎉"
    : outcome === "canceled"
      ? "پرداخت لغو شد"
      : outcome === "pending"
        ? "در حال بررسی پرداخت…"
        : "پرداخت ناموفق بود";
  const detail =
    (retrySeconds
      ? "تأیید درگاه هنوز کامل نشده. این صفحه را باز نگه دار؛ دوباره بررسی می‌کنیم."
      : input.message) ??
    (ok
      ? `اشتراک شما فعال شد.${payment?.refNumber ? ` کد پیگیری: ${esc(payment.refNumber)}` : ""}`
      : outcome === "canceled"
        ? "مبلغی از حساب شما کم نشده. اگر منصرف شدی مشکلی نیست — هر وقت خواستی دوباره تلاش کن."
        : outcome === "verify_failed"
          ? `تأیید پرداخت با مشکل روبه‌رو شد. اگر مبلغی کم شده، تا ۷۲ ساعت آینده به حسابت برمی‌گردد. کد پیگیری: ${payment ? esc(payment.id.slice(0, 8)) : "-"}`
          : outcome === "pending"
            ? "نتیجه هنوز از درگاه نرسیده. چند لحظه دیگر در برنامه وضعیت را ببین."
            : "پرداخت انجام نشد. اگر مبلغی کم شده، تا ۷۲ ساعت آینده برمی‌گردد.");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>روتینو — نتیجه پرداخت</title>
<style>
  body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#f8f7f4;color:#1c1917;
       min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:24px;padding:40px 32px;max-width:360px;width:calc(100% - 48px);
        text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  .icon{font-size:56px;line-height:1;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 10px}
  p{font-size:14px;color:#57534e;line-height:1.9;margin:0 0 24px}
  a.btn{display:block;background:${ok ? "#f97316" : "#78716c"};color:#fff;text-decoration:none;
        border-radius:14px;padding:14px;font-weight:700;font-size:15px}
  a.alt{display:block;margin-top:12px;color:#78716c;font-size:12px;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${ok ? "✅" : outcome === "canceled" ? "↩️" : outcome === "pending" ? "⏳" : "❌"}</div>
  <h1>${title}</h1>
  <p>${detail}</p>
  ${retrySeconds ? '<a class="btn" id="retry-verification" href="">بررسی دوبارهٔ پرداخت</a>' : ""}
  <a class="btn" href="${esc(target)}">بازگشت به روتینو</a>
  ${native ? `<a class="alt" href="${esc(webUrl)}">باز نشد؟ نسخه وب را باز کن</a>` : ""}
</div>
<script>
  ${
    retrySeconds
      ? `
  // Keep the candidate in the original callback URL. Never send it to the app.
  var retryUrl = new URL(window.location.href);
  var attempt = Math.max(0, Number(retryUrl.searchParams.get("verificationRetry")) || 0);
  document.getElementById("retry-verification").href = retryUrl.href;
  if (attempt < 3) {
    retryUrl.searchParams.set("verificationRetry", String(attempt + 1));
    setTimeout(function () { window.location.replace(retryUrl.href); }, ${retrySeconds * 1000});
  }
  `
      : `
  // Give the user a beat to read the outcome, then return to the app.
  setTimeout(function () { window.location.href = ${JSON.stringify(target)}; }, ${ok ? 1600 : 4000});
  `
  }
</script>
</body>
</html>`;
}
