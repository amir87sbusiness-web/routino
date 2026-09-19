const DASHBOARD_CSS = `
  /* Dashboard refresh: intentionally additive so existing admin actions stay untouched. */
  main{width:min(1240px,100%)}
  .panel-head{align-items:center;margin-bottom:14px}
  .panel-head h2{font-size:22px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f3f1ed;border:1px solid var(--line);border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px}
  nav button:hover{background:rgba(255,255,255,.72)}
  nav button.on{background:var(--surface);color:var(--brand);box-shadow:0 1px 4px rgba(62,47,33,.09)}
  .overview-shell{display:grid;gap:14px}
  .overview-groups{gap:12px!important}
  .metric-group{box-shadow:none}
  .metric-group-head{min-height:39px;padding:8px 13px;background:#faf9f6}
  .metric{min-height:94px;padding:13px}
  .metric .v{font-size:clamp(18px,4.5vw,25px)}
  .trend-card{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(62,47,33,.035)}
  .trend-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:15px 16px 8px}
  .trend-title h3{margin:0;font-size:14px;font-weight:900;letter-spacing:-.01em}
  .trend-title p{margin:2px 0 0;color:var(--mut);font-size:11px}
  .trend-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;color:var(--mut);font-size:11px;font-weight:700}
  .trend-summary span{display:inline-flex;align-items:center;gap:6px}
  .trend-dot{width:8px;height:8px;border-radius:999px;flex:0 0 8px}
  .trend-dot.new{background:#16a34a}.trend-dot.renew{background:#7c3aed}
  .trend-range{display:flex;flex:0 0 auto;gap:3px;padding:3px;background:#f4f2ee;border-radius:10px}
  .trend-range button{min-width:44px;min-height:31px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--mut);font:700 11px/1.2 inherit;cursor:pointer}
  .trend-range button:hover{color:var(--txt)}
  .trend-range button.on{background:#fff;color:var(--txt);box-shadow:0 1px 3px rgba(62,47,33,.1)}
  .trend-body{min-height:265px;padding:2px 10px 12px}
  .trend-loading{display:grid;min-height:255px;place-items:center;color:var(--mut);font-size:12px}
  .trend-error{display:grid;min-height:230px;place-items:center;padding:18px;text-align:center;color:var(--bad);font-size:12px}
  .trend-error button{margin-top:8px}
  .sales-chart{display:block;width:100%;height:auto;min-height:230px;overflow:visible}
  .sales-chart text{font-family:Vazirmatn,Tahoma,Arial,sans-serif;fill:#8a8178;font-size:10px}
  .sales-chart .grid{stroke:#ece8e1;stroke-width:1;vector-effect:non-scaling-stroke}
  .sales-chart .new-line{fill:none;stroke:#16a34a;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .sales-chart .renew-line{fill:none;stroke:#7c3aed;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .sales-chart .new-point{fill:#fff;stroke:#16a34a;stroke-width:2;vector-effect:non-scaling-stroke}
  .sales-chart .renew-point{fill:#fff;stroke:#7c3aed;stroke-width:2;vector-effect:non-scaling-stroke}
  @media (min-width:1024px){
    .overview-groups{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    .overview-groups .metric-group:first-child{grid-column:1/-1}
    .overview-groups .metric-group.attention{grid-column:auto!important}
    .trend-card{border-radius:20px}
    .trend-body{padding-inline:16px}
  }
  @media (max-width:679px){
    .topbar{min-height:61px;padding-block:8px}.brand p{display:none}
    main{padding-top:14px}.panel-head{align-items:flex-start}.panel-head p{max-width:30ch}
    nav{margin-inline:0;padding:3px;border-radius:12px}nav button{min-height:36px;padding-inline:11px;font-size:12px}
    .trend-head{display:grid;gap:10px;padding:14px 13px 6px}.trend-range{width:max-content}
    .trend-body{min-height:230px;padding-inline:3px}.sales-chart{min-height:210px}
  }
`;

