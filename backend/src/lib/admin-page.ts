/**
 * The admin panel page — one self-contained HTML string.
 *
 * Framework-free so both HTTP layers (Fastify locally, the Supabase Edge
 * Function in production) serve the exact same panel. Authentication is an
 * owner-only OTP followed by a signed HttpOnly cookie; the browser never stores
 * or handles a reusable admin secret.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23dd6d19'/%3E%3Cpath d='m9 16 4 4 10-10' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<title>روتینو — پنل مدیریت</title>
<style>
  @font-face{font-family:Vazirmatn;src:url('https://cdn.jsdelivr.net/npm/@fontsource/vazirmatn@5.2.8/files/vazirmatn-arabic-400-normal.woff2') format('woff2');font-weight:400;font-display:swap}
  @font-face{font-family:Vazirmatn;src:url('https://cdn.jsdelivr.net/npm/@fontsource/vazirmatn@5.2.8/files/vazirmatn-arabic-700-normal.woff2') format('woff2');font-weight:700;font-display:swap}
  @font-face{font-family:Vazirmatn;src:url('https://cdn.jsdelivr.net/npm/@fontsource/vazirmatn@5.2.8/files/vazirmatn-arabic-900-normal.woff2') format('woff2');font-weight:900;font-display:swap}
  :root{--bg:#fdfcf9;--surface:#fff;--surface-soft:#fbfaf7;--line:#e7e3dc;--txt:#302d29;--mut:#776f67;--brand:#dd6d19;--brand-soft:#fff0e4;--ok:#177c45;--ok-soft:#e7f6ec;--bad:#be3434;--bad-soft:#fff0ef;--shadow:0 16px 38px rgba(62,47,33,.07);color-scheme:light}
  *{box-sizing:border-box}
  html{min-height:100%;background:var(--bg)}
  body{min-height:100vh;margin:0;background:var(--bg);color:var(--txt);font:14px/1.7 Vazirmatn,Tahoma,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
  button,input,select{font:inherit} button{touch-action:manipulation} button,input,select{outline:none}
  button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid rgba(221,109,25,.3);outline-offset:2px}
  ::selection{background:#fed7b5;color:#572b0c}
  .topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:14px;min-height:68px;padding:10px max(16px,env(safe-area-inset-right)) 10px max(16px,env(safe-area-inset-left));background:rgba(253,252,249,.94);border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}
  .brand{min-width:0;margin-inline-end:auto}.brand h1{margin:0;font-size:16px;font-weight:900;letter-spacing:-.02em}.brand p{margin:0;color:var(--mut);font-size:11px}.toolbar{display:flex;align-items:center;gap:6px}.status{display:none;max-width:190px;overflow:hidden;color:var(--mut);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.short-label{display:none}
  main{width:min(1180px,100%);margin:0 auto;padding:20px max(16px,env(safe-area-inset-right)) calc(36px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
  .login-shell{display:grid;min-height:calc(100vh - 68px);place-items:center;padding:24px}.login-card{width:min(100%,390px);padding:28px;background:var(--surface);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow)}
  .login-card h2{margin:0 0 4px;font-size:22px;letter-spacing:-.03em}.login-card p{margin:0 0 22px;color:var(--mut);font-size:13px}.field-label{display:block;margin:0 0 7px;font-size:12px;font-weight:700;color:var(--mut)}
  input,select{min-height:44px;border:1px solid var(--line);border-radius:12px;padding:9px 12px;background:var(--surface);color:var(--txt);transition:border-color .15s,box-shadow .15s}input:focus,select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(221,109,25,.12)}input::placeholder{color:#9a9289}
  .auth-input{width:100%;margin-bottom:10px;text-align:center;font-size:16px;letter-spacing:.03em}.auth-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px}.auth-actions .field-label{margin:0}.text-button{min-height:36px;padding:4px 2px;border:0;background:transparent;color:var(--brand);font-weight:700;cursor:pointer}.text-button:hover{text-decoration:underline;text-underline-offset:4px}[hidden]{display:none!important}.err{min-height:22px;margin:4px 0;color:var(--bad);font-size:12px}.err:not(:empty){padding:6px 9px;background:var(--bad-soft);border-radius:9px}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:8px 13px;border:1px solid transparent;border-radius:12px;background:var(--brand);color:#fff;font-weight:700;cursor:pointer;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}.btn:hover{background:#c75f12;box-shadow:0 7px 16px rgba(188,81,15,.17)}.btn:active{transform:scale(.98)}.btn:disabled{cursor:wait;opacity:.6;box-shadow:none}.btn.secondary{border-color:var(--line);background:var(--surface);color:var(--txt)}.btn.secondary:hover{background:var(--surface-soft);box-shadow:none}.btn.danger{background:var(--bad)}.btn.mini{min-height:34px;padding:5px 10px;border-radius:9px;font-size:11px}
  .login-card .btn{width:100%;margin-top:3px}.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:2px 0 16px}.panel-head h2{margin:0;font-size:20px;letter-spacing:-.03em}.panel-head p{margin:2px 0 0;color:var(--mut);font-size:12px}
  nav{display:flex;gap:8px;overflow-x:auto;margin:0 -16px 18px;padding:0 16px 4px;scrollbar-width:none}nav::-webkit-scrollbar{display:none}nav button{flex:0 0 auto;min-height:42px;padding:8px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--mut);font-weight:700;cursor:pointer;transition:background .15s,color .15s,border-color .15s}nav button:hover{background:var(--surface-soft);color:var(--txt)}nav button.on{border-color:transparent;background:var(--brand);color:#fff;box-shadow:0 6px 14px rgba(188,81,15,.16)}
  .overview-groups{display:grid;gap:14px}.metric-group{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 2px 8px rgba(62,47,33,.035)}.metric-group-head{display:flex;align-items:center;min-height:43px;padding:9px 14px;background:var(--surface-soft)}.metric-group-head h3{margin:0;font-size:12px;font-weight:900;letter-spacing:-.01em}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;padding-top:1px;background:var(--line)}.metric{min-width:0;min-height:102px;padding:14px;background:var(--surface)}.metric .k{color:var(--mut);font-size:11px;font-weight:700}.metric .v{margin-top:5px;overflow-wrap:anywhere;font-size:clamp(19px,5vw,27px);font-weight:900;line-height:1.35;font-variant-numeric:tabular-nums}.metric.warn{background:#fff8e8}.metric.warn .v{color:#8b5a00}.metric.danger{background:var(--bad-soft)}.metric.danger .k,.metric.danger .v{color:#9f2727}.metric-group.attention{border-color:#ead8c7}.metric-group.attention .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .section-surface{padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(62,47,33,.035)}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row + .row{margin-top:10px}.row input:not([type="number"]){min-width:0;flex:1 1 180px}.helper{padding:11px 12px;background:var(--surface-soft);border:1px dashed #d7d0c6;border-radius:13px}.helper strong{font-size:12px}.muted{color:var(--mut);font-size:12px}
  .result{margin-top:12px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--surface)}table{width:100%;min-width:760px;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle;white-space:nowrap;font-size:12px}th{position:sticky;top:0;z-index:1;background:var(--surface-soft);color:var(--mut);font-size:11px;font-weight:700}tbody tr:last-child td{border-bottom:0}.pill{display:inline-flex;align-items:center;min-height:24px;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:900}.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.mut{background:#f1efeb;color:#716960}
  .expandable-row{cursor:pointer;transition:background .16s ease,box-shadow .16s ease}.expandable-row:hover,.expandable-row[aria-expanded="true"]{background:#fff8f1}.expandable-row:focus-visible{position:relative;z-index:2;outline:3px solid rgba(221,109,25,.28);outline-offset:-3px}.expandable-row td:first-child{font-weight:700}.identity{display:flex;align-items:center;gap:9px}.identity-mark{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border-radius:11px;background:var(--brand-soft);color:var(--brand);font-weight:900}.identity-copy{display:grid;line-height:1.5}.identity-copy small{color:var(--mut);font-size:10px;font-weight:400}.chevron{display:inline-block;width:8px;height:8px;margin-inline-start:8px;border-inline-end:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .16s ease}.expandable-row[aria-expanded="true"] .chevron{transform:rotate(225deg)}
  .detail-row[hidden]{display:none}.detail-row>td{padding:0;background:#fffaf5;white-space:normal}.detail-shell{padding:18px;border-bottom:1px solid var(--line);box-shadow:inset 0 1px 0 #fff}.detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.detail-head h3{margin:0;font-size:16px}.detail-head p{margin:2px 0 0}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:14px 0 0;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--line)}.detail-stat{min-width:0;padding:12px;background:var(--surface)}.detail-stat span{display:block;color:var(--mut);font-size:10px}.detail-stat strong{display:block;margin-top:3px;overflow-wrap:anywhere;font-size:13px;font-variant-numeric:tabular-nums}.detail-actions{margin-top:14px;padding:12px;border-radius:14px;background:var(--surface);border:1px solid var(--line)}.detail-section{margin-top:18px}.detail-section h4{margin:0 0 8px;font-size:12px}.detail-section table{min-width:540px}.detail-loading{min-height:150px}
  .plans-note{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.plans-note p{max-width:62ch;margin:0}.plans-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.plan-card{padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 9px 24px rgba(62,47,33,.05)}.plan-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.plan-card h3{margin:0;font-size:16px}.plan-card p{margin:2px 0 0}.plan-price{display:flex;align-items:center;gap:8px;margin-top:16px}.plan-price input{width:100%;min-width:0;text-align:center;font-variant-numeric:tabular-nums}.plan-price .btn{flex:0 0 auto}.plan-result{min-height:22px;margin-top:8px;color:var(--ok);font-size:11px}
  .empty,.load-state,.error-state{display:grid;place-items:center;min-height:170px;padding:24px;text-align:center;color:var(--mut);border:1px dashed #d8d1c8;border-radius:14px;background:var(--surface-soft)}.error-state{color:var(--bad);border-color:#f3b1a9;background:var(--bad-soft)}.state-copy{max-width:30rem;margin:0 0 10px;font-size:12px}.skeleton{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sk{height:118px;border-radius:17px;background:linear-gradient(100deg,#f2efe9 30%,#faf8f4 48%,#f2efe9 66%);background-size:200% 100%;animation:shine 1.2s linear infinite}@keyframes shine{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
  @media (min-width:680px){.topbar{padding-inline:max(24px,env(safe-area-inset-right))}.status{display:block}.overview-groups{gap:16px}.metric-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.metric{min-height:112px;padding:16px}.metric-group.attention .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.panel-head h2{font-size:23px}.section-surface{padding:16px}.toolbar{gap:8px}}
  @media (min-width:1024px){main{padding-top:28px}.overview-groups{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.metric-group:first-child{grid-column:1/-1}.metric{min-height:118px}.metric .v{font-size:28px}.panel-head{margin-bottom:20px}nav{margin:0 0 20px;padding:0}.section-surface{padding:18px}}
  @media (max-width:679px){.toolbar .btn{min-width:42px;padding-inline:10px}.toolbar .btn .wide-label{display:none}.toolbar .btn .short-label{display:inline}.login-card{padding:24px 20px}.panel-head{align-items:flex-start;flex-direction:column}.panel-head .btn{width:100%}.detail-grid{grid-template-columns:1fr 1fr}.detail-head{display:block}.plans-note{align-items:flex-start;flex-direction:column}.plans-note .btn{width:100%}.responsive-table{overflow:visible;border:0;background:transparent}.responsive-table table,.responsive-table tbody{display:block;min-width:0}.responsive-table thead{display:none}.responsive-table .expandable-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:10px;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:0 6px 18px rgba(62,47,33,.045)}.responsive-table .expandable-row td{display:block;min-width:0;padding:0;border:0;white-space:normal}.responsive-table .expandable-row td::before{display:block;margin-bottom:2px;color:var(--mut);content:attr(data-label);font-size:9px;font-weight:700}.responsive-table .expandable-row td:first-child{grid-column:1/-1}.responsive-table .detail-row{display:block;margin:-11px 0 12px}.responsive-table .detail-row[hidden]{display:none}.responsive-table .detail-row>td{display:block;border:1px solid var(--line);border-top:0;border-radius:0 0 16px 16px}.responsive-table .detail-shell{padding:15px}.detail-actions .btn{flex:1 1 130px}}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><h1>روتینو · مدیریت</h1><p>کاربران، پرداخت‌ها و اشتراک‌ها</p></div>
  <div class="toolbar">
    <span class="status" id="pageStatus" aria-live="polite"></span>
    <button class="btn secondary" type="button" id="refreshOverview" style="display:none"><span class="wide-label">به‌روزرسانی</span><span class="short-label">تازه</span></button>
    <button class="btn secondary" type="button" id="logout" style="display:none">خروج</button>
  </div>
</header>

<div id="login" class="login-shell">
  <form class="login-card" id="loginForm">
    <h2>ورود مدیر</h2>
    <p>شمارهٔ مدیر را خودت وارد کن؛ کد ورود فقط برای شمارهٔ خصوصی ثبت‌شده ارسال می‌شود.</p>
    <label class="field-label" for="adminPhone">شمارهٔ موبایل</label>
    <input class="auth-input" id="adminPhone" name="phone" type="tel" placeholder="09xxxxxxxxx" autocomplete="tel" inputmode="tel" maxlength="16" dir="ltr" required>
    <div id="otpStep" hidden>
      <div class="auth-actions"><label class="field-label" for="adminOtp">کد پیامک‌شده</label><button class="text-button" id="changePhone" type="button">تغییر شماره</button></div>
      <input class="auth-input" id="adminOtp" name="otp" type="text" placeholder="ــــ" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9۰-۹٠-٩]{4,8}" maxlength="8" dir="ltr">
    </div>
    <div class="err" id="loginErr" role="alert" aria-live="assertive"></div>
    <button class="btn" type="submit" id="enter">ارسال کد ورود</button>
  </form>
</div>

<main id="panel" style="display:none">
  <div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>
  <nav aria-label="بخش‌های پنل" role="tablist">
    <button type="button" role="tab" aria-selected="true" aria-controls="tab-overview" id="tab-button-overview" data-tab="overview" class="on">آمار</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-users" id="tab-button-users" data-tab="users">کاربران</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-payments" id="tab-button-payments" data-tab="payments">پرداخت‌ها</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-plans" id="tab-button-plans" data-tab="plans">پلن‌ها</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-discounts" id="tab-button-discounts" data-tab="discounts">کدهای تخفیف</button>
  </nav>

  <section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="overview-groups" id="ovCards" aria-live="polite"></div></section>

  <section id="tab-users" role="tabpanel" aria-labelledby="tab-button-users" style="display:none">
    <div class="section-surface">
      <div class="row"><input id="uq" placeholder="جستجو با شماره یا نام کاربری…" aria-label="جستجو با شماره یا نام کاربری" dir="auto"><button class="btn" type="button" id="uSearch">جستجو</button></div>
      <form class="helper row" id="resetPasswordForm"><strong>تنظیم یا ریست رمز عبور</strong><input id="spPhone" name="phone" placeholder="شماره (مثل 09…)" aria-label="شماره برای تنظیم رمز" autocomplete="tel" inputmode="tel" dir="ltr"><input id="spPass" name="password" type="password" placeholder="رمز عبور جدید" aria-label="رمز عبور جدید" autocomplete="new-password" dir="ltr"><button class="btn" type="submit" id="spGo">اعمال</button><span class="muted">برای شمارهٔ تازه، حساب آزمایشی ساخته می‌شود.</span></form>
      <div class="err" id="spErr" role="alert"></div>
      <div class="result" id="uResults" aria-live="polite"></div>
    </div>
  </section>

  <section id="tab-payments" role="tabpanel" aria-labelledby="tab-button-payments" style="display:none">
    <div class="section-surface"><div class="row"><label class="field-label" for="pStatus" style="margin:0">وضعیت پرداخت</label><select id="pStatus"><option value="">همه</option><option value="paid">موفق</option><option value="redirected">در درگاه</option><option value="pending">در انتظار</option><option value="canceled">لغوشده</option><option value="failed">ناموفق</option><option value="verify_failed">خطای تأیید</option></select><button class="btn" type="button" id="pReload">به‌روزرسانی</button></div><div class="result" id="pResults" aria-live="polite"></div></div>
  </section>

  <section id="tab-plans" role="tabpanel" aria-labelledby="tab-button-plans" style="display:none">
    <div class="section-surface">
      <div class="plans-note"><p class="muted">قیمت‌ها به تومان و مستقیماً از سرور خوانده می‌شوند. نمایش قیمت جدید در صفحه خرید ممکن است به‌دلیل کش تا ۵ دقیقه زمان ببرد.</p><button class="btn secondary" type="button" id="plansReload">تازه‌سازی پلن‌ها</button></div>
      <div id="plansResults" aria-live="polite"></div>
    </div>
  </section>

  <section id="tab-discounts" role="tabpanel" aria-labelledby="tab-button-discounts" style="display:none">
    <div class="section-surface"><div class="row"><input id="dCode" placeholder="کد (مثل EID1405)" aria-label="کد تخفیف" dir="ltr"><input id="dPercent" type="number" min="1" max="100" placeholder="درصد" aria-label="درصد تخفیف" style="width:82px"><input id="dMax" type="number" min="1" placeholder="سقف استفاده" aria-label="سقف استفاده" style="width:118px"><input id="dExp" type="date" title="تاریخ انقضا" aria-label="تاریخ انقضا"><button class="btn" type="button" id="dCreate">ساخت کد</button></div><div class="err" id="dErr" role="alert"></div><div class="result" id="dResults" aria-live="polite"></div></div>
  </section>
</main>

<script>
const $ = (s) => document.querySelector(s);
const REQUEST_TIMEOUT_MS = 8000;
const OVERVIEW_CACHE_KEY = "routino_admin_overview_v1";
let otpRequested = false;
let overviewRequest = null;

const finiteMetric = (value) => typeof value === "number" && Number.isFinite(value);
function safeOverview(value) {
  if (!value || !value.users || !value.payments || !value.alerts) return null;
  const metrics = [
    value.users.total, value.users.last24h, value.trialStarts, value.activeSubscriptions,
    value.payments.paidTotal, value.payments.revenueToman, value.payments.paidLast24h,
    value.payments.revenueTomanLast24h, value.payments.pending,
    value.alerts.verifyFailed, value.otpSentLast24h,
  ];
  if (!metrics.every(finiteMetric) || typeof value.serverTime !== "string") return null;
  return {
    users: { total: value.users.total, last24h: value.users.last24h },
    trialStarts: value.trialStarts,
    activeSubscriptions: value.activeSubscriptions,
    payments: {
      paidTotal: value.payments.paidTotal,
      revenueToman: value.payments.revenueToman,
      paidLast24h: value.payments.paidLast24h,
      revenueTomanLast24h: value.payments.revenueTomanLast24h,
      pending: value.payments.pending,
    },
    alerts: { verifyFailed: value.alerts.verifyFailed },
    otpSentLast24h: value.otpSentLast24h,
    serverTime: value.serverTime,
  };
}
function clearOverviewCache() {
  try { sessionStorage.removeItem(OVERVIEW_CACHE_KEY); } catch {}
}
function readOverviewCache() {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw), data = safeOverview(snapshot && snapshot.data);
    if (snapshot.version !== 1 || !finiteMetric(snapshot.savedAt) || !data) throw new Error("bad cache");
    return { savedAt: snapshot.savedAt, data };
  } catch { clearOverviewCache(); return null; }
}
function writeOverviewCache(value) {
  const data = safeOverview(value);
  if (!data) throw new Error("پاسخ آمار معتبر نبود؛ دوباره تلاش کن.");
  const snapshot = { version: 1, savedAt: Date.now(), data };
  try { sessionStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(snapshot)); } catch {}
  return snapshot;
}

function cookieValue(name) {
  const prefix = name + "=";
  const part = document.cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : "";
}

async function request(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("زمان پاسخ سرور بیش از حد طول کشید؛ دوباره تلاش کن.");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function authApi(path, opts = {}) {
  const res = await request("/v1/admin/auth" + path, {
    method: opts.method || "GET", credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body && body.message || "ارتباط با سرور برقرار نشد");
    error.status = res.status; throw error;
  }
  return body;
}

async function api(path, opts = {}) {
  const method = opts.method || "GET";
  const headers = opts.body ? { "content-type": "application/json" } : {};
  if (method === "POST") headers["x-admin-csrf"] = cookieValue("routino_admin_csrf");
  const res = await request("/v1/admin" + path, {
    method, credentials: "same-origin", headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { clearOverviewCache(); showLogin("نشست مدیریت منقضی شده؛ دوباره وارد شو."); throw new Error("نشست مدیریت منقضی شده است"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "دریافت اطلاعات ممکن نشد");
  return body;
}

function setStatus(message) { $("#pageStatus").textContent = message || ""; }
function showLogin(message) {
  $("#login").style.display = ""; $("#panel").style.display = "none";
  $("#logout").style.display = "none"; $("#refreshOverview").style.display = "none";
  otpRequested = false; $("#otpStep").hidden = true; $("#adminPhone").disabled = false;
  $("#adminOtp").value = ""; $("#enter").textContent = "ارسال کد ورود";
  $("#loginErr").textContent = message || ""; setStatus("");
}
function updatedLabel(savedAt) {
  return new Date(savedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}
function showPanel(snapshot) {
  $("#login").style.display = "none"; $("#panel").style.display = "";
  $("#logout").style.display = ""; $("#refreshOverview").style.display = "";
  if (snapshot) { renderOverview(snapshot.data); setStatus("آمار ذخیره‌شده · در حال به‌روزرسانی…"); }
  else { loading("ovCards"); setStatus("در حال به‌روزرسانی آمار…"); }
}
function setLoginBusy(busy) {
  $("#enter").disabled = busy;
  $("#enter").textContent = busy ? (otpRequested ? "در حال بررسی…" : "در حال ارسال…") : (otpRequested ? "تأیید و ورود" : "ارسال کد ورود");
}
function loading(target, count = 4) { $("#" + target).innerHTML = '<div class="skeleton">' + Array(count).fill('<div class="sk"></div>').join("") + "</div>"; }
function errorState(target, message, retry) {
  $("#" + target).innerHTML = '<div class="error-state"><div><p class="state-copy">' + esc(message) + '</p><button class="btn secondary mini" type="button">تلاش دوباره</button></div></div>';
  $("#" + target + " button").onclick = retry;
}
function emptyState(message) { return '<div class="empty"><p class="state-copy">' + esc(message) + "</p></div>"; }

$("#loginForm").onsubmit = async (event) => {
  event.preventDefault();
  const phone = $("#adminPhone").value.trim();
  if (!phone) return;
  $("#loginErr").textContent = ""; setLoginBusy(true);
  try {
    if (!otpRequested) {
      await authApi("/otp/request", { method: "POST", body: { phone } });
      otpRequested = true; $("#otpStep").hidden = false; $("#adminPhone").disabled = true;
      $("#loginErr").textContent = "اگر شماره مجاز باشد، کد تا چند لحظهٔ دیگر می‌رسد.";
      $("#adminOtp").focus();
      return;
    }
    const code = $("#adminOtp").value.trim();
    if (!code) { $("#loginErr").textContent = "کد پیامک‌شده را وارد کن."; return; }
    await authApi("/otp/verify", { method: "POST", body: { phone, code } });
    showPanel(readOverviewCache()); void loadOverview();
  } catch (error) {
    if ($("#login").style.display !== "") $("#loginErr").textContent = error.message || "ورود ممکن نشد";
  } finally { setLoginBusy(false); }
};
$("#changePhone").onclick = () => { showLogin(); $("#adminPhone").focus(); };
$("#logout").onclick = async () => {
  $("#logout").disabled = true;
  try { await authApi("/logout", { method: "POST" }); }
  finally { clearOverviewCache(); $("#logout").disabled = false; showLogin(); $("#adminPhone").focus(); }
};
$("#refreshOverview").onclick = () => loadOverview();
$("#overviewRetry").onclick = () => loadOverview();

function selectTab(name, refresh) {
  document.querySelectorAll("nav button").forEach((button) => {
    const selected = button.dataset.tab === name;
    button.classList.toggle("on", selected); button.setAttribute("aria-selected", String(selected));
  });
  ["overview", "users", "payments", "plans", "discounts"].forEach((tab) => $("#tab-" + tab).style.display = tab === name ? "" : "none");
  if (refresh && name === "overview") loadOverview();
  if (name === "users") loadUsers();
  if (name === "payments") loadPayments();
  if (name === "plans") loadPlans();
  if (name === "discounts") loadDiscounts();
}
document.querySelectorAll("nav button").forEach((button) => button.onclick = () => selectTab(button.dataset.tab, true));

const fa = (n) => Number(n || 0).toLocaleString("fa-IR");
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const dt = (v) => v ? new Date(v).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";
const localPhone = (p) => (p || "").startsWith("98") ? "0" + p.slice(2) : p;
const formatBytes = (value) => {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return fa(bytes) + " بایت";
  if (bytes < 1048576) return Number(bytes / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " کیلوبایت";
  return Number(bytes / 1048576).toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " مگابایت";
};

function renderOverview(o) {
  const group = (title, items, tone = "") => '<section class="metric-group ' + tone + '"><div class="metric-group-head"><h3>' + title + '</h3></div><div class="metric-grid">' + items.map(([label, value, state]) => '<article class="metric ' + (state || "") + '"><div class="k">' + label + '</div><div class="v">' + value + "</div></article>").join("") + "</div></section>";
  $("#ovCards").innerHTML =
    group("امروز", [
      ["کاربر جدید", fa(o.users.last24h)], ["پرداخت موفق", fa(o.payments.paidLast24h)],
      ["درآمد (تومان)", fa(o.payments.revenueTomanLast24h)], ["پیامک ارسال‌شده", fa(o.otpSentLast24h)],
    ]) +
    group("کسب‌وکار", [
      ["کل کاربران", fa(o.users.total)], ["اشتراک فعال", fa(o.activeSubscriptions)],
      ["دفعات شروع تریال", fa(o.trialStarts)],
      ["کل پرداخت موفق", fa(o.payments.paidTotal)], ["کل درآمد (تومان)", fa(o.payments.revenueToman)],
    ]) +
    group("نیاز به توجه", [
      ["در انتظار درگاه", fa(o.payments.pending), o.payments.pending > 0 ? "warn" : ""],
      ["خطای تأیید پرداخت", fa(o.alerts.verifyFailed), o.alerts.verifyFailed > 0 ? "danger" : ""],
    ], "attention");
}
function loadOverview() {
  if (overviewRequest) return overviewRequest;
  const hasMetrics = Boolean($("#ovCards .metric"));
  if (!hasMetrics) loading("ovCards");
  setStatus("در حال به‌روزرسانی آمار…");
  overviewRequest = (async () => {
    try {
      const snapshot = writeOverviewCache(await api("/overview"));
      renderOverview(snapshot.data); setStatus("آخرین به‌روزرسانی: " + updatedLabel(snapshot.savedAt));
    }
    catch (error) {
      if (!hasMetrics) errorState("ovCards", error.message || "آمار دریافت نشد", loadOverview);
      setStatus("خطا در دریافت آمار");
    } finally { overviewRequest = null; }
  })();
  return overviewRequest;
}

async function loadUsers() {
  loading("uResults", 3);
  const q = $("#uq").value.trim();
  try {
    const result = await api("/users" + (q ? "?q=" + encodeURIComponent(q) : ""));
    if (!result.users.length) { $("#uResults").innerHTML = emptyState(q ? "کاربری با این شماره یا نام کاربری پیدا نشد." : "هنوز کاربری برای نمایش نیست."); return; }
    openDetailByTarget.uResults = null;
    $("#uResults").innerHTML = '<div class="table-wrap responsive-table"><table><thead><tr><th>کاربر</th><th>روز فعال</th><th>آخرین حضور</th><th>حجم داده</th><th>رکورد</th><th>اشتراک</th><th>انقضا</th></tr></thead><tbody>' + result.users.map((u) => expandablePair([
      identityCell(u.phone, u.username), fa(u.activeDays), dt(u.lastActiveAt), formatBytes(u.syncDataBytes), fa(u.syncRecordCount), u.subscriptionActive ? "<span class='pill ok'>" + esc(u.planId || "فعال") + "</span>" : "<span class='pill mut'>غیرفعال</span>", dt(u.expiresAt)
    ], ["کاربر", "روز فعال", "آخرین حضور", "حجم داده", "رکورد", "اشتراک", "انقضا"], u.id, "user-" + u.id, 7)).join("") + "</tbody></table></div>";
    bindExpandableRows("uResults");
  } catch (error) { errorState("uResults", error.message || "فهرست کاربران دریافت نشد", loadUsers); }
}
$("#uSearch").onclick = loadUsers;
$("#uq").addEventListener("keydown", (event) => event.key === "Enter" && loadUsers());

$("#resetPasswordForm").onsubmit = async (event) => {
  event.preventDefault();
  $("#spErr").textContent = "";
  const phone = $("#spPhone").value.trim(), password = $("#spPass").value;
  if (!phone || !password) { $("#spErr").textContent = "شماره و رمز را وارد کن"; return; }
  $("#spGo").disabled = true;
  try {
    const result = await api("/users/set-password", { method: "POST", body: { phone, password } });
    alert(result.created ? "حساب ساخته شد و رمز تنظیم شد." : "رمز عبور به‌روزرسانی شد.");
    $("#spPhone").value = ""; $("#spPass").value = ""; loadUsers();
    if (result.created) void loadOverview();
  } catch (error) { $("#spErr").textContent = error.message || "ثبت رمز ممکن نشد"; }
  finally { $("#spGo").disabled = false; }
};

const userDetailCache = new Map();
const openDetailByTarget = { uResults: null, pResults: null };

function identityCell(phone, username) {
  const mark = username ? username.slice(0, 1).toUpperCase() : "ر";
  return '<div class="identity"><span class="identity-mark">' + esc(mark) + '</span><span class="identity-copy"><b dir="ltr">' + esc(localPhone(phone)) + '</b><small dir="ltr">' + esc(username ? "@" + username : "بدون نام کاربری") + '</small></span><i class="chevron" aria-hidden="true"></i></div>';
}

function expandablePair(cells, labels, userId, key, colspan) {
  const detailId = "detail-" + key;
  return '<tr class="expandable-row" tabindex="0" role="button" aria-expanded="false" aria-controls="' + esc(detailId) + '" data-user-id="' + esc(userId) + '" data-detail-key="' + esc(key) + '">' + cells.map((cell, index) => '<td data-label="' + esc(labels[index]) + '">' + cell + '</td>').join("") + '</tr><tr class="detail-row" id="' + esc(detailId) + '" data-detail-key="' + esc(key) + '" hidden><td colspan="' + colspan + '"><div class="detail-host"></div></td></tr>';
}

function cachedUserDetail(userId) {
  if (userDetailCache.has(userId)) return userDetailCache.get(userId);
  const pending = api("/users/" + encodeURIComponent(userId)).catch((error) => {
    userDetailCache.delete(userId);
    throw error;
  });
  userDetailCache.set(userId, pending);
  return pending;
}

function renderUserDetail(host, detail, userId) {
  const u = detail.user;
  host.innerHTML = '<div class="detail-shell"><div class="detail-head"><div><h3>' + esc(u.username ? "@" + u.username : localPhone(u.phone)) + '</h3><p class="muted" dir="ltr">' + esc(localPhone(u.phone)) + ' · ' + esc(u.id) + '</p></div><span class="pill ' + (detail.entitlement.status === "active" ? "ok" : "mut") + '">' + esc(detail.entitlement.planId || "بدون اشتراک") + '</span></div>' +
    '<div class="detail-grid"><div class="detail-stat"><span>تاریخ ثبت‌نام</span><strong>' + dt(u.createdAt) + '</strong></div><div class="detail-stat"><span>آخرین حضور</span><strong>' + dt(u.lastActiveAt) + '</strong></div><div class="detail-stat"><span>روزهای فعال</span><strong>' + fa(u.activeDays) + ' روز</strong></div><div class="detail-stat"><span>حجم داده همگام‌شده</span><strong>' + formatBytes(u.syncDataBytes) + '</strong></div><div class="detail-stat"><span>تعداد رکورد</span><strong>' + fa(u.syncRecordCount) + '</strong></div><div class="detail-stat"><span>انقضای دسترسی</span><strong>' + dt(detail.entitlement.expiresAt) + '</strong></div></div>' +
    '<div class="detail-actions row"><strong>اصلاح اشتراک</strong><input class="grant-months" type="number" min="-36" max="36" placeholder="ماه" aria-label="ماه هدیه یا کسر" style="width:80px"><input class="grant-days" type="number" min="-366" max="366" placeholder="روز" aria-label="روز هدیه یا کسر" style="width:80px"><button class="btn mini grant-save" type="button">ثبت اصلاح</button></div>' +
    '<section class="detail-section"><h4>پرداخت‌ها</h4><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>پلن</th><th>مبلغ</th><th>وضعیت</th><th>پیگیری</th></tr></thead><tbody>' + (detail.payments.length ? detail.payments.map((p) => "<tr><td>" + dt(p.createdAt) + "</td><td>" + esc(p.planId) + "</td><td>" + fa(p.amountToman) + " تومان</td><td>" + statusPill(p.status) + "</td><td dir='ltr'>" + esc(p.refNumber || "—") + "</td></tr>").join("") : "<tr><td colspan='5' class='muted'>پرداختی ثبت نشده است.</td></tr>") + '</tbody></table></div></section>' +
    '<section class="detail-section"><h4>تاریخچهٔ دسترسی</h4><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>منبع</th><th>مدت</th><th>تا</th></tr></thead><tbody>' + (detail.grants.length ? detail.grants.map((g) => "<tr><td>" + dt(g.createdAt) + "</td><td>" + esc(g.source) + "</td><td>" + fa(g.months) + " ماه، " + fa(g.days) + " روز</td><td>" + dt(g.expiresAfter) + "</td></tr>").join("") : "<tr><td colspan='4' class='muted'>سابقه‌ای ثبت نشده است.</td></tr>") + '</tbody></table></div></section></div>';
  host.querySelector(".grant-save").onclick = async (event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const months = Number(host.querySelector(".grant-months").value) || 0;
    const days = Number(host.querySelector(".grant-days").value) || 0;
    if (!months && !days) return alert("ماه یا روز را وارد کن");
    button.disabled = true;
    try {
      await api("/users/" + encodeURIComponent(userId) + "/grant", { method: "POST", body: { months, days, note: "panel" } });
      userDetailCache.delete(userId);
      renderUserDetail(host, await cachedUserDetail(userId), userId);
      void loadOverview();
    } catch (error) { alert(error.message || "اصلاح اشتراک انجام نشد"); button.disabled = false; }
  };
}

async function populateUserDetail(host, userId) {
  host.innerHTML = '<div class="detail-shell detail-loading"><div class="load-state"><p class="state-copy">در حال دریافت اطلاعات کاربر…</p></div></div>';
  try { renderUserDetail(host, await cachedUserDetail(userId), userId); }
  catch (error) {
    host.innerHTML = '<div class="detail-shell"><div class="error-state"><div><p class="state-copy">' + esc(error.message || "اطلاعات کاربر دریافت نشد") + '</p><button class="btn secondary mini" type="button">تلاش دوباره</button></div></div></div>';
    host.querySelector("button").onclick = (event) => { event.stopPropagation(); populateUserDetail(host, userId); };
  }
}

function toggleUserDetail(targetId, key, userId) {
  const container = $("#" + targetId);
  const rows = Array.from(container.querySelectorAll(".expandable-row"));
  const details = Array.from(container.querySelectorAll(".detail-row"));
  const selectedRow = rows.find((row) => row.dataset.detailKey === key);
  const selectedDetail = details.find((row) => row.dataset.detailKey === key);
  const closing = openDetailByTarget[targetId] === key;
  rows.forEach((row) => row.setAttribute("aria-expanded", "false"));
  details.forEach((row) => row.hidden = true);
  openDetailByTarget[targetId] = closing ? null : key;
  if (closing || !selectedRow || !selectedDetail) return;
  selectedRow.setAttribute("aria-expanded", "true");
  selectedDetail.hidden = false;
  populateUserDetail(selectedDetail.querySelector(".detail-host"), userId);
}

function bindExpandableRows(targetId) {
  $("#" + targetId).querySelectorAll(".expandable-row").forEach((row) => {
    const activate = () => toggleUserDetail(targetId, row.dataset.detailKey, row.dataset.userId);
    row.onclick = activate;
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
    };
  });
}

async function loadPayments() {
  loading("pResults", 3);
  const status = $("#pStatus").value;
  try {
    const result = await api("/payments" + (status ? "?status=" + status : ""));
    if (!result.payments.length) { $("#pResults").innerHTML = emptyState("پرداختی با این وضعیت وجود ندارد."); return; }
    openDetailByTarget.pResults = null;
    $("#pResults").innerHTML = '<div class="table-wrap responsive-table"><table><thead><tr><th>کاربر</th><th>تاریخ</th><th>پلن</th><th>مبلغ</th><th>کد تخفیف</th><th>وضعیت</th><th>پلتفرم</th><th>پیگیری</th></tr></thead><tbody>' + result.payments.map((p) => expandablePair([
      identityCell(p.phone, p.username), dt(p.createdAt), esc(p.planId), fa(p.amountToman) + " تومان", '<span dir="ltr">' + esc(p.discountCode || "—") + '</span>', statusPill(p.status), esc(p.platform || "—"), '<span dir="ltr">' + esc(p.refNumber || "—") + '</span>'
    ], ["کاربر", "تاریخ", "پلن", "مبلغ", "کد تخفیف", "وضعیت", "پلتفرم", "پیگیری"], p.userId, "payment-" + p.id, 8)).join("") + "</tbody></table></div>";
    bindExpandableRows("pResults");
  } catch (error) { errorState("pResults", error.message || "پرداخت‌ها دریافت نشدند", loadPayments); }
}
function statusPill(status) { if (status === "paid") return "<span class='pill ok'>موفق</span>"; if (status === "verify_failed") return "<span class='pill bad'>خطای تأیید</span>"; if (status === "failed") return "<span class='pill bad'>ناموفق</span>"; if (status === "canceled") return "<span class='pill mut'>لغو</span>"; return "<span class='pill mut'>" + esc(status) + "</span>"; }
$("#pReload").onclick = loadPayments;

let plansData = null;
function renderPlans(plans) {
  $("#plansResults").innerHTML = '<div class="plans-grid">' + plans.map((plan) => '<article class="plan-card" data-plan-id="' + esc(plan.id) + '"><div class="plan-card-head"><div><h3>' + esc(plan.nameFa) + '</h3><p class="muted">' + fa(plan.months) + ' ماه · ' + esc(plan.nameEn) + '</p></div><span class="pill ' + (plan.active ? "ok" : "mut") + '">' + (plan.active ? "فعال" : "غیرفعال") + '</span></div><div class="plan-price"><input type="number" min="1000" max="1000000000" step="1000" value="' + esc(plan.priceToman) + '" aria-label="قیمت ' + esc(plan.nameFa) + ' به تومان"><button class="btn mini plan-save" type="button" disabled>ذخیره</button></div><div class="plan-result" aria-live="polite">قیمت فعلی: ' + fa(plan.priceToman) + ' تومان</div></article>').join("") + '</div>';
  $("#plansResults").querySelectorAll(".plan-card").forEach((card) => {
    const plan = plans.find((item) => item.id === card.dataset.planId);
    const input = card.querySelector("input"), button = card.querySelector(".plan-save"), result = card.querySelector(".plan-result");
    input.oninput = () => {
      const value = Number(input.value);
      button.disabled = !Number.isInteger(value) || value < 1000 || value > 1000000000 || value === plan.priceToman;
      result.textContent = button.disabled ? "قیمت فعلی: " + fa(plan.priceToman) + " تومان" : "قیمت جدید: " + fa(value) + " تومان";
    };
    button.onclick = async () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 1000 || value > 1000000000 || value === plan.priceToman) return;
      if (!confirm("قیمت «" + plan.nameFa + "» از " + fa(plan.priceToman) + " به " + fa(value) + " تومان تغییر کند؟")) return;
      button.disabled = true; result.textContent = "در حال ذخیره…";
      try {
        const response = await api("/plans/" + encodeURIComponent(plan.id), { method: "POST", body: { priceToman: value } });
        plansData = plans.map((item) => item.id === response.plan.id ? response.plan : item);
        renderPlans(plansData);
      } catch (error) { result.textContent = error.message || "ذخیره قیمت انجام نشد"; button.disabled = false; }
    };
  });
}
async function loadPlans(force = false) {
  if (plansData && !force) { renderPlans(plansData); return; }
  loading("plansResults", 3);
  try { const result = await api("/plans"); plansData = result.plans; renderPlans(plansData); }
  catch (error) { errorState("plansResults", error.message || "پلن‌ها دریافت نشدند", () => loadPlans(true)); }
}
$("#plansReload").onclick = () => { plansData = null; loadPlans(true); };

async function loadDiscounts() {
  loading("dResults", 3);
  try {
    const result = await api("/discounts");
    if (!result.discounts.length) { $("#dResults").innerHTML = emptyState("هنوز کد تخفیفی ساخته نشده است."); return; }
    $("#dResults").innerHTML = '<div class="table-wrap"><table><thead><tr><th>کد</th><th>درصد</th><th>استفاده</th><th>سقف</th><th>انقضا</th><th>وضعیت</th><th><span class="muted">عمل</span></th></tr></thead><tbody>' + result.discounts.map((d) => "<tr><td dir='ltr'><b>" + esc(d.code) + "</b></td><td>" + fa(d.percent) + "٪</td><td>" + fa(d.usedCount) + "</td><td>" + (d.maxUses == null ? "∞" : fa(d.maxUses)) + "</td><td>" + dt(d.expiresAt) + "</td><td>" + (d.active ? "<span class='pill ok'>فعال</span>" : "<span class='pill mut'>خاموش</span>") + "</td><td><button class='btn secondary mini' type='button' onclick='toggleDiscount(&quot;" + esc(d.code) + "&quot;," + !d.active + ")'>" + (d.active ? "غیرفعال کن" : "فعال کن") + "</button></td></tr>").join("") + "</tbody></table></div>";
  } catch (error) { errorState("dResults", error.message || "کدهای تخفیف دریافت نشدند", loadDiscounts); }
}
window.toggleDiscount = async (code, active) => { if (!active && !confirm("این کد تخفیف غیرفعال شود؟")) return; await api("/discounts/" + encodeURIComponent(code), { method: "POST", body: { active } }); loadDiscounts(); };
$("#dCreate").onclick = async () => {
  $("#dErr").textContent = "";
  const body = { code: $("#dCode").value.trim(), percent: Number($("#dPercent").value), maxUses: $("#dMax").value ? Number($("#dMax").value) : null, expiresAt: $("#dExp").value ? new Date($("#dExp").value + "T23:59:59").getTime() : null };
  try { await api("/discounts", { method: "POST", body }); $("#dCode").value = ""; $("#dPercent").value = ""; $("#dMax").value = ""; $("#dExp").value = ""; loadDiscounts(); }
  catch (error) { $("#dErr").textContent = error.message || "ساخت کد ممکن نشد"; }
};

async function boot() {
  setStatus("در حال بررسی نشست مدیریت…");
  try { await authApi("/session"); showPanel(readOverviewCache()); void loadOverview(); }
  catch (error) { if (error && error.status === 401) clearOverviewCache(); showLogin(); }
}
boot();
</script>
</body>
</html>`;
