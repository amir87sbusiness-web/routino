const DASHBOARD_CSS = `
  /* CRM-style dashboard layer. Other admin tabs keep the base panel styles. */
  main{width:min(1320px,100%)}
  .panel-head{align-items:center;margin-bottom:14px}.panel-head h2{font-size:24px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f2f0ec;border:1px solid var(--line);border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px}
  nav button:hover{background:rgba(255,255,255,.72)}nav button.on{background:var(--surface);color:var(--brand);box-shadow:0 2px 7px rgba(62,47,33,.08)}
  .dashboard-shell{display:grid;gap:14px}
  .crm-hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 19px;border:1px solid #e5dfd7;border-radius:22px;background:linear-gradient(135deg,#fff 0%,#fffaf5 58%,#f8f5ff 100%);box-shadow:0 12px 34px rgba(62,47,33,.055)}
  .crm-hero:before{position:absolute;inset:auto -70px -105px auto;width:230px;height:230px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,.12),rgba(99,102,241,0) 70%);content:"";pointer-events:none}
  .crm-hero-copy{position:relative;z-index:1}.crm-eyebrow{margin-bottom:2px;color:#7c6f63;font-size:10px;font-weight:900;letter-spacing:.02em}.crm-hero h3{margin:0;font-size:18px;font-weight:900;letter-spacing:-.03em}.crm-hero p{max-width:58ch;margin:3px 0 0;color:var(--mut);font-size:11px}
  .analytics-range{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:rgba(245,242,237,.88);border:1px solid #ebe6df;border-radius:12px}
  .analytics-range button{min-width:54px;min-height:33px;padding:5px 9px;border:0;border-radius:9px;background:transparent;color:var(--mut);font:700 11px/1.2 inherit;cursor:pointer}
  .analytics-range button:hover{color:var(--txt);background:rgba(255,255,255,.75)}.analytics-range button.on{background:#302d29;color:#fff;box-shadow:0 3px 9px rgba(48,45,41,.14)}
  .crm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
  .crm-kpi{position:relative;min-width:0;overflow:hidden;padding:15px 15px 14px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 8px 24px rgba(62,47,33,.045)}
  .crm-kpi:after{position:absolute;inset:0 0 auto;width:100%;height:3px;background:var(--accent,#6366f1);content:""}
  .crm-kpi.indigo{--accent:#6366f1}.crm-kpi.green{--accent:#10b981}.crm-kpi.orange{--accent:#f59e0b}.crm-kpi.violet{--accent:#8b5cf6}
  .crm-kpi-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.crm-kpi-label{color:var(--mut);font-size:10px;font-weight:800}.crm-kpi-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 7px;border-radius:999px;background:#f5f3ef;color:#7b736b;font-size:9px;font-weight:900}
  .crm-kpi-value{margin-top:8px;overflow-wrap:anywhere;font-size:clamp(22px,3vw,31px);font-weight:900;line-height:1.2;font-variant-numeric:tabular-nums;letter-spacing:-.035em}
  .crm-kpi-sub{min-height:18px;margin-top:5px;color:var(--mut);font-size:9.5px;line-height:1.7}.crm-kpi-sub strong{color:var(--txt)}
  .period-panel{padding:15px 16px;border:1px solid var(--line);border-radius:20px;background:var(--surface);box-shadow:0 6px 20px rgba(62,47,33,.035)}
  .section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.section-heading h3{margin:0;font-size:13px;font-weight:900}.section-heading p{margin:2px 0 0;color:var(--mut);font-size:10px}.section-chip{flex:0 0 auto;padding:4px 8px;border-radius:999px;background:#f5f3ef;color:#766e65;font-size:9px;font-weight:900}
  .period-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
  .period-stat{min-width:0;padding:11px 11px 10px;border:1px solid #eeeae4;border-radius:14px;background:#fcfbf9}
  .period-stat .k{color:var(--mut);font-size:9px;font-weight:800}.period-stat .v{margin-top:4px;overflow-wrap:anywhere;font-size:17px;font-weight:900;line-height:1.3;font-variant-numeric:tabular-nums}.period-stat .s{margin-top:2px;color:#9a9188;font-size:8.5px}
  .crm-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;align-items:stretch}
  .analytics-card,.crm-card{overflow:hidden;border:1px solid var(--line);border-radius:20px;background:var(--surface);box-shadow:0 8px 26px rgba(62,47,33,.04)}
  .sales-card{grid-column:span 8}.conversion-card{grid-column:span 8}.crm-side{grid-column:span 4;display:grid;gap:14px;align-content:start}.health-card{grid-column:span 4}
  .analytics-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 17px 5px}.analytics-card-title h3{margin:0;font-size:14px;font-weight:900}.analytics-card-title p{margin:2px 0 0;color:var(--mut);font-size:10px}
  .analytics-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;color:var(--mut);font-size:9px;font-weight:800}.analytics-legend span{display:inline-flex;align-items:center;gap:5px}.legend-mark{display:inline-block;width:8px;height:8px;border-radius:3px}
  .legend-mark.revenue{background:#6366f1;border-radius:999px}.legend-mark.sales{background:#c4b5fd}.legend-mark.renewal{background:#10b981}.legend-mark.users{background:#a78bfa}.legend-mark.buyers{background:#34d399}.legend-mark.conversion{width:14px;height:2px;background:#f59e0b;border-radius:999px}
  .chart-host{position:relative;min-height:286px;padding:3px 9px 13px;overflow:hidden}.conversion-card .chart-host{min-height:260px}
  .analytics-chart{display:block;width:100%;height:auto;min-height:250px;overflow:visible;touch-action:none;user-select:none}.conversion-card .analytics-chart{min-height:226px}
  .analytics-chart text{font-family:Vazirmatn,Tahoma,Arial,sans-serif;fill:#91887f;font-size:9.5px}.analytics-chart .grid{stroke:#eeeae4;stroke-width:1;vector-effect:non-scaling-stroke}
  .analytics-chart .sales-bar{fill:#a78bfa;opacity:.3}.analytics-chart .renewal-bar{fill:#10b981;opacity:.86}.analytics-chart .revenue-line{fill:none;stroke:#6366f1;stroke-width:2.7;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.analytics-chart .revenue-point{fill:var(--surface);stroke:#6366f1;stroke-width:1.7;vector-effect:non-scaling-stroke}
  .analytics-chart .users-bar{fill:#a78bfa;opacity:.27}.analytics-chart .buyers-bar{fill:#34d399;opacity:.82}.analytics-chart .conversion-line{fill:none;stroke:#f59e0b;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.analytics-chart .conversion-point{fill:var(--surface);stroke:#f59e0b;stroke-width:1.7;vector-effect:non-scaling-stroke}
  .analytics-chart .chart-cross{stroke:#6366f1;stroke-opacity:.22;stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}.analytics-chart .chart-hit{fill:transparent;cursor:crosshair}
  .chart-tooltip{position:absolute;top:14px;z-index:5;pointer-events:none;max-width:225px;transition:left .08s ease}.chart-tooltip[hidden]{display:none}.tooltip-card{min-width:180px;padding:10px 11px;border:1px solid var(--line);border-radius:13px;background:var(--surface);box-shadow:0 14px 32px rgba(52,42,33,.15)}
  .tooltip-date{margin-bottom:7px;color:#6366f1;font-size:10px;font-weight:900}.tooltip-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:4px 0;color:var(--mut);font-size:9.5px}.tooltip-row strong{color:var(--txt);font-size:10.5px;white-space:nowrap}.tooltip-label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.tooltip-dot{width:7px;height:7px;border-radius:999px;flex:0 0 auto}.tooltip-dot.revenue{background:#6366f1}.tooltip-dot.sales{background:#a78bfa;border-radius:2px}.tooltip-dot.renewal{background:#10b981;border-radius:2px}.tooltip-dot.early{background:#94a3b8;border-radius:2px}.tooltip-dot.users{background:#a78bfa;border-radius:2px}.tooltip-dot.buyers{background:#34d399;border-radius:2px}.tooltip-dot.conversion{background:#f59e0b}.tooltip-sep{height:1px;margin:7px 0;background:var(--line)}
  .chart-empty{display:grid;min-height:245px;place-items:center;color:var(--mut);font-size:11px}.chart-hint{margin:-7px 0 4px;text-align:center;color:#aaa198;font-size:8.5px}
  .crm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:15px 15px 0}.crm-card-head h3{margin:0;font-size:12px;font-weight:900}.crm-card-head p{margin:2px 0 0;color:var(--mut);font-size:9px}.crm-card-body{padding:14px 15px 15px}
  .renewal-summary{display:grid;grid-template-columns:106px 1fr;gap:14px;align-items:center}.rate-ring{display:grid;width:102px;height:102px;place-items:center;border-radius:50%;background:conic-gradient(#10b981 var(--ring,0deg),#eeeae4 0);box-shadow:inset 0 0 0 1px rgba(0,0,0,.02)}.rate-ring-inner{display:grid;width:78px;height:78px;place-items:center;text-align:center;border-radius:50%;background:var(--surface);box-shadow:0 2px 8px rgba(62,47,33,.08)}.rate-ring-inner strong{display:block;font-size:19px;line-height:1.2}.rate-ring-inner span{display:block;margin-top:2px;color:var(--mut);font-size:8px}
  .insight-list{display:grid;gap:8px}.insight-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:7px;border-bottom:1px solid #f0ede8}.insight-row:last-child{padding:0;border:0}.insight-row span{color:var(--mut);font-size:9.5px}.insight-row strong{font-size:11px;font-variant-numeric:tabular-nums}
  .definition-note{margin-top:11px;padding:9px 10px;border-radius:11px;background:#f8f7f4;color:#857d74;font-size:8.5px;line-height:1.8}
  .pulse-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pulse-item{padding:10px;border:1px solid #eeeae4;border-radius:13px;background:#fcfbf9}.pulse-item span{display:block;color:var(--mut);font-size:8.5px}.pulse-item strong{display:block;margin-top:2px;font-size:15px;font-variant-numeric:tabular-nums}
  .status-list{display:grid;gap:9px}.status-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border:1px solid #eeeae4;border-radius:13px;background:#fcfbf9}.status-copy{min-width:0}.status-copy strong{display:block;font-size:10px}.status-copy span{display:block;margin-top:1px;color:var(--mut);font-size:8.5px}.status-pill{flex:0 0 auto;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:900}.status-pill.ok{background:var(--ok-soft);color:var(--ok)}.status-pill.warn{background:#fff4dc;color:#8b5a00}.status-pill.bad{background:var(--bad-soft);color:var(--bad)}
  .skeleton{grid-column:1/-1}
  @media (max-width:1023px){.crm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.period-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.sales-card,.conversion-card{grid-column:span 8}.crm-side,.health-card{grid-column:span 4}.renewal-summary{grid-template-columns:88px 1fr}.rate-ring{width:86px;height:86px}.rate-ring-inner{width:66px;height:66px}.rate-ring-inner strong{font-size:16px}}
  @media (max-width:760px){main{padding-top:14px}.panel-head{align-items:flex-start}.crm-hero{display:grid;padding:15px;border-radius:18px}.analytics-range{width:100%}.analytics-range button{flex:1 1 auto;min-width:46px}.crm-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.crm-kpi{padding:13px 12px;border-radius:16px}.crm-kpi-value{font-size:22px}.period-panel{padding:13px;border-radius:17px}.period-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.crm-grid{grid-template-columns:1fr}.sales-card,.conversion-card,.crm-side,.health-card{grid-column:1}.crm-side{grid-template-columns:1fr 1fr}.chart-host{min-height:250px;padding-inline:2px}.analytics-chart{min-height:222px}.conversion-card .chart-host{min-height:238px}.conversion-card .analytics-chart{min-height:210px}.chart-tooltip{max-width:190px}.tooltip-card{min-width:158px;padding:9px}.chart-hint{display:block}}
  @media (max-width:520px){.panel-head h2{font-size:21px}.crm-hero h3{font-size:16px}.crm-hero p{font-size:10px}.crm-kpis{grid-template-columns:1fr 1fr}.crm-kpi-sub{min-height:30px}.period-grid{grid-template-columns:1fr 1fr}.crm-side{grid-template-columns:1fr}.renewal-summary{grid-template-columns:92px 1fr}.analytics-card-head{padding-inline:13px}.analytics-legend{gap:8px}.chart-host{min-height:236px}.period-stat .v{font-size:15px}}
`;