const ORIGINAL_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="overview-groups" id="ovCards" aria-live="polite"></div></section>`;

const DASHBOARD_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview">
    <div class="overview-shell">
      <div class="overview-groups" id="ovCards" aria-live="polite"></div>
      <section class="trend-card" aria-labelledby="salesTrendTitle">
        <div class="trend-head">
          <div class="trend-title">
            <h3 id="salesTrendTitle">روند خرید روزانه</h3>
            <p>اولین خرید هر کاربر در برابر تمدیدهای بعدی</p>
            <div class="trend-summary" id="salesTrendSummary">
              <span><i class="trend-dot new"></i>خرید جدید: —</span>
              <span><i class="trend-dot renew"></i>تمدید: —</span>
            </div>
          </div>
          <div class="trend-range" aria-label="بازه نمودار">
            <button type="button" data-sales-days="7">۷ روز</button>
            <button type="button" data-sales-days="30" class="on">۳۰ روز</button>
            <button type="button" data-sales-days="90">۹۰ روز</button>
          </div>
        </div>
        <div class="trend-body" id="salesTrendBody" aria-live="polite"><div class="trend-loading">در حال دریافت روند فروش…</div></div>
      </section>
    </div>
  </section>`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var selectedDays = 30;
  var requestSerial = 0;
  var loadedOnce = false;

  function faNumber(value){ return Number(value || 0).toLocaleString("fa-IR"); }
  function safeText(value){ return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function dateLabel(day){
    try { return new Date(day + "T12:00:00Z").toLocaleDateString("fa-IR", { month:"numeric", day:"numeric" }); }
    catch (_) { return day.slice(5).replace("-","/"); }
  }
  function setRangeButtons(){
    document.querySelectorAll("[data-sales-days]").forEach(function(button){
      button.classList.toggle("on", Number(button.getAttribute("data-sales-days")) === selectedDays);
    });
  }
  function renderTrend(payload){
    var points = payload && Array.isArray(payload.points) ? payload.points : [];
    var summary = document.getElementById("salesTrendSummary");
    var totalNew = payload && payload.totals ? Number(payload.totals.newPurchases || 0) : 0;
    var totalRenew = payload && payload.totals ? Number(payload.totals.renewals || 0) : 0;
    if (summary) summary.innerHTML = '<span><i class="trend-dot new"></i>خرید جدید: ' + faNumber(totalNew) + '</span><span><i class="trend-dot renew"></i>تمدید: ' + faNumber(totalRenew) + '</span>';

    var host = document.getElementById("salesTrendBody");
    if (!host) return;
    if (!points.length){ host.innerHTML = '<div class="trend-loading">داده‌ای برای این بازه نیست.</div>'; return; }

    var width = 920, height = 286, left = 44, right = 18, top = 18, bottom = 38;
    var plotW = width - left - right, plotH = height - top - bottom;
    var maxValue = 1;
    points.forEach(function(point){ maxValue = Math.max(maxValue, Number(point.newPurchases || 0), Number(point.renewals || 0)); });
    var ceiling = Math.max(1, Math.ceil(maxValue / 4) * 4);
    function x(index){ return points.length === 1 ? left + plotW / 2 : left + (index * plotW / (points.length - 1)); }
    function y(value){ return top + plotH - (Number(value || 0) / ceiling) * plotH; }
    function pathFor(key){ return points.map(function(point,index){ return (index ? "L" : "M") + x(index).toFixed(1) + " " + y(point[key]).toFixed(1); }).join(" "); }

    var grid = "";
    for (var i=0;i<=4;i++){
      var gy = top + (plotH * i / 4);
      var gv = Math.round(ceiling * (4 - i) / 4);
      grid += '<line class="grid" x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (width-right) + '" y2="' + gy.toFixed(1) + '"></line>';
      grid += '<text x="' + (left-8) + '" y="' + (gy+3).toFixed(1) + '" text-anchor="end">' + faNumber(gv) + '</text>';
    }

    var labels = "";
    var labelCount = Math.min(5, points.length);
    var used = {};
    for (var j=0;j<labelCount;j++){
      var idx = labelCount === 1 ? 0 : Math.round(j * (points.length - 1) / (labelCount - 1));
      if (used[idx]) continue; used[idx] = true;
      labels += '<text x="' + x(idx).toFixed(1) + '" y="' + (height-10) + '" text-anchor="middle">' + safeText(dateLabel(points[idx].date)) + '</text>';
    }

    var dots = "";
    if (points.length <= 31){
      points.forEach(function(point,index){
        var px = x(index).toFixed(1);
        var ny = y(point.newPurchases).toFixed(1), ry = y(point.renewals).toFixed(1);
        var title = safeText(dateLabel(point.date) + " — خرید جدید: " + faNumber(point.newPurchases) + "، تمدید: " + faNumber(point.renewals));
        dots += '<circle class="new-point" cx="' + px + '" cy="' + ny + '" r="3.3"><title>' + title + '</title></circle>';
        dots += '<circle class="renew-point" cx="' + px + '" cy="' + ry + '" r="3.3"><title>' + title + '</title></circle>';
      });
    }

    host.innerHTML = '<svg class="sales-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="نمودار خرید جدید و تمدید اشتراک" preserveAspectRatio="xMidYMid meet" dir="ltr">' + grid + labels + '<path class="new-line" d="' + pathFor("newPurchases") + '"></path><path class="renew-line" d="' + pathFor("renewals") + '"></path>' + dots + '</svg>';
  }

  async function loadTrend(force){
    var panel = document.getElementById("panel");
    var host = document.getElementById("salesTrendBody");
    if (!panel || !host || panel.style.display === "none") return;
    if (loadedOnce && !force) return;
    var serial = ++requestSerial;
    host.innerHTML = '<div class="trend-loading">در حال دریافت روند فروش…</div>';
    try {
      var payload = await api("/sales-trend?days=" + selectedDays);
      if (serial !== requestSerial) return;
      loadedOnce = true;
      renderTrend(payload);
    } catch (error) {
      if (serial !== requestSerial) return;
      host.innerHTML = '<div class="trend-error"><div><div>' + safeText(error && error.message ? error.message : "روند فروش دریافت نشد") + '</div><button class="btn secondary mini" type="button" id="salesTrendRetry">تلاش دوباره</button></div></div>';
      var retry = document.getElementById("salesTrendRetry");
      if (retry) retry.onclick = function(){ loadTrend(true); };
    }
  }

  document.querySelectorAll("[data-sales-days]").forEach(function(button){
    button.addEventListener("click", function(){
      selectedDays = Number(button.getAttribute("data-sales-days")) || 30;
      loadedOnce = false; setRangeButtons(); loadTrend(true);
    });
  });
  ["overviewRetry","refreshOverview"].forEach(function(id){
    var button = document.getElementById(id);
    if (button) button.addEventListener("click", function(){ loadedOnce = false; loadTrend(true); });
  });
  var overviewTab = document.querySelector('nav button[data-tab="overview"]');
  if (overviewTab) overviewTab.addEventListener("click", function(){ loadTrend(false); });
  var panel = document.getElementById("panel");
  if (panel && typeof MutationObserver !== "undefined"){
    new MutationObserver(function(){ if (panel.style.display !== "none") loadTrend(false); }).observe(panel,{attributes:true,attributeFilter:["style"]});
  }
  setRangeButtons();
  setTimeout(function(){ loadTrend(false); }, 0);
})();
</script>`;

export function withAdminDashboardUi(page: string): string {
  if (!page.includes(ORIGINAL_OVERVIEW)) return page;
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(
      '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
      '<div class="panel-head"><div><h2>داشبورد</h2><p>فروش، کاربران و وضعیت اشتراک‌ها در یک نگاه.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی</button></div>',
    )
    .replace(ORIGINAL_OVERVIEW, DASHBOARD_OVERVIEW)
    .replace("</body>", DASHBOARD_SCRIPT + "\n</body>");
}
