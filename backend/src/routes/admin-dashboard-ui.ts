const DASHBOARD_CSS = `
  /* Sheetra-style admin analytics: one request per refresh, zero hover queries. */
  main{width:min(1240px,100%)}
  .panel-head{align-items:center;margin-bottom:14px}.panel-head h2{font-size:22px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f3f1ed;border:1px solid var(--line);border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px}
  nav button:hover{background:rgba(255,255,255,.72)}nav button.on{background:var(--surface);color:var(--brand);box-shadow:0 1px 4px rgba(62,47,33,.09)}
  .overview-shell{display:grid;gap:14px}
  .analytics-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 15px;background:var(--surface);border:1px solid var(--line);border-radius:18px}
  .analytics-copy h3{margin:0;font-size:14px;font-weight:900}.analytics-copy p{margin:3px 0 0;color:var(--mut);font-size:11px}
  .analytics-range{display:flex;flex-wrap:wrap;gap:4px;padding:3px;background:#f4f2ee;border-radius:11px}
  .analytics-range button{min-width:52px;min-height:32px;padding:5px 9px;border:0;border-radius:8px;background:transparent;color:var(--mut);font:700 11px/1.2 inherit;cursor:pointer}
  .analytics-range button:hover{color:var(--txt)}.analytics-range button.on{background:var(--brand);color:#fff;box-shadow:0 2px 6px rgba(188,81,15,.18)}
  .analytics-definition{margin:-4px 2px 0;padding:9px 12px;border:1px dashed #ddd6cd;border-radius:13px;background:var(--surface-soft);color:var(--mut);font-size:10px;line-height:1.8}
  .overview-groups{gap:12px!important}.metric-group{box-shadow:none}
  .overview-groups .metric-group.period .metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .overview-groups .metric-group:not(.period):not(.attention) .metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .metric-group-head{min-height:39px;padding:8px 13px;background:#faf9f6}.metric{min-height:94px;padding:13px}.metric .v{font-size:clamp(18px,4.5vw,25px)}
  .charts-grid{display:grid;grid-template-columns:1fr;gap:14px}
  .analytics-card{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 1px 3px rgba(62,47,33,.035)}
  .analytics-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 17px 5px}
  .analytics-card-title h3{margin:0;font-size:14px;font-weight:900}.analytics-card-title p{margin:2px 0 0;color:var(--mut);font-size:11px}
  .analytics-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;color:var(--mut);font-size:10px;font-weight:700}
  .analytics-legend span{display:inline-flex;align-items:center;gap:5px}.legend-mark{width:9px;height:9px;border-radius:3px;display:inline-block}
  .legend-mark.revenue{background:#6366f1;border-radius:999px}.legend-mark.sales{background:#c4b5fd}.legend-mark.renewal{background:#10b981}.legend-mark.users{background:#a78bfa}.legend-mark.buyers{background:#34d399}.legend-mark.conversion{width:14px;height:2px;background:#f59e0b;border-radius:999px}
  .chart-host{position:relative;min-height:285px;padding:4px 9px 13px;overflow:hidden}
  .analytics-chart{display:block;width:100%;height:auto;min-height:255px;overflow:visible;touch-action:none;user-select:none}
  .analytics-chart text{font-family:Vazirmatn,Tahoma,Arial,sans-serif;fill:#8a8178;font-size:9.5px}
  .analytics-chart .grid{stroke:#ece8e1;stroke-width:1;vector-effect:non-scaling-stroke}
  .analytics-chart .sales-bar{fill:#a78bfa;opacity:.28}.analytics-chart .renewal-bar{fill:#10b981;opacity:.82}
  .analytics-chart .revenue-line{fill:none;stroke:#6366f1;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .analytics-chart .revenue-point{fill:var(--surface);stroke:#6366f1;stroke-width:1.7;vector-effect:non-scaling-stroke}
  .analytics-chart .users-bar{fill:#a78bfa;opacity:.28}.analytics-chart .buyers-bar{fill:#34d399;opacity:.78}
  .analytics-chart .conversion-line{fill:none;stroke:#f59e0b;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .analytics-chart .conversion-point{fill:var(--surface);stroke:#f59e0b;stroke-width:1.7;vector-effect:non-scaling-stroke}
  .analytics-chart .chart-cross{stroke:#6366f1;stroke-opacity:.24;stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
  .analytics-chart .chart-hit{fill:transparent;cursor:crosshair}
  .chart-tooltip{position:absolute;top:14px;z-index:5;pointer-events:none;max-width:220px;transition:left .08s ease}
  .chart-tooltip[hidden]{display:none}.tooltip-card{min-width:176px;padding:10px 11px;background:var(--surface);border:1px solid var(--line);border-radius:13px;box-shadow:0 13px 30px rgba(52,42,33,.14)}
  .tooltip-date{margin-bottom:7px;color:#6366f1;font-size:10px;font-weight:900}.tooltip-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:4px 0;color:var(--mut);font-size:10px}
  .tooltip-row strong{color:var(--txt);font-size:11px;white-space:nowrap}.tooltip-label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  .tooltip-dot{width:7px;height:7px;border-radius:999px;flex:0 0 auto}.tooltip-dot.revenue{background:#6366f1}.tooltip-dot.sales{background:#a78bfa;border-radius:2px}.tooltip-dot.renewal{background:#10b981;border-radius:2px}.tooltip-dot.early{background:#94a3b8;border-radius:2px}.tooltip-dot.users{background:#a78bfa;border-radius:2px}.tooltip-dot.buyers{background:#34d399;border-radius:2px}.tooltip-dot.conversion{background:#f59e0b}
  .tooltip-sep{height:1px;margin:7px 0;background:var(--line)}
  .chart-empty{display:grid;min-height:250px;place-items:center;color:var(--mut);font-size:12px}
  .chart-hint{margin:-6px 0 2px;text-align:center;color:#aaa198;font-size:9px}
  @media (min-width:1024px){.overview-groups{grid-template-columns:repeat(2,minmax(0,1fr))!important}.overview-groups .metric-group.period{grid-column:1/-1}.analytics-card{border-radius:20px}}
  @media (max-width:679px){.topbar{min-height:61px;padding-block:8px}.brand p{display:none}main{padding-top:14px}.panel-head{align-items:flex-start}.panel-head p{max-width:30ch}nav{margin-inline:0;padding:3px;border-radius:12px}nav button{min-height:36px;padding-inline:11px;font-size:12px}.analytics-head{display:grid;padding:13px}.analytics-range{width:100%}.analytics-range button{flex:1 1 auto;min-width:45px}.overview-groups .metric-group.period .metric-grid,.overview-groups .metric-group:not(.period):not(.attention) .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-host{min-height:250px;padding-inline:2px}.analytics-chart{min-height:225px}.chart-tooltip{max-width:190px}.tooltip-card{min-width:158px;padding:9px}}
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
      <div class="analytics-definition">تمدید واقعی فقط پرداختی است که بعد از پایان واقعی دسترسی انجام شود؛ خرید زودهنگام جدا ثبت می‌شود و نرخ تمدید را بالا نمی‌برد. نرخ تبدیل نیز «ثبت‌نام همان روز → اولین خرید همان روز» است.</div>
      <div class="overview-groups" id="ovCards" aria-live="polite"></div>
      <div class="charts-grid">
        <section class="analytics-card" aria-labelledby="salesChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="salesChartTitle">درآمد، فروش و تمدید</h3><p id="salesChartSubtitle">امروز از ساعت ۰۰:۰۰ تهران</p><div class="analytics-legend"><span><i class="legend-mark revenue"></i>درآمد</span><span><i class="legend-mark sales"></i>فروش موفق</span><span><i class="legend-mark renewal"></i>تمدید واقعی</span></div></div></div>
          <div class="chart-host" id="salesChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
          <div class="chart-hint">روی نمودار برو یا در موبایل روی هر روز بزن تا جزئیات را ببینی.</div>
        </section>
        <section class="analytics-card" aria-labelledby="usersChartTitle">
          <div class="analytics-card-head"><div class="analytics-card-title"><h3 id="usersChartTitle">ثبت‌نام و نرخ تبدیل</h3><p id="usersChartSubtitle">ثبت‌نام → اولین خرید در همان روز</p><div class="analytics-legend"><span><i class="legend-mark users"></i>ثبت‌نام</span><span><i class="legend-mark buyers"></i>خریدار همان‌روز</span><span><i class="legend-mark conversion"></i>نرخ تبدیل</span></div></div></div>
          <div class="chart-host" id="usersChartHost" aria-live="polite"><div class="chart-empty">در حال دریافت آمار…</div></div>
        </section>
      </div>
    </div>
  </section>`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var selectedRange = "today";
  var latestOverview = null;
  var latestTrend = [];
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
  function mergeTrend(points){
    var byDate = {};
    latestTrend.forEach(function(point){ byDate[point.date] = point; });
    return points.map(function(point){
      var trend = byDate[point.date] || {};
      var newUsers = Number(point.newUsers || trend.newUsers || 0);
      var sameDayBuyers = Number(trend.sameDayBuyers || 0);
      var eligible = Number(trend.eligibleExpirations || 0);
      var renewed = Number(trend.renewedExpirations || 0);
      return Object.assign({}, point, {
        newUsers:newUsers,
        newPurchases:Number(trend.newPurchases || 0),
        renewals:Number(trend.renewals || 0),
        earlyRepeats:Number(trend.earlyRepeats || 0),
        sameDayBuyers:sameDayBuyers,
        conversionRate:ratio(sameDayBuyers,newUsers),
        eligibleExpirations:eligible,
        renewedExpirations:renewed,
        renewalRate:ratio(renewed,eligible)
      });
    });
  }
  function totals(points){
    return points.reduce(function(acc,p){
      acc.newUsers+=Number(p.newUsers||0); acc.paidPayments+=Number(p.paidPayments||0);
      acc.revenueToman+=Number(p.revenueToman||0); acc.otpSent+=Number(p.otpSent||0);
      acc.newPurchases+=Number(p.newPurchases||0); acc.renewals+=Number(p.renewals||0);
      acc.earlyRepeats+=Number(p.earlyRepeats||0); acc.sameDayBuyers+=Number(p.sameDayBuyers||0);
      acc.eligibleExpirations+=Number(p.eligibleExpirations||0); acc.renewedExpirations+=Number(p.renewedExpirations||0);
      return acc;
    },{newUsers:0,paidPayments:0,revenueToman:0,otpSent:0,newPurchases:0,renewals:0,earlyRepeats:0,sameDayBuyers:0,eligibleExpirations:0,renewedExpirations:0});
  }
  function group(title,items,tone){
    return '<section class="metric-group '+(tone||"")+'"><div class="metric-group-head"><h3>'+safeText(title)+'</h3></div><div class="metric-grid">'+items.map(function(item){return '<article class="metric '+(item[2]||"")+'"><div class="k">'+item[0]+'</div><div class="v">'+item[1]+'</div></article>';}).join("")+'</div></section>';
  }
  function setButtons(){ document.querySelectorAll("[data-analytics-range]").forEach(function(button){button.classList.toggle("on",button.getAttribute("data-analytics-range")===selectedRange);}); }
  function chartLabels(points,width,left,plotW,height){
    if(!points.length)return "";
    var labelCount=Math.min(7,points.length),used={},out="";
    for(var j=0;j<labelCount;j++){
      var idx=labelCount===1?0:Math.round(j*(points.length-1)/(labelCount-1));
      if(used[idx])continue;used[idx]=true;
      var x=points.length===1?left+plotW/2:left+idx*plotW/(points.length-1);
      out+='<text x="'+x.toFixed(1)+'" y="'+(height-9)+'" text-anchor="middle">'+safeText(dateLabel(points[idx].date))+'</text>';
    }
    return out;
  }
  function smoothPath(points){
    if(!points.length)return "";
    if(points.length===1)return "M "+points[0].x+" "+points[0].y;
    var path="M "+points[0].x+" "+points[0].y;
    for(var i=0;i<points.length-1;i++){
      var a=points[i],b=points[i+1],mid=(a.x+b.x)/2;
      path+=" C "+mid+" "+a.y+", "+mid+" "+b.y+", "+b.x+" "+b.y;
    }
    return path;
  }
  function tooltipRow(dot,label,value){
    return '<div class="tooltip-row"><span class="tooltip-label"><i class="tooltip-dot '+dot+'"></i>'+safeText(label)+'</span><strong>'+safeText(value)+'</strong></div>';
  }
  function bindHover(host,points,xAt,width,htmlFor){
    var tip=host.querySelector(".chart-tooltip"),cross=host.querySelector(".chart-cross");
    if(!tip||!cross)return;
    function hide(){ tip.hidden=true;cross.style.display="none"; }
    function show(idx){
      var p=points[idx]; if(!p)return;
      tip.innerHTML=htmlFor(p);tip.hidden=false;cross.style.display="";
      var px=xAt(idx),pct=(px/width)*100;
      cross.setAttribute("x1",px.toFixed(1));cross.setAttribute("x2",px.toFixed(1));
      tip.style.left=pct+"%";
      tip.style.transform=pct>62?"translateX(calc(-100% - 10px))":"translateX(10px)";
    }
    host.querySelectorAll("[data-chart-index]").forEach(function(hit){
      var idx=Number(hit.getAttribute("data-chart-index"));
      hit.addEventListener("mouseenter",function(){show(idx);});
      hit.addEventListener("click",function(event){event.stopPropagation();show(idx);});
    });
    host.onmouseleave=hide;
    host.onclick=function(event){if(event.target===host)hide();};
  }
  function loadTrend(force){
    if(trendRequest)return trendRequest;
    if(!force&&trendState==="ready")return Promise.resolve(latestTrend);
    trendState="loading";
    trendRequest=api("/sales-trend?days=90").then(function(result){
      latestTrend=result&&Array.isArray(result.points)?result.points:[];
      trendState="ready";
      return latestTrend;
    }).catch(function(){
      latestTrend=[];trendState="error";return latestTrend;
    }).then(function(result){
      if(latestOverview)renderDashboard(latestOverview);
      return result;
    }).finally(function(){trendRequest=null;});
    return trendRequest;
  }
  function renderSalesChart(points){
    var host=document.getElementById("salesChartHost");if(!host)return;
    if(!points.length){host.innerHTML='<div class="chart-empty">داده‌ای برای این بازه نیست.</div>';return;}
    var width=940,height=286,left=12,right=12,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom;
    var maxRevenue=1,maxSales=1;
    points.forEach(function(p){maxRevenue=Math.max(maxRevenue,Number(p.revenueToman||0));maxSales=Math.max(maxSales,Number(p.paidPayments||0));});
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);}
    function yRevenue(v){return top+plotH-(Number(v||0)/maxRevenue)*plotH;}
    var grid="";[.25,.5,.75,1].forEach(function(f){var gy=top+plotH-f*plotH;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>';});
    var step=points.length>1?plotW/(points.length-1):plotW,slot=points.length>1?Math.min(step,plotW/points.length):plotW,barW=Math.max(4,Math.min(28,slot*.46)),renewW=Math.max(3,barW*.48),bars="",dots="",hits="";
    points.forEach(function(p,index){
      var px=x(index),saleH=Math.max(Number(p.paidPayments||0)>0?2:0,(Number(p.paidPayments||0)/maxSales)*(plotH*.58)),renewH=Math.max(Number(p.renewals||0)>0?2:0,(Number(p.renewals||0)/maxSales)*(plotH*.58));
      bars+='<rect class="sales-bar" x="'+(px-barW/2).toFixed(1)+'" y="'+(top+plotH-saleH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+saleH.toFixed(1)+'" rx="'+Math.min(3,barW/2).toFixed(1)+'"></rect>';
      if(Number(p.renewals||0)>0)bars+='<rect class="renewal-bar" x="'+(px-renewW/2).toFixed(1)+'" y="'+(top+plotH-renewH).toFixed(1)+'" width="'+renewW.toFixed(1)+'" height="'+renewH.toFixed(1)+'" rx="'+Math.min(2.5,renewW/2).toFixed(1)+'"></rect>';
      dots+='<circle class="revenue-point" cx="'+px.toFixed(1)+'" cy="'+yRevenue(p.revenueToman).toFixed(1)+'" r="2.8"></circle>';
      var hitX=index===0?left:px-step/2,hitW=points.length>1?step:plotW;
      hits+='<rect class="chart-hit" data-chart-index="'+index+'" x="'+hitX.toFixed(1)+'" y="0" width="'+hitW.toFixed(1)+'" height="'+height+'"></rect>';
    });
    var linePoints=points.map(function(p,index){return{x:x(index),y:yRevenue(p.revenueToman)};}),line=smoothPath(linePoints);
    var area=linePoints.length?line+' L '+linePoints[linePoints.length-1].x+' '+(top+plotH)+' L '+linePoints[0].x+' '+(top+plotH)+' Z':"";
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار درآمد، فروش و تمدید واقعی" preserveAspectRatio="xMidYMid meet" dir="ltr"><defs><linearGradient id="routinoRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity=".22"/><stop offset="100%" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>'+grid+bars+(area?'<path d="'+area+'" fill="url(#routinoRevenueFill)"></path>':'')+'<path class="revenue-line" d="'+line+'"></path>'+dots+'<line class="chart-cross" x1="0" y1="'+(top-4)+'" x2="0" y2="'+(top+plotH)+'" style="display:none"></line>'+chartLabels(points,width,left,plotW,height)+hits+'</svg><div class="chart-tooltip" hidden></div>';
    bindHover(host,points,x,width,function(p){
      var html='<div class="tooltip-card"><div class="tooltip-date">'+safeText(dateLabel(p.date))+'</div>';
      html+=tooltipRow("revenue","درآمد",faNumber(p.revenueToman)+" تومان");
      html+=tooltipRow("sales","فروش موفق",faNumber(p.paidPayments));
      html+=tooltipRow("renewal","تمدید واقعی",faNumber(p.renewals));
      if(Number(p.earlyRepeats||0)>0)html+=tooltipRow("early","خرید زودهنگام",faNumber(p.earlyRepeats));
      html+='<div class="tooltip-sep"></div>';
      html+=tooltipRow("users","ثبت‌نام",faNumber(p.newUsers));
      html+=tooltipRow("conversion","نرخ تبدیل همان‌روز",faPercent(p.conversionRate));
      html+=tooltipRow("renewal","نرخ تمدید پس از انقضا",faPercent(p.renewalRate)+" · "+faNumber(p.renewedExpirations)+"/"+faNumber(p.eligibleExpirations));
      return html+'</div>';
    });
  }
  function renderUsersChart(points){
    var host=document.getElementById("usersChartHost");if(!host)return;
    if(!points.length){host.innerHTML='<div class="chart-empty">داده‌ای برای این بازه نیست.</div>';return;}
    var width=940,height=254,left=12,right=12,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom,maxUsers=1;
    points.forEach(function(p){maxUsers=Math.max(maxUsers,Number(p.newUsers||0));});
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);}
    function yRate(v){return top+plotH-(Math.max(0,Math.min(100,Number(v||0)))/100)*plotH;}
    var grid="";[.25,.5,.75,1].forEach(function(f){var gy=top+plotH-f*plotH;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>';});
    var step=points.length>1?plotW/(points.length-1):plotW,slot=points.length>1?Math.min(step,plotW/points.length):plotW,barW=Math.max(4,Math.min(28,slot*.46)),buyerW=Math.max(3,barW*.48),bars="",dots="",hits="";
    points.forEach(function(p,index){
      var px=x(index),userH=Math.max(Number(p.newUsers||0)>0?2:0,(Number(p.newUsers||0)/maxUsers)*(plotH*.58)),buyerH=Math.max(Number(p.sameDayBuyers||0)>0?2:0,(Number(p.sameDayBuyers||0)/maxUsers)*(plotH*.58));
      bars+='<rect class="users-bar" x="'+(px-barW/2).toFixed(1)+'" y="'+(top+plotH-userH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+userH.toFixed(1)+'" rx="'+Math.min(3,barW/2).toFixed(1)+'"></rect>';
      if(Number(p.sameDayBuyers||0)>0)bars+='<rect class="buyers-bar" x="'+(px-buyerW/2).toFixed(1)+'" y="'+(top+plotH-buyerH).toFixed(1)+'" width="'+buyerW.toFixed(1)+'" height="'+buyerH.toFixed(1)+'" rx="'+Math.min(2.5,buyerW/2).toFixed(1)+'"></rect>';
      dots+='<circle class="conversion-point" cx="'+px.toFixed(1)+'" cy="'+yRate(p.conversionRate).toFixed(1)+'" r="2.8"></circle>';
      var hitX=index===0?left:px-step/2,hitW=points.length>1?step:plotW;
      hits+='<rect class="chart-hit" data-chart-index="'+index+'" x="'+hitX.toFixed(1)+'" y="0" width="'+hitW.toFixed(1)+'" height="'+height+'"></rect>';
    });
    var ratePoints=points.map(function(p,index){return{x:x(index),y:yRate(p.conversionRate)};}),line=smoothPath(ratePoints);
    host.innerHTML='<svg class="analytics-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="نمودار ثبت‌نام و نرخ تبدیل همان‌روز" preserveAspectRatio="xMidYMid meet" dir="ltr">'+grid+bars+'<path class="conversion-line" d="'+line+'"></path>'+dots+'<line class="chart-cross" x1="0" y1="'+(top-4)+'" x2="0" y2="'+(top+plotH)+'" style="display:none"></line>'+chartLabels(points,width,left,plotW,height)+hits+'</svg><div class="chart-tooltip" hidden></div>';
    bindHover(host,points,x,width,function(p){
      var html='<div class="tooltip-card"><div class="tooltip-date">'+safeText(dateLabel(p.date))+'</div>';
      html+=tooltipRow("users","ثبت‌نام",faNumber(p.newUsers));
      html+=tooltipRow("buyers","خریدار همان‌روز",faNumber(p.sameDayBuyers));
      html+=tooltipRow("conversion","نرخ تبدیل",faPercent(p.conversionRate));
      html+='<div class="tooltip-sep"></div>';
      html+=tooltipRow("sales","اولین خریدها",faNumber(p.newPurchases));
      return html+'</div>';
    });
  }
  function renderDashboard(o){
    if(!o||!Array.isArray(o.daily)||!o.daily.length){baseRenderOverview(o);return;}
    latestOverview=o;
    var meta=rangeMeta(),points=mergeTrend(selectedPoints(o.daily)),period=totals(points);
    var conversionMetric=trendState==="ready"?faPercent(ratio(period.sameDayBuyers,period.newUsers)):"…";
    var renewalMetric=trendState==="ready"?faPercent(ratio(period.renewedExpirations,period.eligibleExpirations))+" · "+faNumber(period.renewedExpirations)+"/"+faNumber(period.eligibleExpirations):"…";
    var renewalCount=trendState==="ready"?faNumber(period.renewals):"…";
    var title=document.getElementById("analyticsRangeTitle");if(title)title.textContent=meta.label+" · "+meta.subtitle;
    var salesSubtitle=document.getElementById("salesChartSubtitle");if(salesSubtitle)salesSubtitle.textContent=meta.label+" · "+meta.subtitle;
    var usersSubtitle=document.getElementById("usersChartSubtitle");if(usersSubtitle)usersSubtitle.textContent=meta.label+" · ثبت‌نام → اولین خرید همان‌روز";
    document.getElementById("ovCards").innerHTML=
      group(meta.label,[["درآمد (تومان)",faNumber(period.revenueToman)],["فروش موفق",faNumber(period.paidPayments)],["ثبت‌نام",faNumber(period.newUsers)],["نرخ تبدیل همان‌روز",conversionMetric],["تمدید واقعی",renewalCount],["نرخ تمدید پس از انقضا",renewalMetric]],"period")+
      group("کسب‌وکار",[["کل کاربران",faNumber(o.users.total)],["اشتراک فعال",faNumber(o.activeSubscriptions)],["تریال فعال",faNumber(o.activeTrials)],["منقضی‌شده فعلی",faNumber(o.expiredUsers)],["دفعات شروع تریال",faNumber(o.trialStarts)],["کل پرداخت موفق",faNumber(o.payments.paidTotal)],["کل درآمد (تومان)",faNumber(o.payments.revenueToman)]])+
      group("نیاز به توجه",[["در انتظار درگاه",faNumber(o.payments.pending),o.payments.pending>0?"warn":""],["خطای تأیید پرداخت",faNumber(o.alerts.verifyFailed),o.alerts.verifyFailed>0?"danger":""]],"attention");
    renderSalesChart(points);renderUsersChart(points);setButtons();
    if(trendState==="idle")void loadTrend(false);
  }
  renderOverview=function(o){renderDashboard(o);};
  document.querySelectorAll("[data-analytics-range]").forEach(function(button){button.addEventListener("click",function(){selectedRange=button.getAttribute("data-analytics-range")||"today";setButtons();if(latestOverview)renderDashboard(latestOverview);});});
  ["refreshOverview","overviewRetry"].forEach(function(id){var button=document.getElementById(id);if(button)button.addEventListener("click",function(){trendState="idle";latestTrend=[];void loadTrend(true);});});
  setButtons();
})();
</script>`;

export function withAdminDashboardUi(page: string): string {
  if (!page.includes(ORIGINAL_OVERVIEW)) return page;
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(
      '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
      '<div class="panel-head"><div><h2>داشبورد</h2><p>آمار فروش، تبدیل و تمدید به وقت تهران؛ تغییر بازه بدون درخواست تازه به دیتابیس.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی</button></div>',
    )
    .replace(ORIGINAL_OVERVIEW, DASHBOARD_OVERVIEW)
    .replace("</body>", DASHBOARD_SCRIPT + "\n</body>");
}
