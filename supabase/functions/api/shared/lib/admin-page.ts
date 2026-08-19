// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * The admin panel page — one self-contained HTML string.
 *
 * Framework-free so both HTTP layers (Fastify locally, the Supabase Edge
 * Function in production) serve the exact same panel. It talks to /v1/admin/*
 * with the token the operator enters (kept in localStorage, sent only as a
 * header); without a valid token every call returns 401, so the shell reveals
 * nothing but the fact an admin panel exists.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>روتینو — پنل مدیریت</title>
<style>
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
  .token{width:100%;margin-bottom:10px;text-align:center;letter-spacing:.03em}.err{min-height:22px;margin:4px 0;color:var(--bad);font-size:12px}.err:not(:empty){padding:6px 9px;background:var(--bad-soft);border-radius:9px}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:8px 13px;border:1px solid transparent;border-radius:12px;background:var(--brand);color:#fff;font-weight:700;cursor:pointer;transition:transform .15s ease,background .15s ease,box-shadow .15s ease}.btn:hover{background:#c75f12;box-shadow:0 7px 16px rgba(188,81,15,.17)}.btn:active{transform:scale(.98)}.btn:disabled{cursor:wait;opacity:.6;box-shadow:none}.btn.secondary{border-color:var(--line);background:var(--surface);color:var(--txt)}.btn.secondary:hover{background:var(--surface-soft);box-shadow:none}.btn.danger{background:var(--bad)}.btn.mini{min-height:34px;padding:5px 10px;border-radius:9px;font-size:11px}
  .login-card .btn{width:100%;margin-top:3px}.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:2px 0 16px}.panel-head h2{margin:0;font-size:20px;letter-spacing:-.03em}.panel-head p{margin:2px 0 0;color:var(--mut);font-size:12px}
  nav{display:flex;gap:8px;overflow-x:auto;margin:0 -16px 18px;padding:0 16px 4px;scrollbar-width:none}nav::-webkit-scrollbar{display:none}nav button{flex:0 0 auto;min-height:42px;padding:8px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--mut);font-weight:700;cursor:pointer;transition:background .15s,color .15s,border-color .15s}nav button:hover{background:var(--surface-soft);color:var(--txt)}nav button.on{border-color:transparent;background:var(--brand);color:#fff;box-shadow:0 6px 14px rgba(188,81,15,.16)}
  .cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{min-height:118px;padding:15px;background:var(--surface);border:1px solid var(--line);border-radius:17px;box-shadow:0 1px 3px rgba(62,47,33,.035)}.metric .k{color:var(--mut);font-size:11px;font-weight:700}.metric .v{margin-top:4px;font-size:clamp(20px,5vw,28px);font-weight:900;line-height:1.35;font-variant-numeric:tabular-nums}.metric.alert{grid-column:1/-1;min-height:auto;border-color:#f3b1a9;background:var(--bad-soft)}.metric.alert .k,.metric.alert .v{color:#9f2727}
  .section-surface{padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(62,47,33,.035)}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row + .row{margin-top:10px}.row input:not([type="number"]){min-width:0;flex:1 1 180px}.helper{padding:11px 12px;background:var(--surface-soft);border:1px dashed #d7d0c6;border-radius:13px}.helper strong{font-size:12px}.muted{color:var(--mut);font-size:12px}
  .result{margin-top:12px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface)}table{width:100%;min-width:700px;border-collapse:collapse}th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle;white-space:nowrap;font-size:12px}th{position:sticky;top:0;background:var(--surface-soft);color:var(--mut);font-size:11px;font-weight:700}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#fffaf5}.pill{display:inline-flex;align-items:center;min-height:24px;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:900}.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.mut{background:#f1efeb;color:#716960}
  .empty,.load-state,.error-state{display:grid;place-items:center;min-height:170px;padding:24px;text-align:center;color:var(--mut);border:1px dashed #d8d1c8;border-radius:14px;background:var(--surface-soft)}.error-state{color:var(--bad);border-color:#f3b1a9;background:var(--bad-soft)}.state-copy{max-width:30rem;margin:0 0 10px;font-size:12px}.skeleton{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sk{height:118px;border-radius:17px;background:linear-gradient(100deg,#f2efe9 30%,#faf8f4 48%,#f2efe9 66%);background-size:200% 100%;animation:shine 1.2s linear infinite}@keyframes shine{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
  dialog{width:min(720px,calc(100% - 32px));max-height:min(86vh,780px);padding:0;overflow:hidden;border:0;border-radius:22px;background:var(--surface);color:var(--txt);box-shadow:0 24px 80px rgba(45,34,23,.28)}dialog::backdrop{background:rgba(35,29,24,.48);backdrop-filter:blur(2px)}.dialog-body{max-height:min(86vh,780px);padding:20px;overflow:auto}.dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.dialog-head h2{margin:0;font-size:18px}.dialog-head p{margin:2px 0 0}.dialog-actions{padding-bottom:14px;border-bottom:1px solid var(--line)}.dialog-section{margin-top:18px}.dialog-section h3{margin:0 0 8px;font-size:13px}.dialog-section .table-wrap{border-radius:12px}.dialog-section table{min-width:540px}.close{min-width:42px;padding:8px}.dialog-load{min-height:300px}
  @media (min-width:680px){.topbar{padding-inline:max(24px,env(safe-area-inset-right))}.status{display:block}.cards{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{min-height:128px;padding:17px}.panel-head h2{font-size:23px}.section-surface{padding:16px}.toolbar{gap:8px}}
  @media (min-width:1024px){main{padding-top:28px}.cards{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.metric{min-height:136px}.metric .v{font-size:29px}.panel-head{margin-bottom:20px}nav{margin:0 0 20px;padding:0}.section-surface{padding:18px}}
  @media (max-width:679px){.toolbar .btn{min-width:42px;padding-inline:10px}.toolbar .btn .wide-label{display:none}.toolbar .btn .short-label{display:inline}.login-card{padding:24px 20px}.panel-head{align-items:flex-start;flex-direction:column}.panel-head .btn{width:100%}dialog{width:100%;max-width:none;height:100dvh;max-height:100dvh;margin:0;border-radius:0}.dialog-body{max-height:100dvh;min-height:100dvh;padding:18px max(16px,env(safe-area-inset-right)) calc(22px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}.dialog-actions .btn{flex:1 1 130px}.dialog-section table{min-width:500px}}
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
    <p>برای دیدن اطلاعات حساب‌ها، توکن امن مدیریت را وارد کن.</p>
    <label class="field-label" for="tok">توکن مدیریت</label>
    <input class="token" id="tok" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password" dir="ltr" required>
    <div class="err" id="loginErr" role="alert" aria-live="assertive"></div>
    <button class="btn" type="submit" id="enter">ورود به پنل</button>
  </form>
</div>

<main id="panel" style="display:none">
  <div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>
  <nav aria-label="بخش‌های پنل" role="tablist">
    <button type="button" role="tab" aria-selected="true" aria-controls="tab-overview" id="tab-button-overview" data-tab="overview" class="on">آمار</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-users" id="tab-button-users" data-tab="users">کاربران</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-payments" id="tab-button-payments" data-tab="payments">پرداخت‌ها</button>
    <button type="button" role="tab" aria-selected="false" aria-controls="tab-discounts" id="tab-button-discounts" data-tab="discounts">کدهای تخفیف</button>
  </nav>

  <section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="cards" id="ovCards" aria-live="polite"></div></section>

  <section id="tab-users" role="tabpanel" aria-labelledby="tab-button-users" style="display:none">
    <div class="section-surface">
      <div class="row"><input id="uq" placeholder="جستجوی شمارهٔ موبایل…" aria-label="جستجوی شمارهٔ موبایل" inputmode="tel" dir="ltr"><button class="btn" type="button" id="uSearch">جستجو</button></div>
      <div class="helper row"><strong>تنظیم یا ریست رمز عبور</strong><input id="spPhone" placeholder="شماره (مثل 09…)" aria-label="شماره برای تنظیم رمز" inputmode="tel" dir="ltr"><input id="spPass" type="text" placeholder="رمز عبور جدید" aria-label="رمز عبور جدید" autocomplete="new-password" dir="ltr"><button class="btn" type="button" id="spGo">اعمال</button><span class="muted">برای شمارهٔ تازه، حساب آزمایشی ساخته می‌شود.</span></div>
      <div class="err" id="spErr" role="alert"></div>
      <div class="result" id="uResults" aria-live="polite"></div>
    </div>
  </section>

  <section id="tab-payments" role="tabpanel" aria-labelledby="tab-button-payments" style="display:none">
    <div class="section-surface"><div class="row"><label class="field-label" for="pStatus" style="margin:0">وضعیت پرداخت</label><select id="pStatus"><option value="">همه</option><option value="paid">موفق</option><option value="redirected">در درگاه</option><option value="pending">در انتظار</option><option value="canceled">لغوشده</option><option value="failed">ناموفق</option><option value="verify_failed">خطای تأیید</option></select><button class="btn" type="button" id="pReload">به‌روزرسانی</button></div><div class="result" id="pResults" aria-live="polite"></div></div>
  </section>

  <section id="tab-discounts" role="tabpanel" aria-labelledby="tab-button-discounts" style="display:none">
    <div class="section-surface"><div class="row"><input id="dCode" placeholder="کد (مثل EID1405)" aria-label="کد تخفیف" dir="ltr"><input id="dPercent" type="number" min="1" max="100" placeholder="درصد" aria-label="درصد تخفیف" style="width:82px"><input id="dMax" type="number" min="1" placeholder="سقف استفاده" aria-label="سقف استفاده" style="width:118px"><input id="dExp" type="date" title="تاریخ انقضا" aria-label="تاریخ انقضا"><button class="btn" type="button" id="dCreate">ساخت کد</button></div><div class="err" id="dErr" role="alert"></div><div class="result" id="dResults" aria-live="polite"></div></div>
  </section>
</main>

<dialog id="userDlg" aria-modal="true"></dialog>

<script>
const $ = (s) => document.querySelector(s);
let TOKEN = localStorage.getItem("routino:admin-token") || "";

async function api(path, opts = {}) {
  const res = await fetch("/v1/admin" + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", "x-admin-token": TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin("توکن نامعتبر است"); throw new Error("توکن نامعتبر است"); }
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || "دریافت اطلاعات ممکن نشد");
  return body;
}

function setStatus(message) { $("#pageStatus").textContent = message || ""; }
function showLogin(message) {
  $("#login").style.display = ""; $("#panel").style.display = "none";
  $("#logout").style.display = "none"; $("#refreshOverview").style.display = "none";
  $("#loginErr").textContent = message || ""; setStatus("");
}
function showPanel(overview) {
  $("#login").style.display = "none"; $("#panel").style.display = "";
  $("#logout").style.display = ""; $("#refreshOverview").style.display = "";
  renderOverview(overview); setStatus("آمار به‌روز است");
}
function setLoginBusy(busy) { $("#enter").disabled = busy; $("#enter").textContent = busy ? "در حال ورود…" : "ورود به پنل"; }
function loading(target, count = 4) { $("#" + target).innerHTML = '<div class="skeleton">' + Array(count).fill('<div class="sk"></div>').join("") + "</div>"; }
function errorState(target, message, retry) {
  $("#" + target).innerHTML = '<div class="error-state"><div><p class="state-copy">' + esc(message) + '</p><button class="btn secondary mini" type="button">تلاش دوباره</button></div></div>';
  $("#" + target + " button").onclick = retry;
}
function emptyState(message) { return '<div class="empty"><p class="state-copy">' + esc(message) + "</p></div>"; }

$("#loginForm").onsubmit = async (event) => {
  event.preventDefault();
  TOKEN = $("#tok").value.trim();
  if (!TOKEN) return;
  $("#loginErr").textContent = ""; setLoginBusy(true);
  try {
    const overview = await api("/overview");
    localStorage.setItem("routino:admin-token", TOKEN);
    showPanel(overview);
  } catch (error) {
    if ($("#login").style.display !== "") $("#loginErr").textContent = error.message || "ورود ممکن نشد";
  } finally { setLoginBusy(false); }
};
$("#logout").onclick = () => { localStorage.removeItem("routino:admin-token"); TOKEN = ""; showLogin(); $("#tok").focus(); };
$("#refreshOverview").onclick = () => loadOverview();
$("#overviewRetry").onclick = () => loadOverview();

function selectTab(name, refresh) {
  document.querySelectorAll("nav button").forEach((button) => {
    const selected = button.dataset.tab === name;
    button.classList.toggle("on", selected); button.setAttribute("aria-selected", String(selected));
  });
  ["overview", "users", "payments", "discounts"].forEach((tab) => $("#tab-" + tab).style.display = tab === name ? "" : "none");
  if (refresh && name === "overview") loadOverview();
  if (name === "users") loadUsers();
  if (name === "payments") loadPayments();
  if (name === "discounts") loadDiscounts();
}
document.querySelectorAll("nav button").forEach((button) => button.onclick = () => selectTab(button.dataset.tab, true));

const fa = (n) => Number(n || 0).toLocaleString("fa-IR");
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const dt = (v) => v ? new Date(v).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";
const localPhone = (p) => (p || "").startsWith("98") ? "0" + p.slice(2) : p;

function renderOverview(o) {
  const alert = o.alerts && o.alerts.verifyFailed > 0
    ? '<div class="metric alert"><div class="k">پرداخت با خطای تأیید — امروز پیگیری شود</div><div class="v">' + fa(o.alerts.verifyFailed) + "</div></div>"
    : "";
  $("#ovCards").innerHTML = alert + [
    ["کل کاربران", fa(o.users.total)], ["کاربر جدید (۲۴ ساعت)", fa(o.users.last24h)],
    ["اشتراک فعال", fa(o.activeSubscriptions)], ["پرداخت موفق", fa(o.payments.paidTotal)],
    ["درآمد کل (تومان)", fa(o.payments.revenueToman)], ["درآمد ۲۴ ساعت (تومان)", fa(o.payments.revenueTomanLast24h)],
    ["در انتظار درگاه", fa(o.payments.pending)], ["پیامک ۲۴ ساعت", fa(o.otpSentLast24h)],
  ].map(([label, value]) => '<article class="metric"><div class="k">' + label + '</div><div class="v">' + value + "</div></article>").join("");
}
async function loadOverview() {
  loading("ovCards"); setStatus("در حال به‌روزرسانی آمار…");
  try { renderOverview(await api("/overview")); setStatus("آمار به‌روز است"); }
  catch (error) { errorState("ovCards", error.message || "آمار دریافت نشد", loadOverview); setStatus("خطا در دریافت آمار"); }
}

async function loadUsers() {
  loading("uResults", 3);
  const q = $("#uq").value.trim();
  try {
    const result = await api("/users" + (q ? "?q=" + encodeURIComponent(q) : ""));
    if (!result.users.length) { $("#uResults").innerHTML = emptyState(q ? "کاربری با این شماره پیدا نشد." : "هنوز کاربری برای نمایش نیست."); return; }
    $("#uResults").innerHTML = '<div class="table-wrap"><table><thead><tr><th>شماره</th><th>ثبت‌نام</th><th>اشتراک</th><th>انقضا</th><th>وضعیت</th><th><span class="muted">عمل</span></th></tr></thead><tbody>' + result.users.map((u) =>
      "<tr><td dir='ltr'>" + esc(localPhone(u.phone)) + "</td><td>" + dt(u.createdAt) + "</td><td>" + esc(u.planId || "—") + "</td><td>" + dt(u.expiresAt) + "</td><td>" + (u.blocked ? "<span class='pill bad'>مسدود</span>" : u.subscriptionActive ? "<span class='pill ok'>فعال</span>" : "<span class='pill mut'>غیرفعال</span>") + "</td><td><button class='btn secondary mini' type='button' onclick='openUser(&quot;" + u.id + "&quot;)'>جزئیات</button></td></tr>"
    ).join("") + "</tbody></table></div>";
  } catch (error) { errorState("uResults", error.message || "فهرست کاربران دریافت نشد", loadUsers); }
}
$("#uSearch").onclick = loadUsers;
$("#uq").addEventListener("keydown", (event) => event.key === "Enter" && loadUsers());

$("#spGo").onclick = async () => {
  $("#spErr").textContent = "";
  const phone = $("#spPhone").value.trim(), password = $("#spPass").value;
  if (!phone || !password) { $("#spErr").textContent = "شماره و رمز را وارد کن"; return; }
  $("#spGo").disabled = true;
  try {
    const result = await api("/users/set-password", { method: "POST", body: { phone, password } });
    alert(result.created ? "حساب ساخته شد و رمز تنظیم شد." : "رمز عبور به‌روزرسانی شد.");
    $("#spPhone").value = ""; $("#spPass").value = ""; loadUsers();
  } catch (error) { $("#spErr").textContent = error.message || "ثبت رمز ممکن نشد"; }
  finally { $("#spGo").disabled = false; }
};

function userDialogLoading() {
  const dlg = $("#userDlg");
  dlg.innerHTML = '<div class="dialog-body dialog-load"><div class="load-state"><p class="state-copy">در حال دریافت جزئیات کاربر…</p></div></div>';
  if (!dlg.open) dlg.showModal();
}
window.openUser = async (id) => {
  userDialogLoading();
  const dlg = $("#userDlg");
  try {
    const d = await api("/users/" + id);
    dlg.innerHTML = '<div class="dialog-body"><div class="dialog-head"><div><h2 id="userDlgTitle" dir="ltr">' + esc(localPhone(d.user.phone)) + '</h2><p class="muted">اشتراک: ' + esc(d.entitlement.planId || "—") + " تا " + dt(d.entitlement.expiresAt) + (d.user.blocked ? " · <b style='color:var(--bad)'>مسدود</b>" : "") + '</p></div><button class="btn secondary close" type="button" id="closeUserDlg">بستن</button></div>' +
      '<p class="helper muted">امنیت دستگاه: سقف ' + fa(d.user.maxActiveDevices) + " دستگاه · " + fa(d.user.switchCount30d) + " جابه‌جایی در ۱۵ روز" + (d.user.securityLockedAt ? " · <b style='color:var(--bad)'>قفل امنیتی</b>" : "") + '</p>' +
      '<div class="row dialog-actions"><input id="gMonths" type="number" min="0" max="36" placeholder="ماه" aria-label="ماه هدیه" style="width:74px"><input id="gDays" type="number" min="0" max="366" placeholder="روز" aria-label="روز هدیه" style="width:74px"><button class="btn mini" type="button" id="gGo">گرنت اشتراک</button><button class="btn mini ' + (d.user.blocked ? "" : "secondary") + '" type="button" id="bGo">' + (d.user.blocked ? "رفع مسدودی" : "مسدود کردن") + '</button></div>' +
      '<div class="row helper"><input id="maxDevices" type="number" min="1" max="10" value="' + esc(d.user.maxActiveDevices) + '" aria-label="حداکثر دستگاه فعال" style="width:104px"><button class="btn secondary mini" type="button" id="devicePolicyGo">ثبت سقف دستگاه</button><button class="btn secondary mini" type="button" id="resetSwitchGo">صفرکردن شمارنده</button>' + (d.user.securityLockedAt ? '<button class="btn mini" type="button" id="unlockGo">رفع قفل امنیتی</button>' : "") + '</div>' +
      '<section class="dialog-section"><h3>پرداخت‌ها</h3><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>پلن</th><th>مبلغ</th><th>وضعیت</th><th>پیگیری</th></tr></thead><tbody>' + (d.payments.length ? d.payments.map((p) => "<tr><td>" + dt(p.createdAt) + "</td><td>" + esc(p.planId) + "</td><td>" + fa(p.amountToman) + "</td><td>" + esc(p.status) + "</td><td dir='ltr'>" + esc(p.refNumber || "—") + "</td></tr>").join("") : "<tr><td colspan='5' class='muted'>پرداختی ثبت نشده است.</td></tr>") + '</tbody></table></div></section>' +
      '<section class="dialog-section"><h3>تاریخچهٔ دسترسی</h3><div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>منبع</th><th>مدت</th><th>تا</th></tr></thead><tbody>' + (d.grants.length ? d.grants.map((g) => "<tr><td>" + dt(g.createdAt) + "</td><td>" + esc(g.source) + "</td><td>" + fa(g.months) + " ماه " + fa(g.days) + " روز</td><td>" + dt(g.expiresAfter) + "</td></tr>").join("") : "<tr><td colspan='4' class='muted'>سابقه‌ای ثبت نشده است.</td></tr>") + '</tbody></table></div></section>' +
      '<section class="dialog-section"><h3>دستگاه‌ها</h3><div class="table-wrap"><table><thead><tr><th>نام</th><th>پلتفرم</th><th>آخرین فعالیت</th><th>ساخت</th><th>وضعیت</th></tr></thead><tbody>' + (d.devices.length ? d.devices.map((v) => "<tr><td>" + esc(v.name || "—") + "</td><td>" + esc([v.platform, v.browser, v.os].filter(Boolean).join(" · ") || "—") + "</td><td>" + dt(v.lastSeenAt) + "</td><td>" + dt(v.createdAt) + "</td><td>" + (v.revokedAt ? "<span class='pill mut'>باطل‌شده</span>" : "<span class='pill ok'>فعال</span>") + "</td></tr>").join("") : "<tr><td colspan='5' class='muted'>دستگاهی ثبت نشده است.</td></tr>") + "</tbody></table></div></section></div>";
    $("#closeUserDlg").onclick = () => dlg.close();
    $("#gGo").onclick = async () => { const months = Number($("#gMonths").value) || 0, days = Number($("#gDays").value) || 0; if (!months && !days) return alert("ماه یا روز را وارد کن"); await api("/users/" + id + "/grant", { method: "POST", body: { months, days, note: "panel" } }); dlg.close(); loadUsers(); };
    $("#bGo").onclick = async () => { if (!confirm(d.user.blocked ? "رفع مسدودی این کاربر؟" : "این کاربر مسدود شود؟")) return; await api("/users/" + id + "/block", { method: "POST", body: { blocked: !d.user.blocked } }); dlg.close(); loadUsers(); };
    $("#devicePolicyGo").onclick = async () => { const maxActiveDevices = Number($("#maxDevices").value); if (!Number.isInteger(maxActiveDevices) || maxActiveDevices < 1 || maxActiveDevices > 10) return alert("عدد باید بین ۱ تا ۱۰ باشد"); await api("/users/" + id + "/device-policy", { method: "POST", body: { maxActiveDevices } }); window.openUser(id); };
    $("#resetSwitchGo").onclick = async () => { if (!confirm("شمارندهٔ جابه‌جایی ۱۵روزه صفر شود؟")) return; await api("/users/" + id + "/device-policy", { method: "POST", body: { resetSwitchCount: true } }); window.openUser(id); };
    if ($("#unlockGo")) $("#unlockGo").onclick = async () => { if (!confirm("قفل امنیتی حساب رفع شود؟")) return; await api("/users/" + id + "/device-policy", { method: "POST", body: { unlock: true, resetSwitchCount: true } }); window.openUser(id); };
  } catch (error) {
    dlg.innerHTML = '<div class="dialog-body dialog-load"><div class="error-state"><div><p class="state-copy">' + esc(error.message || "جزئیات کاربر دریافت نشد") + '</p><button class="btn secondary mini" type="button" id="retryUserDlg">تلاش دوباره</button></div></div></div>';
    $("#retryUserDlg").onclick = () => window.openUser(id);
  }
};

async function loadPayments() {
  loading("pResults", 3);
  const status = $("#pStatus").value;
  try {
    const result = await api("/payments" + (status ? "?status=" + status : ""));
    if (!result.payments.length) { $("#pResults").innerHTML = emptyState("پرداختی با این وضعیت وجود ندارد."); return; }
    $("#pResults").innerHTML = '<div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>شماره</th><th>پلن</th><th>مبلغ (تومان)</th><th>کد تخفیف</th><th>وضعیت</th><th>پلتفرم</th><th>پیگیری</th></tr></thead><tbody>' + result.payments.map((p) => "<tr><td>" + dt(p.createdAt) + "</td><td dir='ltr'>" + esc(localPhone(p.phone)) + "</td><td>" + esc(p.planId) + "</td><td>" + fa(p.amountToman) + "</td><td dir='ltr'>" + esc(p.discountCode || "—") + "</td><td>" + statusPill(p.status) + "</td><td>" + esc(p.platform || "—") + "</td><td dir='ltr'>" + esc(p.refNumber || "—") + "</td></tr>").join("") + "</tbody></table></div>";
  } catch (error) { errorState("pResults", error.message || "پرداخت‌ها دریافت نشدند", loadPayments); }
}
function statusPill(status) { if (status === "paid") return "<span class='pill ok'>موفق</span>"; if (status === "verify_failed") return "<span class='pill bad'>خطای تأیید</span>"; if (status === "failed") return "<span class='pill bad'>ناموفق</span>"; if (status === "canceled") return "<span class='pill mut'>لغو</span>"; return "<span class='pill mut'>" + esc(status) + "</span>"; }
$("#pReload").onclick = loadPayments;

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

if (TOKEN) { setStatus("در حال بررسی توکن…"); api("/overview").then(showPanel).catch(() => {}); } else { showLogin(); }
</script>
</body>
</html>`;
