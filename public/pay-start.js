(() => {
  const status = document.getElementById("status");
  const manual = document.getElementById("manual");
  const authority = new URLSearchParams(window.location.search).get("authority")?.trim() || "";

  if (!/^[A-Za-z0-9_-]{20,128}$/.test(authority)) {
    if (status) status.textContent = "شناسه پرداخت نامعتبر است.";
    return;
  }

  const target = `https://payment.zarinpal.com/pg/StartPay/${encodeURIComponent(authority)}`;
  if (manual instanceof HTMLAnchorElement) {
    manual.href = target;
    manual.referrerPolicy = "origin";
  }

  // Do not leave the payment authority in Routino's local browser history.
  window.history.replaceState(null, "", window.location.pathname);

  // Normal path: no login, no OTP, no SPA. Go straight to the gateway.
  window.location.replace(target);

  // Only shown if the browser refuses the automatic navigation for any reason.
  window.setTimeout(() => {
    if (status) status.textContent = "انتقال خودکار انجام نشد.";
    if (manual) manual.hidden = false;
  }, 1800);
})();
