const DASHBOARD_CSS = `
  /* Sheetra-style analytics, fed entirely by the existing overview request. */
  main{width:min(1240px,100%)}
  .panel-head{align-items:center;margin-bottom:14px}
  .panel-head h2{font-size:22px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f3f1ed;border:1px solid var(--line);border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px}
  nav button:hover{background:rgba(255,255,255,.72)}
  nav button.on{background:var(--surface);color:var(--brand);box-shadow:0 1px 4px rgba(62,47,33,.09)}
  .overview-shell{display:grid;gap:14px}
  .analytics-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 15px;background:var(--surface);border:1px solid var(--line);border-radius:18px}
  .analytics-copy h3{margin:0;font-size:14px;font-weight:900}.analytics-copy p{margin:3px 0 0;color:var(--mut);font-size:11px}
  .analytics-range{display:flex;flex-wrap:wrap;gap:4px;padding:3px;background:#f4f2ee;border-radius:11px}
  .analytics-range button{min-width:52px;min-height:32px;padding:5px 9px;border:0;border-radius:8px;background:transparent;color:var(--mut);font:700 11px/1.2 inherit;cursor:pointer}
  .analytics-range button:hover{color:var(--txt)}.analytics-range button.on{background:var(--brand);color:#fff;box-shadow:0 2px 6px rgba(188,81,15,.18)}
  .overview-groups{gap:12px!important}.metric-group{box-shadow:none}
  .overview-groups .metric-group.period .metric-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .overview-groups .metric-group:not(.period):not(.attention) .metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .metric-group-head{min-height:39px;padding:8px 13px;background:#faf9f6}.metric{min-height:94px;padding:13px}.metric .v{font-size:clamp(18px,4.5vw,25px)}
  .charts-grid{display:grid;gap:14px}
  .analytics-card{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(62,47,33,.035)}
  .analytics-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 16px 7px}
  .analytics-card-title h3{margin:0;font-size:14px;font-weight:900}.analytics-card-title p{margin:2px 0 0;color:var(--mut);font-size:11px}
  .analytics-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;color:var(--mut);font-size:10px;font-weight:700}
  .analytics-legend span{display:inline-flex;align-items:center;gap:5px}.legend-mark{width:9px;height:9px;border-radius:3px}.legend-mark.revenue{background:#dd6d19}.legend-mark.sales{background:#4f75d8}.legend-mark.users{background:#7c3aed;border-radius:999px}
  .chart-host{min-height:250px;padding:2px 8px 12px}.analytics-chart{display:block;width:100%;height:auto;min-height:225px;overflow:visible}
  .analytics-chart text{font-family:Vazirmatn,Tahoma,Arial,sans-serif;fill:#8a8178;font-size:9.5px}.analytics-chart .grid{stroke:#ece8e1;stroke-width:1;vector-effect:non-scaling-stroke}
  .analytics-chart .sales-bar{fill:#4f75d8;opacity:.2}.analytics-chart .revenue-line{fill:none;stroke:#dd6d19;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .analytics-chart .revenue-point{fill:#fff;stroke:#dd6d19;stroke-width:2;vector-effect:non-scaling-stroke}
  .analytics-chart .users-line{fill:none;stroke:#7c3aed;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .analytics-chart .users-point{fill:#fff;stroke:#7c3aed;stroke-width:2;vector-effect:non-scaling-stroke}
  .chart-empty{display:grid;min-height:230px;place-items:center;color:var(--mut);font-size:12px}
  @media (min-width:1024px){.overview-groups{grid-template-columns:repeat(2,minmax(0,1fr))!important}.overview-groups .metric-group.period{grid-column:1/-1}.charts-grid{grid-template-columns:1.25fr .75fr}.analytics-card{border-radius:20px}}
  @media (max-width:679px){.topbar{min-height:61px;padding-block:8px}.brand p{display:none}main{padding-top:14px}.panel-head{align-items:flex-start}.panel-head p{max-width:30ch}nav{margin-inline:0;padding:3px;border-radius:12px}nav button{min-height:36px;padding-inline:11px;font-size:12px}.analytics-head{display:grid;padding:13px}.analytics-range{width:100%}.analytics-range button{flex:1 1 auto;min-width:45px}.overview-groups .metric-group.period .metric-grid,.overview-groups .metric-group:not(.period):not(.attention) .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-host{min-height:220px;padding-inline:2px}.analytics-chart{min-height:205px}}
`;

