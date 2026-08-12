/**
 * Local stand-in for the hosted payment page. Registered ONLY when the fake PSP
 * is active (env.ts already forbids `fake` in production). Mirrors
 * backend/src/routes/dev-gateway.ts — same redirect contract as Zibal.
 */
import { Hono } from "hono";
import { html, type AppEnv, type Deps } from "../deps.ts";
import type { fakePsp } from "../shared/providers/psp/fake.ts";

export function devGatewayRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const fake = deps.psp.get("fake");
  if (!fake) return r;
  const psp = fake as ReturnType<typeof fakePsp>;

  r.get("/dev/gateway", (c) => {
    const trackId = Number(c.req.query("trackId"));
    const txn = psp._txns.get(trackId);
    if (!txn) return html(c, "<h1>تراکنش پیدا نشد</h1>", 404);

    const toman = Math.floor(txn.amountRial / 10).toLocaleString("en-US");
    const page = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Novino — درگاه تستی</title>
<style>
  body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#eef2f7;min-height:100vh;
       display:flex;align-items:center;justify-content:center;color:#111}
  .card{background:#fff;border-radius:20px;padding:36px 28px;max-width:340px;width:calc(100% - 48px);
        text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}
  .badge{font-size:11px;background:#fef3c7;color:#92400e;border-radius:999px;padding:4px 12px;
         display:inline-block;margin-bottom:14px}
  .amount{font-size:28px;font-weight:900;margin:6px 0 2px}
  .unit{font-size:12px;color:#666;margin-bottom:24px}
  a{display:block;border-radius:12px;padding:13px;font-weight:700;text-decoration:none;font-size:15px}
  .pay{background:#16a34a;color:#fff;margin-bottom:10px}
  .cancel{background:#f1f5f9;color:#475569}
</style>
</head>
<body>
<div class="card">
  <div class="badge">درگاه شبیه‌سازی‌شده — پولی جابه‌جا نمی‌شود</div>
  <div class="amount">${toman}</div>
  <div class="unit">تومان (تراکنش ${trackId})</div>
  <a class="pay" href="/v1/dev/gateway/settle?trackId=${trackId}&outcome=paid">پرداخت موفق</a>
  <a class="cancel" href="/v1/dev/gateway/settle?trackId=${trackId}&outcome=canceled">انصراف</a>
</div>
</body>
</html>`;
    return html(c, page);
  });

  r.get("/dev/gateway/settle", (c) => {
    const trackId = Number(c.req.query("trackId"));
    const txn = psp._txns.get(trackId);
    if (!txn) return c.json({ error: "unknown_track" }, 404);

    const outcome = c.req.query("outcome") === "paid" ? "paid" : "canceled";
    psp._settle(trackId, outcome);

    // Same query-string contract Zibal uses on its redirect.
    const sep = txn.callbackUrl.includes("?") ? "&" : "?";
    const success = outcome === "paid" ? "1" : "0";
    const status = outcome === "paid" ? "2" : "3"; // 2 = paid-unverified, 3 = canceled
    return c.redirect(
      `${txn.callbackUrl}${sep}trackId=${trackId}&success=${success}&status=${status}&orderId=${txn.orderId}`,
      302,
    );
  });

  return r;
}
