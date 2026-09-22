const ZARINPAL_START_URL = "https://payment.zarinpal.com/pg/StartPay/";
const AUTHORITY_RE = /^[A-Za-z0-9_-]{1,128}$/;

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Android payment bridge.
 *
 * Capacitor runs from https://localhost, which ZarinPal can reject as an
 * unapproved referrer. Opening this first-party page first makes the following
 * navigation originate from routino.me while keeping the actual StartPay URL
 * fixed to ZarinPal (the query string can never become an open redirect).
 */
export async function onRequest({ request }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const authority = url.searchParams.get("authority")?.trim() ?? "";
  if (!AUTHORITY_RE.test(authority)) {
    return new Response("Invalid payment authority", {
      status: 400,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }

  const target = `${ZARINPAL_START_URL}${encodeURIComponent(authority)}`;
  const headers = {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };

  if (request.method === "HEAD") return new Response(null, { status: 200, headers });

  const targetForHtml = htmlEscape(target);
  const targetForScript = JSON.stringify(target).replaceAll("<", "\\u003c");
  const body = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="origin">
  <title>انتقال به درگاه پرداخت</title>
  <style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fff;color:#171717}main{text-align:center;padding:24px}a{color:#ea580c}</style>
</head>
<body>
  <main>
    <p>در حال انتقال به درگاه پرداخت…</p>
    <a href="${targetForHtml}">اگر منتقل نشدید، اینجا بزنید</a>
  </main>
  <script>location.replace(${targetForScript});</script>
</body>
</html>`;

  return new Response(body, { status: 200, headers });
}