const ORIGINAL_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="overview-groups" id="ovCards" aria-live="polite"></div></section>`;

const DASHBOARD_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview">
    <div class="overview-shell">
      <section class="analytics-head" aria-label="بازه آمار داشبورد">
        <div class="analytics-copy"><h3 id="analyticsRangeTitle">امروز</h3><p>آمار روزانه بر اساس نیمه‌شب تهران محاسبه می‌شود.</p></div>
        <div class="analytics-range">
          <button type="button" data-analytics-range="today" class="on">امروز</button>
          <button type="button" data-analytics-range="yesterday">دیروز</button>
          <button type="button" data-analytics-range="7">۷ روز</button>
          <button type="button" data-analytics-range="30">۳۰ روز</button>
          <button type="button" data-analytics-range="90">سه ماه</button>
        </div>
      </section>
      <div class="overview-groups" id="ovCards" aria-live="polite"></div>
      <div class="charts-grid">
        <section class="analytics-card" aria-labelledby="salesChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="salesChartTitle">نمودار درآمد و فروش</h3><p id="salesChartSubtitle">امروز از ساعت ۰۰:۰۰ تهران</p><div class="analytics-legend"><span><i class="legend-mark revenue"></i>درآمد</span><span><i class="legend-mark sales"></i>فروش موفق</span></div></div></div>
          <div class="chart-host" id="salesChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
        </section>
        <section class="analytics-card" aria-labelledby="usersChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="usersChartTitle">کاربران جدید</h3><p id="usersChartSubtitle">ثبت‌نام‌های امروز</p><div class="analytics-legend"><span><i class="legend-mark users"></i>کاربر جدید</span></div></div></div>
          <div class="chart-host" id="usersChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
        </section>
      </div>
    </div>
  </section>`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var selectedRange = "today";
  var latestOverview = null;
  var baseRenderOverview = renderOverview;

  function faNumber(value){ return Number(value || 0).toLocaleString("fa-IR"); }
  function safeText(value){ return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function compact(value){ try { return Number(value || 0).toLocaleString("fa-IR",{notation:"compact",maximumFractionDigits:1}); } catch (_) { return faNumber(value); } }
  function dateLabel(day){ try { return new Date(day + "T12:00:00Z").toLocaleDateString("fa-IR",{month:"numeric",day:"numeric"}); } catch (_) { return day.slice(5).replace("-","/"); } }
  function rangeMeta(){
    if (selectedRange === "today") return { label:"امروز", subtitle:"از ساعت ۰۰:۰۰ تهران تا الان", days:1, offset:0 };
    if (selectedRange === "yesterday") return { label:"دیروز", subtitle:"روز کامل قبلی به وقت تهران", days:1, offset:1 };
    var days = Number(selectedRange) || 7;
    return { label: days === 7 ? "۷ روز اخیر" : days === 30 ? "۳۰ روز اخیر" : "سه ماه اخیر", subtitle:"روزهای تقویمی به وقت تهران", days:days, offset:0 };
  }
  function selectedPoints(daily){
    var points = Array.isArray(daily) ? daily : [];
    var meta = rangeMeta();
    if (meta.offset) return points.slice(-(meta.offset + meta.days), -meta.offset);
    return points.slice(-meta.days);
  }
  function totals(points){
    return points.reduce(function(acc,p){
      acc.newUsers += Number(p.newUsers || 0); acc.paidPayments += Number(p.paidPayments || 0);
      acc.revenueToman += Number(p.revenueToman || 0); acc.otpSent += Number(p.otpSent || 0); return acc;
    },{newUsers:0,paidPayments:0,revenueToman:0,otpSent:0});
  }
  function group(title, items, tone){
    return '<section class="metric-group ' + (tone || "") + '"><div class="metric-group-head"><h3>' + safeText(title) + '</h3></div><div class="metric-grid">' + items.map(function(item){ return '<article class="metric ' + (item[2] || "") + '"><div class="k">' + item[0] + '</div><div class="v">' + item[1] + '</div></article>'; }).join("") + '</div></section>';
  }
  function setButtons(){
    document.querySelectorAll("[data-analytics-range]").forEach(function(button){ button.classList.toggle("on", button.getAttribute("data-analytics-range") === selectedRange); });
  }
  function chartLabels(points, width, left, plotW, height){
    if (!points.length) return "";
    var labelCount = Math.min(5, points.length), used = {}, out = "";
    for (var j=0;j<labelCount;j++){
      var idx = labelCount === 1 ? 0 : Math.round(j * (points.length - 1) / (labelCount - 1));
      if (used[idx]) continue; used[idx] = true;
      var x = points.length === 1 ? left + plotW / 2 : left + idx * plotW / (points.length - 1);
      out += '<text x="' + x.toFixed(1) + '" y="' + (height - 9) + '" text-anchor="middle">' + safeText(dateLabel(points[idx].date)) + '</text>';
    }
    return out;
  }
  function renderSalesChart(points){
    var host = document.getElementById("salesChartHost"); if (!host) return;
    if (!points.length){ host.innerHTML = '<div class="chart-empty">داده‌ای برای این بازه نیست.</div>'; return; }
    var width=920,height=286,left=58,right=48,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom;
    var maxRevenue=1,maxSales=1;
    points.forEach(function(p){ maxRevenue=Math.max(maxRevenue,Number(p.revenueToman||0)); maxSales=Math.max(maxSales,Number(p.paidPayments||0)); });
    function x(i){ return points.length===1 ? left+plotW/2 : left+i*plotW/(points.length-1); }
    function yRevenue(v){ return top+plotH-(Number(v||0)/maxRevenue)*plotH; }
    function ySales(v){ return top+plotH-(Number(v||0)/maxSales)*plotH; }
    var grid="";
    for(var i=0;i<=4;i++){ var gy=top+plotH*i/4; grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>'; grid+='<text x="'+(left-8)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="end">'+safeText(compact(maxRevenue*(4-i)/4))+'</text>'; grid+='<text x="'+(width-right+8)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="start">'+safeText(faNumber(Math.round(maxSales*(4-i)/4)))+'</text>'; }
    var step=points.length>1?plotW/(points.length-1):plotW,barWidth=Math.max(6,Math.min(22,step*.42)),bars="",dots="";
    points.forEach(function(p,index){ var px=x(index),sy=ySales(p.paidPayments),title=safeText(dateLabel(p.date)+" — فروش: "+faNumber(p.paidPayments)+"، درآمد: "+faNumber(p.revenueToman)+" تومان"); bars+='<rect class="sales-bar" x="'+(px-barWidth/2).toFixed(1)+'" y="'+sy.toFixed(1)+'" width="'+barWidth.toFixed(1)+'" height="'+Math.max(0,top+plotH-sy).toFixed(1)+'" rx="4"><title>'+title+'</title></rect>'; dots+='<circle class="revenue-point" cx="'+px.toFixed(1)+'" cy="'+yRevenue(p.revenueToman).toFixed(1)+'" r="3.4"><title>'+title+'</title></circle>'; });
    var line=points.map(function(p,index){ return (index?"L":"M")+x(index).toFixed(1)+" "+yRevenue(p.revenueToman).toFixed(1); }).join(" ");
    var area=points.length>1 ? 'M'+x(0).toFixed(1)+' '+(top+plotH)+' '+points.map(function(p,index){ return 'L'+x(index).toFixed(1)+' '+yRevenue(p.revenueToman).toFixed(1); }).join(' ')+' L'+x(points.length-1).toFixed(1)+' '+(top+plotH)+' Z' : "";
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار درآمد و فروش" preserveAspectRatio="xMidYMid meet" dir="ltr"><defs><linearGradient id="routinoRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dd6d19" stop-opacity=".18"/><stop offset="100%" stop-color="#dd6d19" stop-opacity="0"/></linearGradient></defs>'+grid+chartLabels(points,width,left,plotW,height)+bars+(area?'<path d="'+area+'" fill="url(#routinoRevenueFill)"></path>':'')+'<path class="revenue-line" d="'+line+'"></path>'+dots+'</svg>';
  }
  function renderUsersChart(points){
    var host=document.getElementById("usersChartHost"); if(!host)return;
    if(!points.length){host.innerHTML='<div class="chart-empty">داده‌ای برای این بازه نیست.</div>';return;}
    var width=620,height=286,left=46,right=18,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom,maxValue=1;
    points.forEach(function(p){maxValue=Math.max(maxValue,Number(p.newUsers||0));});
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);} function y(v){return top+plotH-(Number(v||0)/maxValue)*plotH;}
    var grid="";for(var i=0;i<=4;i++){var gy=top+plotH*i/4;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line><text x="'+(left-8)+'" y="'+(gy+3).toFixed(1)+'" text-anchor="end">'+safeText(faNumber(Math.round(maxValue*(4-i)/4)))+'</text>';}
    var line=points.map(function(p,index){return(index?"L":"M")+x(index).toFixed(1)+" "+y(p.newUsers).toFixed(1);}).join(" "),dots="";
    points.forEach(function(p,index){var title=safeText(dateLabel(p.date)+" — کاربر جدید: "+faNumber(p.newUsers));dots+='<circle class="users-point" cx="'+x(index).toFixed(1)+'" cy="'+y(p.newUsers).toFixed(1)+'" r="3.4"><title>'+title+'</title></circle>';});
    var area=points.length>1?'M'+x(0).toFixed(1)+' '+(top+plotH)+' '+points.map(function(p,index){return'L'+x(index).toFixed(1)+' '+y(p.newUsers).toFixed(1);}).join(' ')+' L'+x(points.length-1).toFixed(1)+' '+(top+plotH)+' Z':"";
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار کاربران جدید" preserveAspectRatio="xMidYMid meet" dir="ltr"><defs><linearGradient id="routinoUsersFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c3aed" stop-opacity=".16"/><stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/></linearGradient></defs>'+grid+chartLabels(points,width,left,plotW,height)+(area?'<path d="'+area+'" fill="url(#routinoUsersFill)"></path>':'')+'<path class="users-line" d="'+line+'"></path>'+dots+'</svg>';
  }
  function renderDashboard(o){
    if (!o || !Array.isArray(o.daily) || !o.daily.length){ baseRenderOverview(o); return; }
    latestOverview=o; var meta=rangeMeta(),points=selectedPoints(o.daily),period=totals(points);
    var title=document.getElementById("analyticsRangeTitle"); if(title)title.textContent=meta.label+" · "+meta.subtitle;
    var salesSubtitle=document.getElementById("salesChartSubtitle"); if(salesSubtitle)salesSubtitle.textContent=meta.label+" · "+meta.subtitle;
    var usersSubtitle=document.getElementById("usersChartSubtitle"); if(usersSubtitle)usersSubtitle.textContent=meta.label+" · "+meta.subtitle;
    document.getElementById("ovCards").innerHTML=
      group(meta.label,[["کاربر جدید",faNumber(period.newUsers)],["فروش موفق",faNumber(period.paidPayments)],["درآمد (تومان)",faNumber(period.revenueToman)],["پیامک ارسال‌شده",faNumber(period.otpSent)]],"period")+
      group("کسب‌وکار",[["کل کاربران",faNumber(o.users.total)],["اشتراک فعال",faNumber(o.activeSubscriptions)],["تریال فعال",faNumber(o.activeTrials)],["منقضی‌شده",faNumber(o.expiredUsers)],["دفعات شروع تریال",faNumber(o.trialStarts)],["کل پرداخت موفق",faNumber(o.payments.paidTotal)],["کل درآمد (تومان)",faNumber(o.payments.revenueToman)]])+
      group("نیاز به توجه",[["در انتظار درگاه",faNumber(o.payments.pending),o.payments.pending>0?"warn":""],["خطای تأیید پرداخت",faNumber(o.alerts.verifyFailed),o.alerts.verifyFailed>0?"danger":""]],"attention");
    renderSalesChart(points); renderUsersChart(points); setButtons();
  }
  renderOverview=function(o){renderDashboard(o);};
  document.querySelectorAll("[data-analytics-range]").forEach(function(button){button.addEventListener("click",function(){selectedRange=button.getAttribute("data-analytics-range")||"today";setButtons();if(latestOverview)renderDashboard(latestOverview);});});
  setButtons();
})();
</script>`;

export function withAdminDashboardUi(page: string): string {
  if (!page.includes(ORIGINAL_OVERVIEW)) return page;
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(
      '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
      '<div class="panel-head"><div><h2>داشبورد</h2><p>آمار فروش و کاربران به وقت تهران؛ تغییر بازه بدون درخواست جدید به دیتابیس.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی</button></div>',
    )
    .replace(ORIGINAL_OVERVIEW, DASHBOARD_OVERVIEW)
    .replace("</body>", DASHBOARD_SCRIPT + "\n</body>");
}