const ORIGINAL_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="overview-groups" id="ovCards" aria-live="polite"></div></section>`;

const DASHBOARD_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview">
    <div class="dashboard-shell">
      <section class="crm-hero" aria-label="کنترل بازه داشبورد">
        <div class="crm-hero-copy">
          <div class="crm-eyebrow">ROUTINO ANALYTICS</div>
          <h3 id="analyticsRangeTitle">داشبورد فروش و رشد</h3>
          <p>تصویر سریع از درآمد، تبدیل، تمدید و سلامت پرداخت‌ها؛ همه تاریخ‌ها بر اساس تهران.</p>
        </div>
        <div class="analytics-range">
          <button type="button" data-analytics-range="today" class="on">امروز</button>
          <button type="button" data-analytics-range="yesterday">دیروز</button>
          <button type="button" data-analytics-range="7">۷ روز</button>
          <button type="button" data-analytics-range="30">۳۰ روز</button>
          <button type="button" data-analytics-range="90">سه ماه</button>
        </div>
      </section>

      <div class="crm-kpis" id="ovCards" aria-live="polite"></div>

      <section class="period-panel">
        <div class="section-heading">
          <div><h3>عملکرد بازه انتخاب‌شده</h3><p id="periodSubtitle">امروز از ساعت ۰۰:۰۰ تهران</p></div>
          <span class="section-chip" id="periodChip">امروز</span>
        </div>
        <div class="period-grid" id="periodMetrics"></div>
      </section>

      <div class="crm-grid">
        <section class="analytics-card sales-card" aria-labelledby="salesChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="salesChartTitle">فروش و درآمد</h3><p id="salesChartSubtitle">روند عملکرد بازه</p><div class="analytics-legend"><span><i class="legend-mark revenue"></i>درآمد</span><span><i class="legend-mark sales"></i>فروش موفق</span><span><i class="legend-mark renewal"></i>تمدید واقعی</span></div></div></div>
          <div class="chart-host" id="salesChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
          <div class="chart-hint">روی هر روز برو یا در موبایل لمس کن تا جزئیات کامل نمایش داده شود.</div>
        </section>

        <aside class="crm-side">
          <section class="crm-card" aria-labelledby="renewalSummaryTitle">
            <div class="crm-card-head"><div><h3 id="renewalSummaryTitle">کیفیت تمدید</h3><p>فقط بعد از انقضای واقعی</p></div><span class="section-chip">کل دوره</span></div>
            <div class="crm-card-body" id="renewalSummary"></div>
          </section>
          <section class="crm-card" aria-labelledby="businessPulseTitle">
            <div class="crm-card-head"><div><h3 id="businessPulseTitle">وضعیت اشتراک‌ها</h3><p>نمای فعلی کاربران</p></div></div>
            <div class="crm-card-body" id="businessPulse"></div>
          </section>
        </aside>

        <section class="analytics-card conversion-card" aria-labelledby="usersChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="usersChartTitle">رشد و تبدیل روزانه</h3><p id="usersChartSubtitle">ثبت‌نام → اولین خرید همان روز</p><div class="analytics-legend"><span><i class="legend-mark users"></i>ثبت‌نام</span><span><i class="legend-mark buyers"></i>خریدار همان‌روز</span><span><i class="legend-mark conversion"></i>نرخ تبدیل</span></div></div></div>
          <div class="chart-host" id="usersChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
        </section>

        <section class="crm-card health-card" aria-labelledby="systemHealthTitle">
          <div class="crm-card-head"><div><h3 id="systemHealthTitle">سلامت فروش</h3><p>مواردی که نیاز به توجه دارند</p></div></div>
          <div class="crm-card-body" id="systemHealth"></div>
        </section>
      </div>
    </div>
  </section>`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var selectedRange = "today";
  var latestOverview = null;
  var latestTrend = [];
  var latestLifetime = null;
  var trendState = "idle";
  var trendRequest = null;
  var baseRenderOverview = renderOverview;

  function faNumber(value){ return Number(value || 0).toLocaleString("fa-IR"); }
  function safeText(value){ return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function compact(value){ try { return Number(value || 0).toLocaleString("fa-IR",{notation:"compact",maximumFractionDigits:1}); } catch (_) { return faNumber(value); } }
  function faPercent(value){ return Number(value || 0).toLocaleString("fa-IR",{maximumFractionDigits:1}) + "٪"; }
  function ratio(n,d){ return Number(d||0)>0 ? Math.max(0,Math.min(100,(Number(n||0)/Number(d))*100)) : 0; }
  function dateLabel(day){ try { return new Date(day + "T12:00:00Z").toLocaleDateString("fa-IR",{month:"numeric",day:"numeric"}); } catch (_) { return day.slice(5).replace("-","/"); } }
  function rangeMeta(){
    if(selectedRange==="today")return{label:"امروز",subtitle:"از ساعت ۰۰:۰۰ تهران تا الان",days:1,offset:0};
    if(selectedRange==="yesterday")return{label:"دیروز",subtitle:"روز کامل قبلی به وقت تهران",days:1,offset:1};
    var days=Number(selectedRange)||7;
    return{label:days===7?"۷ روز اخیر":days===30?"۳۰ روز اخیر":"سه ماه اخیر",subtitle:"روزهای تقویمی به وقت تهران",days:days,offset:0};
  }
  function selectedPoints(daily){
    var points=Array.isArray(daily)?daily:[],meta=rangeMeta();
    if(meta.offset)return points.slice(-(meta.offset+meta.days),-meta.offset);
    return points.slice(-meta.days);
  }
  function mergeTrend(points){
    var byDate={};latestTrend.forEach(function(point){byDate[point.date]=point;});
    return points.map(function(point){
      var trend=byDate[point.date]||{},newUsers=Number(point.newUsers||trend.newUsers||0),sameDayBuyers=Number(trend.sameDayBuyers||0),eligible=Number(trend.eligibleExpirations||0),renewed=Number(trend.renewedExpirations||0);
      return Object.assign({},point,{newUsers:newUsers,newPurchases:Number(trend.newPurchases||0),renewals:Number(trend.renewals||0),earlyRepeats:Number(trend.earlyRepeats||0),sameDayBuyers:sameDayBuyers,conversionRate:ratio(sameDayBuyers,newUsers),eligibleExpirations:eligible,renewedExpirations:renewed,renewalRate:ratio(renewed,eligible)});
    });
  }
  function totals(points){
    return points.reduce(function(acc,p){
      acc.newUsers+=Number(p.newUsers||0);acc.paidPayments+=Number(p.paidPayments||0);acc.revenueToman+=Number(p.revenueToman||0);acc.otpSent+=Number(p.otpSent||0);acc.newPurchases+=Number(p.newPurchases||0);acc.renewals+=Number(p.renewals||0);acc.earlyRepeats+=Number(p.earlyRepeats||0);acc.sameDayBuyers+=Number(p.sameDayBuyers||0);acc.eligibleExpirations+=Number(p.eligibleExpirations||0);acc.renewedExpirations+=Number(p.renewedExpirations||0);return acc;
    },{newUsers:0,paidPayments:0,revenueToman:0,otpSent:0,newPurchases:0,renewals:0,earlyRepeats:0,sameDayBuyers:0,eligibleExpirations:0,renewedExpirations:0});
  }
  function setButtons(){document.querySelectorAll("[data-analytics-range]").forEach(function(button){button.classList.toggle("on",button.getAttribute("data-analytics-range")===selectedRange);});}
  function kpiCard(label,value,sub,tone,badge){
    return '<article class="crm-kpi '+tone+'"><div class="crm-kpi-head"><span class="crm-kpi-label">'+safeText(label)+'</span><span class="crm-kpi-badge">'+safeText(badge||"کل دوره")+'</span></div><div class="crm-kpi-value">'+safeText(value)+'</div><div class="crm-kpi-sub">'+sub+'</div></article>';
  }
  function periodStat(label,value,sub){
    return '<article class="period-stat"><div class="k">'+safeText(label)+'</div><div class="v">'+safeText(value)+'</div><div class="s">'+safeText(sub||"")+'</div></article>';
  }
  function chartLabels(points,width,left,plotW,height){
    if(!points.length)return"";
    var labelCount=Math.min(7,points.length),used={},out="";
    for(var j=0;j<labelCount;j++){var idx=labelCount===1?0:Math.round(j*(points.length-1)/(labelCount-1));if(used[idx])continue;used[idx]=true;var x=points.length===1?left+plotW/2:left+idx*plotW/(points.length-1);out+='<text x="'+x.toFixed(1)+'" y="'+(height-9)+'" text-anchor="middle">'+safeText(dateLabel(points[idx].date))+'</text>';}
    return out;
  }
  function smoothPath(points){
    if(!points.length)return"";if(points.length===1)return"M "+points[0].x+" "+points[0].y;
    var path="M "+points[0].x+" "+points[0].y;
    for(var i=0;i<points.length-1;i++){var a=points[i],b=points[i+1],mid=(a.x+b.x)/2;path+=" C "+mid+" "+a.y+", "+mid+" "+b.y+", "+b.x+" "+b.y;}
    return path;
  }
  function tooltipRow(dot,label,value){return'<div class="tooltip-row"><span class="tooltip-label"><i class="tooltip-dot '+dot+'"></i>'+safeText(label)+'</span><strong>'+safeText(value)+'</strong></div>';}
  function bindHover(host,points,xAt,width,htmlFor){
    var tip=host.querySelector(".chart-tooltip"),cross=host.querySelector(".chart-cross");if(!tip||!cross)return;
    function hide(){tip.hidden=true;cross.style.display="none";}
    function show(idx){var p=points[idx];if(!p)return;tip.innerHTML=htmlFor(p);tip.hidden=false;cross.style.display="";var px=xAt(idx),pct=(px/width)*100;cross.setAttribute("x1",px.toFixed(1));cross.setAttribute("x2",px.toFixed(1));tip.style.left=pct+"%";tip.style.transform=pct>62?"translateX(calc(-100% - 10px))":"translateX(10px)";}
    host.querySelectorAll("[data-chart-index]").forEach(function(hit){var idx=Number(hit.getAttribute("data-chart-index"));hit.addEventListener("mouseenter",function(){show(idx);});hit.addEventListener("click",function(event){event.stopPropagation();show(idx);});});
    host.onmouseleave=hide;host.onclick=function(event){if(event.target===host)hide();};
  }
  function loadTrend(force){
    if(trendRequest)return trendRequest;if(!force&&trendState==="ready")return Promise.resolve(latestTrend);
    trendState="loading";
    trendRequest=api("/sales-trend?days=90").then(function(result){latestTrend=result&&Array.isArray(result.points)?result.points:[];latestLifetime=result&&result.lifetime?result.lifetime:null;trendState="ready";return latestTrend;}).catch(function(){latestTrend=[];latestLifetime=null;trendState="error";return latestTrend;}).then(function(result){if(latestOverview)renderDashboard(latestOverview);return result;}).finally(function(){trendRequest=null;});
    return trendRequest;
  }
  function renderSalesChart(points){
    var host=document.getElementById("salesChartHost");if(!host)return;if(!points.length){host.innerHTML='<div class="chart-empty">داده‌ای برای این بازه نیست.</div>';return;}
    var width=940,height=286,left=12,right=12,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom,maxRevenue=1,maxSales=1;
    points.forEach(function(p){maxRevenue=Math.max(maxRevenue,Number(p.revenueToman||0));maxSales=Math.max(maxSales,Number(p.paidPayments||0));});
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);}function yRevenue(v){return top+plotH-(Number(v||0)/maxRevenue)*plotH;}
    var grid="";[.25,.5,.75,1].forEach(function(f){var gy=top+plotH-f*plotH;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>';});
    var step=points.length>1?plotW/(points.length-1):plotW,slot=points.length>1?Math.min(step,plotW/points.length):plotW,barW=Math.max(4,Math.min(28,slot*.46)),renewW=Math.max(3,barW*.48),bars="",dots="",hits="";
    points.forEach(function(p,index){
      var px=x(index),saleH=Math.max(Number(p.paidPayments||0)>0?2:0,(Number(p.paidPayments||0)/maxSales)*(plotH*.58)),renewH=Math.max(Number(p.renewals||0)>0?2:0,(Number(p.renewals||0)/maxSales)*(plotH*.58));
      bars+='<rect class="sales-bar" x="'+(px-barW/2).toFixed(1)+'" y="'+(top+plotH-saleH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+saleH.toFixed(1)+'" rx="'+Math.min(3,barW/2).toFixed(1)+'"></rect>';
      if(Number(p.renewals||0)>0)bars+='<rect class="renewal-bar" x="'+(px-renewW/2).toFixed(1)+'" y="'+(top+plotH-renewH).toFixed(1)+'" width="'+renewW.toFixed(1)+'" height="'+renewH.toFixed(1)+'" rx="'+Math.min(2.5,renewW/2).toFixed(1)+'"></rect>';
      dots+='<circle class="revenue-point" cx="'+px.toFixed(1)+'" cy="'+yRevenue(p.revenueToman).toFixed(1)+'" r="2.8"></circle>';
      var hitX=index===0?left:px-step/2,hitW=points.length>1?step:plotW;hits+='<rect class="chart-hit" data-chart-index="'+index+'" x="'+hitX.toFixed(1)+'" y="0" width="'+hitW.toFixed(1)+'" height="'+height+'"></rect>';
    });
    var linePoints=points.map(function(p,index){return{x:x(index),y:yRevenue(p.revenueToman)};}),line=smoothPath(linePoints),area=linePoints.length?line+' L '+linePoints[linePoints.length-1].x+' '+(top+plotH)+' L '+linePoints[0].x+' '+(top+plotH)+' Z':"";
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار درآمد، فروش و تمدید واقعی" preserveAspectRatio="xMidYMid meet" dir="ltr"><defs><linearGradient id="routinoRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity=".22"/><stop offset="100%" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>'+grid+bars+(area?'<path d="'+area+'" fill="url(#routinoRevenueFill)"></path>':'')+'<path class="revenue-line" d="'+line+'"></path>'+dots+'<line class="chart-cross" x1="0" y1="'+(top-4)+'" x2="0" y2="'+(top+plotH)+'" style="display:none"></line>'+chartLabels(points,width,left,plotW,height)+hits+'</svg><div class="chart-tooltip" hidden></div>';
    bindHover(host,points,x,width,function(p){var html='<div class="tooltip-card"><div class="tooltip-date">'+safeText(dateLabel(p.date))+'</div>';html+=tooltipRow("revenue","درآمد",faNumber(p.revenueToman)+" تومان");html+=tooltipRow("sales","فروش موفق",faNumber(p.paidPayments));html+=tooltipRow("renewal","تمدید واقعی",faNumber(p.renewals));if(Number(p.earlyRepeats||0)>0)html+=tooltipRow("early","خرید زودهنگام",faNumber(p.earlyRepeats));html+='<div class="tooltip-sep"></div>';html+=tooltipRow("users","ثبت‌نام",faNumber(p.newUsers));html+=tooltipRow("conversion","تبدیل همان‌روز",faPercent(p.conversionRate));html+=tooltipRow("renewal","تمدید پس از انقضا",Number(p.eligibleExpirations||0)?faPercent(p.renewalRate)+" · "+faNumber(p.renewedExpirations)+"/"+faNumber(p.eligibleExpirations):"— · ۰/۰");return html+'</div>';});
  }
  function renderUsersChart(points){
    var host=document.getElementById("usersChartHost");if(!host)return;if(!points.length){host.innerHTML='<div class="chart-empty">داده‌ای برای این بازه نیست.</div>';return;}
    var width=940,height=254,left=12,right=12,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom,maxUsers=1;
    points.forEach(function(p){maxUsers=Math.max(maxUsers,Number(p.newUsers||0));});
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);}function yRate(v){return top+plotH-(Math.max(0,Math.min(100,Number(v||0)))/100)*plotH;}
    var grid="";[.25,.5,.75,1].forEach(function(f){var gy=top+plotH-f*plotH;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>';});
    var step=points.length>1?plotW/(points.length-1):plotW,slot=points.length>1?Math.min(step,plotW/points.length):plotW,barW=Math.max(4,Math.min(28,slot*.46)),buyerW=Math.max(3,barW*.48),bars="",dots="",hits="";
    points.forEach(function(p,index){
      var px=x(index),userH=Math.max(Number(p.newUsers||0)>0?2:0,(Number(p.newUsers||0)/maxUsers)*(plotH*.58)),buyerH=Math.max(Number(p.sameDayBuyers||0)>0?2:0,(Number(p.sameDayBuyers||0)/maxUsers)*(plotH*.58));
      bars+='<rect class="users-bar" x="'+(px-barW/2).toFixed(1)+'" y="'+(top+plotH-userH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+userH.toFixed(1)+'" rx="'+Math.min(3,barW/2).toFixed(1)+'"></rect>';
      if(Number(p.sameDayBuyers||0)>0)bars+='<rect class="buyers-bar" x="'+(px-buyerW/2).toFixed(1)+'" y="'+(top+plotH-buyerH).toFixed(1)+'" width="'+buyerW.toFixed(1)+'" height="'+buyerH.toFixed(1)+'" rx="'+Math.min(2.5,buyerW/2).toFixed(1)+'"></rect>';
      dots+='<circle class="conversion-point" cx="'+px.toFixed(1)+'" cy="'+yRate(p.conversionRate).toFixed(1)+'" r="2.8"></circle>';
      var hitX=index===0?left:px-step/2,hitW=points.length>1?step:plotW;hits+='<rect class="chart-hit" data-chart-index="'+index+'" x="'+hitX.toFixed(1)+'" y="0" width="'+hitW.toFixed(1)+'" height="'+height+'"></rect>';
    });
    var ratePoints=points.map(function(p,index){return{x:x(index),y:yRate(p.conversionRate)};}),line=smoothPath(ratePoints);
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار ثبت‌نام و نرخ تبدیل همان‌روز" preserveAspectRatio="xMidYMid meet" dir="ltr">'+grid+bars+'<path class="conversion-line" d="'+line+'"></path>'+dots+'<line class="chart-cross" x1="0" y1="'+(top-4)+'" x2="0" y2="'+(top+plotH)+'" style="display:none"></line>'+chartLabels(points,width,left,plotW,height)+hits+'</svg><div class="chart-tooltip" hidden></div>';
    bindHover(host,points,x,width,function(p){var html='<div class="tooltip-card"><div class="tooltip-date">'+safeText(dateLabel(p.date))+'</div>';html+=tooltipRow("users","ثبت‌نام",faNumber(p.newUsers));html+=tooltipRow("buyers","خریدار همان‌روز",faNumber(p.sameDayBuyers));html+=tooltipRow("conversion","نرخ تبدیل",faPercent(p.conversionRate));html+='<div class="tooltip-sep"></div>';html+=tooltipRow("sales","اولین خریدها",faNumber(p.newPurchases));return html+'</div>';});
  }
  function renderLifetimeKpis(o){
    var lifetime=latestLifetime||{},loaded=trendState==="ready";
    var totalConversion=loaded?faPercent(lifetime.conversionRate):trendState==="error"?"—":"…";
    var renewalAvailable=loaded&&Number(lifetime.eligibleExpirations||0)>0;
    var totalRenewal=loaded?(renewalAvailable?faPercent(lifetime.renewalRate):"—"):trendState==="error"?"—":"…";
    var conversionSub=loaded?'<strong>'+faNumber(lifetime.payingUsers)+'</strong> خریدار از '+faNumber(lifetime.totalUsers)+' کاربر':"در حال محاسبه کاربران خریدار";
    var renewalSub=loaded?'<strong>'+faNumber(lifetime.renewedExpirations)+'</strong> تمدید از '+faNumber(lifetime.eligibleExpirations)+' انقضای واجدشرایط':"در حال محاسبه cohort تمدید";
    document.getElementById("ovCards").innerHTML=
      kpiCard("درآمد کل",faNumber(o.payments.revenueToman)+" ت","<strong>"+faNumber(o.payments.paidTotal)+"</strong> پرداخت موفق","indigo","کل دوره")+
      kpiCard("فروش کل",faNumber(o.payments.paidTotal),"<strong>"+faNumber(o.activeSubscriptions)+"</strong> اشتراک فعال فعلی","violet","کل دوره")+
      kpiCard("نرخ تبدیل کل",totalConversion,conversionSub,"orange","کاربر → خریدار")+
      kpiCard("نرخ تمدید کل",totalRenewal,renewalSub,"green","پس از انقضا");
  }
  function renderPeriodPanel(period,meta){
    var conversion=trendState==="ready"?faPercent(ratio(period.sameDayBuyers,period.newUsers)):"…";
    var renewal=trendState==="ready"?(period.eligibleExpirations?faPercent(ratio(period.renewedExpirations,period.eligibleExpirations)):"—"):"…";
    document.getElementById("periodSubtitle").textContent=meta.subtitle;
    document.getElementById("periodChip").textContent=meta.label;
    document.getElementById("periodMetrics").innerHTML=
      periodStat("درآمد",faNumber(period.revenueToman)+" ت","جمع بازه")+
      periodStat("فروش موفق",faNumber(period.paidPayments),faNumber(period.newPurchases)+" خرید اول")+
      periodStat("ثبت‌نام",faNumber(period.newUsers),faNumber(period.sameDayBuyers)+" خریدار همان‌روز")+
      periodStat("تبدیل همان‌روز",conversion,"ثبت‌نام → اولین خرید")+
      periodStat("تمدید واقعی",trendState==="ready"?faNumber(period.renewals):"…",renewal+" پس از انقضا")+
      periodStat("خرید زودهنگام",trendState==="ready"?faNumber(period.earlyRepeats):"…","در نرخ تمدید حساب نمی‌شود");
  }
  function renderRenewalSummary(){
    var box=document.getElementById("renewalSummary"),lifetime=latestLifetime||{};
    if(trendState!=="ready"){box.innerHTML='<div class="chart-empty" style="min-height:130px">در حال محاسبه…</div>';return;}
    var eligible=Number(lifetime.eligibleExpirations||0),renewed=Number(lifetime.renewedExpirations||0),rate=eligible?ratio(renewed,eligible):0,angle=(rate*3.6).toFixed(1)+"deg",display=eligible?faPercent(rate):"—";
    box.innerHTML='<div class="renewal-summary"><div class="rate-ring" style="--ring:'+angle+'"><div class="rate-ring-inner"><div><strong>'+safeText(display)+'</strong><span>نرخ تمدید کل</span></div></div></div><div class="insight-list">'+
      '<div class="insight-row"><span>انقضای واجدشرایط</span><strong>'+faNumber(eligible)+'</strong></div>'+
      '<div class="insight-row"><span>تمدید بعد از انقضا</span><strong>'+faNumber(renewed)+'</strong></div>'+
      '<div class="insight-row"><span>خرید زودهنگام کل</span><strong>'+faNumber(lifetime.earlyRepeats)+'</strong></div>'+
      '</div></div><div class="definition-note">خرید قبل از پایان دسترسی، «خرید زودهنگام» است و نرخ تمدید را بالا نمی‌برد. فقط انقضاهای واقعی وارد مخرج می‌شوند.</div>';
  }
  function renderBusinessPulse(o){
    document.getElementById("businessPulse").innerHTML='<div class="pulse-grid">'+
      '<div class="pulse-item"><span>اشتراک فعال</span><strong>'+faNumber(o.activeSubscriptions)+'</strong></div>'+
      '<div class="pulse-item"><span>تریال فعال</span><strong>'+faNumber(o.activeTrials)+'</strong></div>'+
      '<div class="pulse-item"><span>منقضی فعلی</span><strong>'+faNumber(o.expiredUsers)+'</strong></div>'+
      '<div class="pulse-item"><span>شروع تریال</span><strong>'+faNumber(o.trialStarts)+'</strong></div>'+
      '</div>';
  }
  function renderSystemHealth(o){
    var pending=Number(o.payments.pending||0),failed=Number(o.alerts.verifyFailed||0);
    document.getElementById("systemHealth").innerHTML='<div class="status-list">'+
      '<div class="status-row"><div class="status-copy"><strong>در انتظار درگاه</strong><span>پرداخت‌هایی که هنوز نهایی نشده‌اند</span></div><span class="status-pill '+(pending?"warn":"ok")+'">'+faNumber(pending)+'</span></div>'+
      '<div class="status-row"><div class="status-copy"><strong>خطای تأیید پرداخت</strong><span>موارد نیازمند بررسی پرداخت</span></div><span class="status-pill '+(failed?"bad":"ok")+'">'+faNumber(failed)+'</span></div>'+
      '<div class="status-row"><div class="status-copy"><strong>وضعیت سرویس فروش</strong><span>'+(pending||failed?"چند مورد نیاز به توجه دارد":"بدون هشدار فعال")+'</span></div><span class="status-pill '+(pending||failed?"warn":"ok")+'">'+(pending||failed?"بررسی":"سالم")+'</span></div>'+
      '</div>';
  }
  function renderDashboard(o){
    if(!o||!Array.isArray(o.daily)||!o.daily.length){baseRenderOverview(o);return;}
    latestOverview=o;var meta=rangeMeta(),points=mergeTrend(selectedPoints(o.daily)),period=totals(points);
    var title=document.getElementById("analyticsRangeTitle");if(title)title.textContent="داشبورد فروش و رشد · "+meta.label;
    var salesSubtitle=document.getElementById("salesChartSubtitle");if(salesSubtitle)salesSubtitle.textContent=meta.label+" · "+meta.subtitle;
    var usersSubtitle=document.getElementById("usersChartSubtitle");if(usersSubtitle)usersSubtitle.textContent=meta.label+" · ثبت‌نام → اولین خرید همان‌روز";
    renderLifetimeKpis(o);renderPeriodPanel(period,meta);renderRenewalSummary();renderBusinessPulse(o);renderSystemHealth(o);renderSalesChart(points);renderUsersChart(points);setButtons();
    if(trendState==="idle")void loadTrend(false);
  }
  renderOverview=function(o){renderDashboard(o);};
  document.querySelectorAll("[data-analytics-range]").forEach(function(button){button.addEventListener("click",function(){selectedRange=button.getAttribute("data-analytics-range")||"today";setButtons();if(latestOverview)renderDashboard(latestOverview);});});
  ["refreshOverview","overviewRetry"].forEach(function(id){var button=document.getElementById(id);if(button)button.addEventListener("click",function(){trendState="idle";latestTrend=[];latestLifetime=null;void loadTrend(true);});});
  setButtons();
})();
</script>`;

export function withAdminDashboardUi(page: string): string {
  if (!page.includes(ORIGINAL_OVERVIEW)) return page;
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(
      '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
      '<div class="panel-head"><div><h2>داشبورد مدیریت</h2><p>فروش، رشد، تبدیل و تمدید در یک نمای مدیریتی.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی</button></div>',
    )
    .replace(ORIGINAL_OVERVIEW, DASHBOARD_OVERVIEW)
    .replace("</body>", DASHBOARD_SCRIPT + "\n</body>");
}
