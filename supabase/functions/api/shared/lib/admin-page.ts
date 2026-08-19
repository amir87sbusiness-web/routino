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
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>روتینو — پنل مدیریت</title>
<style>
  :root{--bg:#f7f7f5;--card:#fff;--line:#e8e7e3;--txt:#292524;--mut:#78716c;--brand:#f97316;--brand-soft:#fff7ed;--ok:#16a34a;--bad:#dc2626;--shadow:0 16px 40px rgba(41,37,36,.07)}
  *{box-sizing:border-box}
  body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:radial-gradient(circle at 100% 0,#fff7ed 0,transparent 32rem),var(--bg);color:var(--txt);font-size:14px;line-height:1.6}
  header{display:flex;align-items:center;gap:13px;padding:16px max(20px,calc((100vw - 1180px)/2));background:rgba(255,255,255,.9);border-bottom:1px solid var(--line);box-shadow:0 6px 20px rgba(41,37,36,.04);position:sticky;top:0;z-index:5;backdrop-filter:blur(14px)}
  header:before{content:'R';display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(135deg,#fb923c,var(--brand));color:#fff;font-weight:900;font-size:20px;box-shadow:0 8px 18px rgba(249,115,22,.25)}
  header h1{font-size:16px;margin:0;flex:1;font-weight:900;line-height:1.25}
  header h1:after{content:'مدیریت کاربران، اشتراک و پرداخت';display:block;color:var(--mut);font-size:10px;font-weight:500;margin-top:2px}
  main{max-width:1180px;margin:0 auto;padding:28px 20px 48px}
  nav{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;padding:6px;background:rgba(255,255,255,.72);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
  nav button{border:0;background:transparent;color:var(--mut);border-radius:13px;padding:10px 14px;font:inherit;cursor:pointer;transition:.18s ease}
  nav button:hover{background:var(--brand-soft);color:var(--brand)}
  nav button.on{background:var(--brand);color:#fff;font-weight:800;box-shadow:0 8px 18px rgba(249,115,22,.22)}
  section{animation:rise .22s ease both}
  @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}
  .card .v{font-size:26px;font-weight:900;margin-top:5px;letter-spacing:-.03em}
  .card .k{color:var(--mut);font-size:12px}
  #tab-users,#tab-payments,#tab-discounts{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:var(--shadow)}
  table{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  th,td{padding:11px 12px;text-align:right;border-bottom:1px solid var(--line);font-size:12.5px;white-space:nowrap}
  tr:last-child td{border-bottom:0} th{background:#fafaf9;color:var(--mut);font-weight:700}
  tbody tr:hover{background:#fffaf5}
  .wrap{overflow-x:auto;border-radius:14px}
  .pill{border-radius:999px;padding:3px 10px;font-size:11px;font-weight:800}
  .pill.ok{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.pill.mut{background:#f1f5f9;color:#475569}
  .row{display:flex;gap:9px;margin-bottom:15px;flex-wrap:wrap;align-items:center}
  input,select{font:inherit;border:1px solid var(--line);border-radius:12px;padding:9px 12px;background:#fff;min-height:40px;outline:0;transition:.18s}
  input:focus,select:focus{border-color:#fb923c;box-shadow:0 0 0 3px rgba(249,115,22,.12)}
  button.act{font:inherit;border:0;border-radius:12px;padding:9px 15px;background:var(--brand);color:#fff;cursor:pointer;font-weight:800;min-height:40px;transition:.18s}
  button.act:hover{filter:brightness(.96);transform:translateY(-1px)}
  button.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  button.mini{font-size:11px;padding:5px 10px;border-radius:9px;min-height:30px}
  #login{max-width:390px;margin:12vh auto;padding:30px 24px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow)}
  #login h2{margin:0 0 6px;font-size:22px} #login input{width:100%;margin:14px 0 10px;text-align:center}
  #login .act{width:100%}
  .err{color:var(--bad);font-size:12px;min-height:18px}
  dialog{border:1px solid var(--line);border-radius:20px;padding:22px;max-width:680px;width:calc(100% - 40px);font-family:inherit;box-shadow:0 24px 80px rgba(0,0,0,.2)}
  dialog::backdrop{background:rgba(28,25,23,.42);backdrop-filter:blur(3px)}
  h3{margin:4px 0 12px}.muted{color:var(--mut);font-size:12px}
  @media(max-width:640px){main{padding:18px 12px 36px}nav{grid-template-columns:repeat(2,1fr)}#tab-users,#tab-payments,#tab-discounts{padding:13px;border-radius:16px}.row>*{flex:1 1 140px}}
</style>
</head>
<body>
<header><h1>🛠️ روتینو — پنل مدیریت</h1><button class="ghost act" id="logout" style="display:none">خروج</button></header>

<div id="login">
  <h2>ورود مدیر</h2>
  <p class="muted">توکن ادمین (ADMIN_TOKEN) را وارد کن.</p>
  <input id="tok" type="password" placeholder="ADMIN_TOKEN" dir="ltr">
  <div class="err" id="loginErr"></div>
  <button class="act" id="enter">ورود</button>
</div>

<main id="panel" style="display:none">
  <nav>
    <button data-tab="overview" class="on">آمار</button>
    <button data-tab="users">کاربران</button>
    <button data-tab="payments">پرداخت‌ها</button>
    <button data-tab="discounts">کدهای تخفیف</button>
  </nav>

  <section id="tab-overview"><div class="cards" id="ovCards"></div></section>

  <section id="tab-users" style="display:none">
    <div class="row">
      <input id="uq" placeholder="جستجوی شماره…" dir="ltr">
      <button class="act" id="uSearch">جستجو</button>
    </div>
    <div class="row" style="border:1px dashed var(--line);border-radius:12px;padding:12px;background:var(--card)">
      <span style="font-weight:700">تنظیم/ریست رمز عبور:</span>
      <input id="spPhone" placeholder="شماره (مثل 09…)" dir="ltr" style="width:150px">
      <input id="spPass" type="text" placeholder="رمز عبور جدید" dir="ltr" style="width:170px">
      <button class="act" id="spGo">اعمال</button>
      <span class="muted">اگر حساب نباشد، ساخته می‌شود.</span>
    </div>
    <div class="err" id="spErr"></div>
    <div class="wrap"><table id="uTable"></table></div>
  </section>

  <section id="tab-payments" style="display:none">
    <div class="row">
      <select id="pStatus">
        <option value="">همه</option><option value="paid">موفق</option><option value="redirected">در درگاه</option>
        <option value="pending">در انتظار</option><option value="canceled">لغوشده</option>
        <option value="failed">ناموفق</option><option value="verify_failed">خطای تأیید</option>
      </select>
      <button class="act" id="pReload">به‌روزرسانی</button>
    </div>
    <div class="wrap"><table id="pTable"></table></div>
  </section>

  <section id="tab-discounts" style="display:none">
    <div class="row">
      <input id="dCode" placeholder="کد (مثل EID1405)" dir="ltr">
      <input id="dPercent" type="number" min="1" max="100" placeholder="٪" style="width:70px">
      <input id="dMax" type="number" min="1" placeholder="سقف استفاده" style="width:110px">
      <input id="dExp" type="date" title="تاریخ انقضا">
      <button class="act" id="dCreate">ساخت کد</button>
    </div>
    <div class="err" id="dErr"></div>
    <div class="wrap"><table id="dTable"></table></div>
  </section>
</main>

<dialog id="userDlg"></dialog>

<script>
const $ = (s) => document.querySelector(s);
let TOKEN = localStorage.getItem("routino:admin-token") || "";

async function api(path, opts = {}) {
  const res = await fetch("/v1/admin" + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", "x-admin-token": TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin("توکن نامعتبر است"); throw new Error("unauthorized"); }
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || res.status);
  return body;
}

function showLogin(msg) {
  $("#login").style.display = ""; $("#panel").style.display = "none"; $("#logout").style.display = "none";
  $("#loginErr").textContent = msg || "";
}
function showPanel() {
  $("#login").style.display = "none"; $("#panel").style.display = ""; $("#logout").style.display = "";
  loadOverview();
}

$("#enter").onclick = async () => {
  TOKEN = $("#tok").value.trim();
  try { await api("/overview"); localStorage.setItem("routino:admin-token", TOKEN); showPanel(); }
  catch (e) { /* showLogin already ran on 401 */ }
};
$("#tok").addEventListener("keydown", (e) => e.key === "Enter" && $("#enter").click());
$("#logout").onclick = () => { localStorage.removeItem("routino:admin-token"); TOKEN = ""; showLogin(); };

document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on");
  ["overview","users","payments","discounts"].forEach((t) => $("#tab-" + t).style.display = t === b.dataset.tab ? "" : "none");
  if (b.dataset.tab === "overview") loadOverview();
  if (b.dataset.tab === "users") loadUsers();
  if (b.dataset.tab === "payments") loadPayments();
  if (b.dataset.tab === "discounts") loadDiscounts();
}));

const fa = (n) => Number(n || 0).toLocaleString("fa-IR");
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const dt = (v) => v ? new Date(v).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";
const localPhone = (p) => (p || "").startsWith("98") ? "0" + p.slice(2) : p;

async function loadOverview() {
  const o = await api("/overview");
  // verify_failed = مغایرت مبلغ با درگاه. هرگز نباید رخ دهد؛ اگر شد همان روز پیگیری کن.
  const alert = (o.alerts && o.alerts.verifyFailed > 0)
    ? '<div class="card" style="grid-column:1/-1;background:#fee2e2;border-color:#fca5a5"><div class="k" style="color:#991b1b">⚠️ پرداخت با خطای تأیید (مغایرت مبلغ) — همین امروز پیگیری کن</div><div class="v" style="color:#991b1b">' + fa(o.alerts.verifyFailed) + '</div></div>'
    : "";
  $("#ovCards").innerHTML = alert + [
    ["کل کاربران", fa(o.users.total)],
    ["کاربر جدید (۲۴س)", fa(o.users.last24h)],
    ["اشتراک فعال", fa(o.activeSubscriptions)],
    ["پرداخت موفق", fa(o.payments.paidTotal)],
    ["درآمد کل (تومان)", fa(o.payments.revenueToman)],
    ["درآمد ۲۴س (تومان)", fa(o.payments.revenueTomanLast24h)],
    ["در انتظار درگاه", fa(o.payments.pending)],
    ["پیامک ۲۴س", fa(o.otpSentLast24h)],
  ].map(([k, v]) => '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>").join("");
}

async function loadUsers() {
  const q = $("#uq").value.trim();
  const { users } = await api("/users" + (q ? "?q=" + encodeURIComponent(q) : ""));
  $("#uTable").innerHTML =
    "<tr><th>شماره</th><th>ثبت‌نام</th><th>اشتراک</th><th>انقضا</th><th>وضعیت</th><th></th></tr>" +
    users.map((u) =>
      "<tr><td dir='ltr'>" + esc(localPhone(u.phone)) + "</td><td>" + dt(u.createdAt) + "</td>" +
      "<td>" + esc(u.planId || "—") + "</td><td>" + dt(u.expiresAt) + "</td>" +
      "<td>" + (u.blocked ? "<span class='pill bad'>مسدود</span>" : u.subscriptionActive ? "<span class='pill ok'>فعال</span>" : "<span class='pill mut'>غیرفعال</span>") + "</td>" +
      "<td><button class='act mini' onclick='openUser(\\"" + u.id + "\\")'>جزئیات</button></td></tr>"
    ).join("");
}
$("#uSearch").onclick = loadUsers;
$("#uq").addEventListener("keydown", (e) => e.key === "Enter" && loadUsers());

$("#spGo").onclick = async () => {
  $("#spErr").textContent = "";
  const phone = $("#spPhone").value.trim(), password = $("#spPass").value;
  if (!phone || !password) { $("#spErr").textContent = "شماره و رمز را وارد کن"; return; }
  try {
    const r = await api("/users/set-password", { method: "POST", body: { phone, password } });
    alert(r.created ? "حساب ساخته شد و رمز تنظیم شد ✅" : "رمز عبور به‌روزرسانی شد ✅");
    $("#spPhone").value = ""; $("#spPass").value = ""; loadUsers();
  } catch (e) { $("#spErr").textContent = e.message; }
};

window.openUser = async (id) => {
  const d = await api("/users/" + id);
  const dlg = $("#userDlg");
  dlg.innerHTML =
    "<h3 dir='ltr'>" + esc(localPhone(d.user.phone)) + "</h3>" +
    "<p class='muted'>اشتراک: " + esc(d.entitlement.planId || "—") + " تا " + dt(d.entitlement.expiresAt) +
    (d.user.blocked ? " — <b style='color:var(--bad)'>مسدود</b>" : "") + "</p>" +
    "<p class='muted'>امنیت دستگاه: سقف " + fa(d.user.maxActiveDevices) + " دستگاه — " + fa(d.user.switchCount30d) + " جابه‌جایی در ۱۵ روز" +
    (d.user.securityLockedAt ? " — <b style='color:var(--bad)'>قفل امنیتی</b>" : "") + "</p>" +
    "<div class='row'>" +
      "<input id='gMonths' type='number' min='0' max='36' placeholder='ماه' style='width:70px'>" +
      "<input id='gDays' type='number' min='0' max='366' placeholder='روز' style='width:70px'>" +
      "<button class='act mini' id='gGo'>گرنت اشتراک</button>" +
      "<button class='act mini " + (d.user.blocked ? "" : "ghost") + "' id='bGo'>" + (d.user.blocked ? "رفع مسدودی" : "مسدود کردن") + "</button>" +
      "<button class='ghost act mini' onclick='userDlg.close()'>بستن</button>" +
    "</div>" +
    "<div class='row' style='margin-top:10px'>" +
      "<input id='maxDevices' type='number' min='1' max='10' value='" + esc(d.user.maxActiveDevices) + "' aria-label='حداکثر دستگاه فعال' style='width:90px'>" +
      "<button class='act mini' id='devicePolicyGo'>ثبت سقف دستگاه</button>" +
      "<button class='ghost act mini' id='resetSwitchGo'>صفرکردن شمارنده ۳۰روزه</button>" +
      (d.user.securityLockedAt ? "<button class='act mini' id='unlockGo'>رفع قفل امنیتی</button>" : "") +
    "</div>" +
    "<h4>پرداخت‌ها</h4><div class='wrap'><table>" +
    "<tr><th>تاریخ</th><th>پلن</th><th>مبلغ</th><th>وضعیت</th><th>پیگیری</th></tr>" +
    d.payments.map((p) => "<tr><td>" + dt(p.createdAt) + "</td><td>" + esc(p.planId) + "</td><td>" + fa(p.amountToman) + "</td><td>" + esc(p.status) + "</td><td dir='ltr'>" + esc(p.refNumber || "—") + "</td></tr>").join("") +
    "</table></div>" +
    "<h4>تاریخچه دسترسی</h4><div class='wrap'><table>" +
    "<tr><th>تاریخ</th><th>منبع</th><th>مدت</th><th>تا</th></tr>" +
    d.grants.map((g) => "<tr><td>" + dt(g.createdAt) + "</td><td>" + esc(g.source) + "</td><td>" + fa(g.months) + " ماه " + fa(g.days) + " روز</td><td>" + dt(g.expiresAfter) + "</td></tr>").join("") +
    "</table></div>" +
    "<h4>دستگاه‌ها</h4><div class='wrap'><table>" +
    "<tr><th>نام</th><th>پلتفرم</th><th>آخرین فعالیت</th><th>ساخت</th><th>وضعیت</th></tr>" +
    (d.devices.length ? d.devices : []).map((v) => "<tr><td>" + esc(v.name || "—") + "</td><td>" + esc([v.platform, v.browser, v.os].filter(Boolean).join(" · ") || "—") + "</td><td>" + dt(v.lastSeenAt) + "</td><td>" + dt(v.createdAt) + "</td><td>" + (v.revokedAt ? "<span class='pill mut'>باطل‌شده</span>" : "<span class='pill ok'>فعال</span>") + "</td></tr>").join("") +
    "</table></div>";
  dlg.showModal();
  $("#gGo").onclick = async () => {
    const months = Number($("#gMonths").value) || 0, days = Number($("#gDays").value) || 0;
    if (!months && !days) return alert("ماه یا روز را وارد کن");
    await api("/users/" + id + "/grant", { method: "POST", body: { months, days, note: "panel" } });
    dlg.close(); loadUsers();
  };
  $("#bGo").onclick = async () => {
    if (!confirm(d.user.blocked ? "رفع مسدودی؟" : "این کاربر مسدود شود؟")) return;
    await api("/users/" + id + "/block", { method: "POST", body: { blocked: !d.user.blocked } });
    dlg.close(); loadUsers();
  };
  $("#devicePolicyGo").onclick = async () => {
    const maxActiveDevices = Number($("#maxDevices").value);
    if (!Number.isInteger(maxActiveDevices) || maxActiveDevices < 1 || maxActiveDevices > 10) return alert("عدد باید بین ۱ تا ۱۰ باشد");
    await api("/users/" + id + "/device-policy", { method: "POST", body: { maxActiveDevices } });
    dlg.close(); window.openUser(id);
  };
  $("#resetSwitchGo").onclick = async () => {
    if (!confirm("شمارنده جابه‌جایی ۱۵روزه صفر شود؟")) return;
    await api("/users/" + id + "/device-policy", { method: "POST", body: { resetSwitchCount: true } });
    dlg.close(); window.openUser(id);
  };
  if ($("#unlockGo")) $("#unlockGo").onclick = async () => {
    if (!confirm("قفل امنیتی حساب رفع شود؟")) return;
    await api("/users/" + id + "/device-policy", { method: "POST", body: { unlock: true, resetSwitchCount: true } });
    dlg.close(); window.openUser(id);
  };
};

async function loadPayments() {
  const s = $("#pStatus").value;
  const { payments } = await api("/payments" + (s ? "?status=" + s : ""));
  $("#pTable").innerHTML =
    "<tr><th>تاریخ</th><th>شماره</th><th>پلن</th><th>مبلغ (ت)</th><th>کد تخفیف</th><th>وضعیت</th><th>پلتفرم</th><th>پیگیری</th></tr>" +
    payments.map((p) =>
      "<tr><td>" + dt(p.createdAt) + "</td><td dir='ltr'>" + esc(localPhone(p.phone)) + "</td><td>" + esc(p.planId) + "</td>" +
      "<td>" + fa(p.amountToman) + "</td><td dir='ltr'>" + esc(p.discountCode || "—") + "</td>" +
      "<td>" + statusPill(p.status) + "</td><td>" + esc(p.platform || "—") + "</td><td dir='ltr'>" + esc(p.refNumber || "—") + "</td></tr>"
    ).join("");
}
function statusPill(s) {
  if (s === "paid") return "<span class='pill ok'>موفق</span>";
  if (s === "canceled") return "<span class='pill mut'>لغو</span>";
  if (s === "verify_failed") return "<span class='pill bad'>خطای تأیید ⚠️</span>";
  if (s === "failed") return "<span class='pill bad'>ناموفق</span>";
  return "<span class='pill mut'>" + esc(s) + "</span>";
}
$("#pReload").onclick = loadPayments;

async function loadDiscounts() {
  const { discounts } = await api("/discounts");
  $("#dTable").innerHTML =
    "<tr><th>کد</th><th>٪</th><th>استفاده</th><th>سقف</th><th>انقضا</th><th>وضعیت</th><th></th></tr>" +
    discounts.map((d) =>
      "<tr><td dir='ltr'><b>" + esc(d.code) + "</b></td><td>" + fa(d.percent) + "</td><td>" + fa(d.usedCount) + "</td>" +
      "<td>" + (d.maxUses == null ? "∞" : fa(d.maxUses)) + "</td><td>" + dt(d.expiresAt) + "</td>" +
      "<td>" + (d.active ? "<span class='pill ok'>فعال</span>" : "<span class='pill mut'>خاموش</span>") + "</td>" +
      "<td><button class='ghost act mini' onclick='toggleDiscount(\\"" + esc(d.code) + "\\"," + !d.active + ")'>" + (d.active ? "غیرفعال کن" : "فعال کن") + "</button></td></tr>"
    ).join("");
}
window.toggleDiscount = async (code, active) => { await api("/discounts/" + encodeURIComponent(code), { method: "POST", body: { active } }); loadDiscounts(); };
$("#dCreate").onclick = async () => {
  $("#dErr").textContent = "";
  const body = {
    code: $("#dCode").value.trim(),
    percent: Number($("#dPercent").value),
    maxUses: $("#dMax").value ? Number($("#dMax").value) : null,
    expiresAt: $("#dExp").value ? new Date($("#dExp").value + "T23:59:59").getTime() : null,
  };
  try { await api("/discounts", { method: "POST", body }); $("#dCode").value = ""; $("#dPercent").value = ""; $("#dMax").value = ""; $("#dExp").value = ""; loadDiscounts(); }
  catch (e) { $("#dErr").textContent = e.message; }
};

if (TOKEN) { api("/overview").then(showPanel).catch(() => {}); } else { showLogin(); }
</script>
</body>
</html>`;
