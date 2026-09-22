const DASHBOARD_CSS = `
  /* Sheetra-style dashboard skin. Admin actions/tables outside overview remain intact. */
  main{width:min(1280px,100%)}
  .panel-head{align-items:center;margin-bottom:14px}
  .panel-head h2{font-size:22px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px}
  nav button:hover{background:rgba(255,255,255,.78)}
  nav button.on{background:#4f46e5;color:#fff;box-shadow:0 4px 12px rgba(79,70,229,.2)}
  .dashboard-shell{display:grid;gap:16px}
  .dashboard-range-wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .dashboard-range{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
  .dashboard-range button{min-height:32px;padding:5px 10px;border:0;border-radius:9px;background:#f4f4f5;color:#71717a;font:800 11px/1.2 inherit;cursor:pointer;transition:.15s}
  .dashboard-range button:hover{background:#e4e4e7;color:#27272a}
  .dashboard-range button.on{background:#4f46e5;color:#fff;box-shadow:0 3px 9px rgba(79,70,229,.2)}
  .dashboard-custom{display:none;align-items:center;gap:7px;width:100%}
  .dashboard-custom.show{display:flex}
  .dashboard-custom input{min-height:36px;padding:6px 9px;border-radius:9px;font-size:11px}
  .dashboard-period-note{color:#71717a;font-size:11px;font-weight:700}
  .dashboard-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
  .dashboard-kpi{position:relative;overflow:hidden;min-height:126px;padding:18px;border-radius:18px;color:#fff;box-shadow:0 8px 22px rgba(0,0,0,.08)}
  .dashboard-kpi:after{content:"";position:absolute;width:110px;height:110px;left:-28px;bottom:-44px;border-radius:999px;background:rgba(255,255,255,.09)}
  .dashboard-kpi.revenue{background:linear-gradient(135deg,#059669,#0f766e)}
  .dashboard-kpi.purchases{background:linear-gradient(135deg,#2563eb,#4338ca)}
  .dashboard-kpi.users{background:linear-gradient(135deg,#7c3aed,#6d28d9)}
  .dashboard-kpi.conversion{background:linear-gradient(135deg,#f59e0b,#ea580c)}
  .dashboard-kpi-head{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:11px}
  .dashboard-kpi-label{font-size:11px;font-weight:800;color:rgba(255,255,255,.82)}
  .dashboard-delta{display:inline-flex;align-items:center;min-height:21px;padding:2px 7px;border-radius:7px;background:rgba(255,255,255,.16);font-size:10px;font-weight:900;direction:ltr}
  .dashboard-kpi-value{position:relative;z-index:1;font-size:clamp(22px,5vw,31px);font-weight:900;line-height:1.2;font-variant-numeric:tabular-nums}
  .dashboard-kpi-sub{position:relative;z-index:1;margin-top:4px;color:rgba(255,255,255,.68);font-size:10px}
  .dashboard-card{overflow:hidden;background:#fff;border:1px solid #e4e4e7;border-radius:18px;box-shadow:0 1px 4px rgba(24,24,27,.035)}
  .dashboard-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 17px 8px}
  .dashboard-card-head h3{margin:0;font-size:14px;font-weight:900;color:#27272a}
  .dashboard-card-head p{margin:2px 0 0;color:#71717a;font-size:10px}
  .dashboard-legend{display:flex;align-items:center;gap:13px;flex-wrap:wrap;padding:0 17px 4px;color:#71717a;font-size:10px;font-weight:700}
  .dashboard-legend span{display:inline-flex;align-items:center;gap:5px}
  .dashboard-dot{width:8px;height:8px;border-radius:999px}.dashboard-dot.line{background:#6366f1}.dashboard-dot.bar{border-radius:2px;background:#c4b5fd}
  .dashboard-chart-wrap{position:relative;min-height:286px;padding:2px 8px 12px;direction:ltr}
  .dashboard-chart-loading{display:grid;min-height:270px;place-items:center;color:#71717a;font-size:12px;direction:rtl}
  .dashboard-chart{display:block;width:100%;height:auto;min-height:250px;overflow:visible;user-select:none}
  .dashboard-chart text{font-family:Vazirmatn,Tahoma,Arial,sans-serif;fill:#8b8b94;font-size:10px}
  .dashboard-chart .grid{stroke:#ececf0;stroke-width:1;vector-effect:non-scaling-stroke}
  .dashboard-chart .revenue-area{fill:url(#dashRevenueFill)}
  .dashboard-chart .revenue-line{fill:none;stroke:#6366f1;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .dashboard-chart .revenue-point{fill:#fff;stroke:#6366f1;stroke-width:1.7;vector-effect:non-scaling-stroke}
  .dashboard-chart .sales-bar{fill:#a78bfa;opacity:.33}
  .dashboard-chart .crosshair{stroke:#6366f1;stroke-width:1;stroke-dasharray:3 3;opacity:.25;vector-effect:non-scaling-stroke}
  .dashboard-tooltip{position:absolute;z-index:4;min-width:170px;pointer-events:none;transform:translate(-50%,-106%);padding:9px 11px;background:rgba(24,24,27,.95);color:#fff;border-radius:11px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:10px;line-height:1.8;direction:rtl;text-align:right}
  .dashboard-tooltip strong{display:block;font-size:11px}.dashboard-tooltip .muted{color:#d4d4d8;font-size:9px}
  .dashboard-two{display:grid;grid-template-columns:1fr;gap:14px}
  .dashboard-inner{padding:16px 17px}.dashboard-inner h3{margin:0 0 12px;font-size:13px;font-weight:900}
  .dashboard-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .dashboard-status{padding:12px;border:1px solid #ececf0;border-radius:13px;background:#fafafa}
  .dashboard-status span{display:block;color:#71717a;font-size:10px}.dashboard-status strong{display:block;margin-top:3px;font-size:20px;font-weight:900;font-variant-numeric:tabular-nums}
  .dashboard-plan{margin-top:11px}.dashboard-plan:first-of-type{margin-top:0}
  .dashboard-plan-row{display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:10px}.dashboard-plan-row strong{font-size:11px}
  .dashboard-plan-track{height:7px;overflow:hidden;border-radius:999px;background:#f1f1f4}.dashboard-plan-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#6366f1,#8b5cf6)}
  .dashboard-mix{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;color:#71717a;font-size:10px;font-weight:700}
  .dashboard-table-wrap{overflow:auto;border-top:1px solid #ececf0}
  .dashboard-table{width:100%;min-width:760px;border-collapse:collapse}.dashboard-table th,.dashboard-table td{padding:11px 13px;border-bottom:1px solid #f0f0f2;text-align:right;white-space:nowrap;font-size:10px}.dashboard-table th{position:static;background:#fafafa;color:#71717a;font-size:10px}.dashboard-table tbody tr:last-child td{border-bottom:0}
  .dashboard-empty{padding:28px;text-align:center;color:#71717a;font-size:11px}
  .dashboard-error{display:grid;min-height:180px;place-items:center;padding:24px;text-align:center;color:#be3434;background:#fff7f7;border:1px dashed #fecaca;border-radius:14px;font-size:11px}
  .dashboard-error button{margin-top:9px}
  .dashboard-clock{font-variant-numeric:tabular-nums}
  @media (min-width:760px){.dashboard-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.dashboard-two{grid-template-columns:1.2fr .8fr}.dashboard-custom{width:auto}.dashboard-kpi{min-height:132px}}
  @media (max-width:679px){
    .topbar{min-height:61px;padding-block:8px}.brand p{display:none}main{padding-top:14px}.panel-head{align-items:flex-start}.panel-head p{max-width:34ch}
    nav{margin-inline:0;padding:3px;border-radius:12px}nav button{min-height:36px;padding-inline:11px;font-size:12px}
    .dashboard-shell{gap:12px}.dashboard-range-wrap{align-items:flex-start}.dashboard-range{gap:4px}.dashboard-range button{padding-inline:8px}
    .dashboard-kpi{min-height:112px;padding:14px}.dashboard-card-head{padding:13px 13px 7px}.dashboard-legend{padding-inline:13px}.dashboard-chart-wrap{min-height:235px;padding-inline:2px}.dashboard-chart{min-height:220px}
    .dashboard-inner{padding:14px}.dashboard-tooltip{min-width:150px}
  }
`;

const ORIGINAL_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview"><div class="overview-groups" id="ovCards" aria-live="polite"></div></section>`;

const DASHBOARD_OVERVIEW = `<section id="tab-overview" role="tabpanel" aria-labelledby="tab-button-overview">
    <div id="ovCards" hidden aria-live="polite"></div>
    <div class="dashboard-shell">
      <div class="dashboard-range-wrap">
        <div>
          <div class="dashboard-range" id="dashboardRange" aria-label="بازه آمار">
            <button type="button" data-dashboard-range="today" class="on">امروز</button>
            <button type="button" data-dashboard-range="yesterday">دیروز</button>
            <button type="button" data-dashboard-range="week">۷ روز</button>
            <button type="button" data-dashboard-range="month">۳۰ روز</button>
            <button type="button" data-dashboard-range="quarter">سه ماه</button>
            <button type="button" data-dashboard-range="year">یک سال</button>
            <button type="button" data-dashboard-range="custom">بازه دلخواه</button>
          </div>
          <div class="dashboard-custom" id="dashboardCustomRange">
            <input type="date" id="dashboardCustomStart" aria-label="شروع بازه">
            <span class="muted">تا</span>
            <input type="date" id="dashboardCustomEnd" aria-label="پایان بازه">
          </div>
        </div>
        <div class="dashboard-period-note" id="dashboardPeriodNote">روز ایران از ساعت ۰۰:۰۰ تهران محاسبه می‌شود</div>
      </div>

      <div class="dashboard-kpis" id="dashboardKpis" aria-live="polite">
        <article class="dashboard-kpi revenue"><div class="dashboard-kpi-label">درآمد</div><div class="dashboard-kpi-value">—</div></article>
        <article class="dashboard-kpi purchases"><div class="dashboard-kpi-label">خرید موفق</div><div class="dashboard-kpi-value">—</div></article>
        <article class="dashboard-kpi users"><div class="dashboard-kpi-label">ثبت‌نام جدید</div><div class="dashboard-kpi-value">—</div></article>
        <article class="dashboard-kpi conversion"><div class="dashboard-kpi-label">نرخ تبدیل</div><div class="dashboard-kpi-value">—</div></article>
      </div>

      <section class="dashboard-card" aria-labelledby="dashboardChartTitle">
        <div class="dashboard-card-head">
          <div><h3 id="dashboardChartTitle">درآمد و خرید</h3><p id="dashboardChartSubtitle">برای دیدن جزئیات روی نمودار برو</p></div>
        </div>
        <div class="dashboard-legend"><span><i class="dashboard-dot line"></i>درآمد</span><span><i class="dashboard-dot bar"></i>تعداد خرید</span><span id="dashboardMixSummary">خرید اول: — · تمدید: —</span></div>
        <div class="dashboard-chart-wrap" id="dashboardChartWrap"><div class="dashboard-chart-loading">در حال دریافت نمودار…</div></div>
      </section>

      <div class="dashboard-two">
        <section class="dashboard-card"><div class="dashboard-inner"><h3>پلن‌های پرفروش</h3><div id="dashboardPlans"><div class="dashboard-empty">—</div></div></div></section>
        <section class="dashboard-card"><div class="dashboard-inner"><h3>وضعیت فعلی</h3><div class="dashboard-status-grid" id="dashboardStatus"></div><div class="dashboard-mix" id="dashboardAllTime"></div></div></section>
      </div>

      <section class="dashboard-card">
        <div class="dashboard-card-head"><div><h3>آخرین خریدها</h3><p>خریدهای موفق در بازه انتخاب‌شده</p></div></div>
        <div id="dashboardRecent"><div class="dashboard-empty">—</div></div>
      </section>
    </div>
  </section>`;

const DASHBOARD_SCRIPT = `<script>
(function(){
  var selectedRange = "today";
  var requestSerial = 0;
  var loadedOnce = false;
  var currentPayload = null;
  var JALALI_MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];

  function fa(value){ return Number(value || 0).toLocaleString("fa-IR"); }
  function faOne(value){ return Number(value || 0).toLocaleString("fa-IR", { maximumFractionDigits: 1 }); }
  function money(value){ return fa(value) + " تومان"; }
  function safe(value){ return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function phone(value){ var s=String(value||""); return /^98\d{10}$/.test(s) ? "0" + s.slice(2) : s || "—"; }
  function pctDelta(value){
    if (value == null || !isFinite(Number(value))) return "—";
    var n=Number(value); if (Math.abs(n)<.05) return "۰٪";
    return (n>0 ? "+" : "") + Number(n.toFixed(1)).toLocaleString("fa-IR") + "٪";
  }
  function iranDateTime(value){
    try { return new Date(value).toLocaleString("fa-IR", {timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }
    catch(_){ return String(value||"—"); }
  }
  function dayLabel(value, groupBy){
    if (groupBy === "hour") return String(value).slice(11,13) + ":۰۰";
    try { return new Date(String(value).slice(0,10)+"T12:00:00+03:30").toLocaleDateString("fa-IR",{timeZone:"Asia/Tehran",month:"numeric",day:"numeric"}); }
    catch(_){ return String(value).slice(5).replace("-","/"); }
  }
  function jalaliMonthKey(value){
    try {
      var d=new Date(String(value).slice(0,10)+"T12:00:00+03:30");
      var parts=new Intl.DateTimeFormat("en-US-u-ca-persian",{timeZone:"Asia/Tehran",year:"numeric",month:"numeric"}).formatToParts(d);
      var y=parts.find(function(p){return p.type==="year";}).value;
      var m=String(parts.find(function(p){return p.type==="month";}).value).padStart(2,"0");
      return y+"-"+m;
    } catch(_){ return String(value).slice(0,7); }
  }
  function chartPoints(payload){
    var raw=payload && Array.isArray(payload.points) ? payload.points : [];
    if (!raw.length || selectedRange !== "year") return raw;
    var map=new Map();
    raw.forEach(function(p){
      var key=jalaliMonthKey(p.date); var item=map.get(key)||{date:key,revenue:0,purchases:0,newPurchases:0,renewals:0};
      item.revenue+=Number(p.revenue||0); item.purchases+=Number(p.purchases||0); item.newPurchases+=Number(p.newPurchases||0); item.renewals+=Number(p.renewals||0); map.set(key,item);
    });
    return Array.from(map.values());
  }
  function chartLabel(point, groupBy){
    if (selectedRange === "year" && /^\d{3,4}-\d{2}$/.test(String(point.date))){ var m=Number(String(point.date).slice(-2)); return JALALI_MONTHS[m-1] || point.date; }
    return dayLabel(point.date, groupBy);
  }
  function setClock(){
    var el=document.getElementById("dashboardIranClock"); if(!el) return;
    try { el.textContent="الان ایران: "+new Date().toLocaleString("fa-IR",{timeZone:"Asia/Tehran",weekday:"long",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}); } catch(_){}
  }
  function setRangeUi(){
    document.querySelectorAll("[data-dashboard-range]").forEach(function(button){ button.classList.toggle("on",button.getAttribute("data-dashboard-range")===selectedRange); });
    var custom=document.getElementById("dashboardCustomRange"); if(custom) custom.classList.toggle("show",selectedRange==="custom");
  }
  function renderKpis(payload){
    var k=payload.topMetrics||{}, d=payload.deltas||{};
    var host=document.getElementById("dashboardKpis"); if(!host) return;
    function card(cls,label,value,sub,delta){ return '<article class="dashboard-kpi '+cls+'"><div class="dashboard-kpi-head"><span class="dashboard-kpi-label">'+safe(label)+'</span><span class="dashboard-delta">'+safe(pctDelta(delta))+'</span></div><div class="dashboard-kpi-value">'+safe(value)+'</div><div class="dashboard-kpi-sub">'+safe(sub)+'</div></article>'; }
    host.innerHTML=
      card("revenue","درآمد",fa(k.revenue),"تومان · نسبت به دوره قبل",d.revenue)+
      card("purchases","خرید موفق",fa(k.purchases),"پرداخت موفق · نسبت به دوره قبل",d.purchases)+
      card("users","ثبت‌نام جدید",fa(k.newUsers),"کاربر · نسبت به دوره قبل",d.newUsers)+
      card("conversion","نرخ تبدیل",faOne(k.conversionRate)+"٪","ثبت‌نام → اولین خرید",d.conversionRate);
  }
  function renderStatus(payload){
    var s=payload.status||{}, all=payload.allTime||{};
    var host=document.getElementById("dashboardStatus");
    if(host) host.innerHTML=
      '<div class="dashboard-status"><span>اشتراک فعال</span><strong>'+fa(s.activeSubscriptions)+'</strong></div>'+
      '<div class="dashboard-status"><span>تریال فعال</span><strong>'+fa(s.activeTrials)+'</strong></div>'+
      '<div class="dashboard-status"><span>منقضی‌شده</span><strong>'+fa(s.expiredUsers)+'</strong></div>'+
      '<div class="dashboard-status"><span>پرداخت در انتظار</span><strong>'+fa(s.pendingPayments)+'</strong></div>';
    var allHost=document.getElementById("dashboardAllTime");
    if(allHost) allHost.innerHTML='<span>کل کاربران: '+fa(all.users)+'</span><span>کل خرید: '+fa(all.purchases)+'</span><span>کل درآمد: '+money(all.revenue)+'</span>';
  }
  function renderPlans(payload){
    var plans=Array.isArray(payload.plans)?payload.plans:[], host=document.getElementById("dashboardPlans"); if(!host) return;
    if(!plans.length){ host.innerHTML='<div class="dashboard-empty">در این بازه خریدی ثبت نشده.</div>'; return; }
    var max=Math.max.apply(null,plans.map(function(p){return Number(p.revenue||0);}).concat([1]));
    host.innerHTML=plans.map(function(p){ var width=Math.max(2,Math.round(Number(p.revenue||0)/max*100)); return '<div class="dashboard-plan"><div class="dashboard-plan-row"><strong>'+safe(p.name)+'</strong><span>'+fa(p.purchases)+' خرید · '+money(p.revenue)+'</span></div><div class="dashboard-plan-track"><div class="dashboard-plan-fill" style="width:'+width+'%"></div></div></div>'; }).join("");
  }
  function renderRecent(payload){
    var rows=Array.isArray(payload.recentPurchases)?payload.recentPurchases:[], host=document.getElementById("dashboardRecent"); if(!host) return;
    if(!rows.length){ host.innerHTML='<div class="dashboard-empty">در این بازه خرید موفقی نیست.</div>'; return; }
    host.innerHTML='<div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>زمان</th><th>کاربر</th><th>پلن</th><th>مبلغ</th><th>تخفیف</th><th>پلتفرم</th><th>رفرنس</th></tr></thead><tbody>'+rows.map(function(r){ var identity=r.username ? safe(r.username)+' · '+safe(phone(r.phone)) : safe(phone(r.phone)); return '<tr><td>'+safe(iranDateTime(r.paidAt))+'</td><td>'+identity+'</td><td>'+safe(r.planName)+'</td><td>'+safe(money(r.amountToman))+'</td><td>'+safe(r.discountCode||"—")+'</td><td>'+safe(r.platform||"—")+'</td><td>'+safe(r.refNumber||"—")+'</td></tr>'; }).join("")+'</tbody></table></div>';
  }
  function renderChart(payload){
    var points=chartPoints(payload), wrap=document.getElementById("dashboardChartWrap"); if(!wrap) return;
    var mix=payload.purchaseMix||{}, mixHost=document.getElementById("dashboardMixSummary"); if(mixHost) mixHost.textContent="خرید اول: "+fa(mix.newPurchases)+" · تمدید: "+fa(mix.renewals)+" · خریدار یکتا: "+fa(mix.uniqueBuyers);
    var title=document.getElementById("dashboardChartTitle"); if(title) title.textContent=payload.groupBy==="hour" ? "درآمد و خرید ساعتی" : selectedRange==="year" ? "درآمد و خرید ماهانه" : "درآمد و خرید روزانه";
    if(!points.length){ wrap.innerHTML='<div class="dashboard-chart-loading">داده‌ای برای نمایش نیست.</div>'; return; }

    var width=980,height=300,left=16,right=16,top=18,bottom=38,plotW=width-left-right,plotH=height-top-bottom;
    var maxRevenue=Math.max.apply(null,points.map(function(p){return Number(p.revenue||0);}).concat([1]));
    var maxSales=Math.max.apply(null,points.map(function(p){return Number(p.purchases||0);}).concat([1]));
    function x(i){return points.length===1?left+plotW/2:left+i*plotW/(points.length-1);}
    function yRevenue(v){return top+plotH-(Number(v||0)/maxRevenue)*plotH;}
    function smoothPath(){ if(points.length===1) return 'M '+x(0).toFixed(1)+' '+yRevenue(points[0].revenue).toFixed(1); var out='M '+x(0).toFixed(1)+' '+yRevenue(points[0].revenue).toFixed(1); for(var i=0;i<points.length-1;i++){ var x0=x(i),x1=x(i+1),mid=(x0+x1)/2; out+=' C '+mid.toFixed(1)+' '+yRevenue(points[i].revenue).toFixed(1)+', '+mid.toFixed(1)+' '+yRevenue(points[i+1].revenue).toFixed(1)+', '+x1.toFixed(1)+' '+yRevenue(points[i+1].revenue).toFixed(1); } return out; }
    var path=smoothPath();
    var area=path+' L '+x(points.length-1).toFixed(1)+' '+(top+plotH)+' L '+x(0).toFixed(1)+' '+(top+plotH)+' Z';
    var slot=points.length>1?plotW/(points.length-1):plotW,barW=Math.max(3,Math.min(24,slot*.46));
    var grid='',labels='',bars='',dots='',hits='';
    for(var g=0;g<=4;g++){var gy=top+plotH*g/4;grid+='<line class="grid" x1="'+left+'" y1="'+gy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+gy.toFixed(1)+'"></line>';}
    var labelStep=Math.max(1,Math.ceil(points.length/7));
    points.forEach(function(p,i){
      var px=x(i),bh=Math.max(2,Number(p.purchases||0)/maxSales*(plotH*.52)),by=top+plotH-bh;
      bars+='<rect class="sales-bar" x="'+(px-barW/2).toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="2"></rect>';
      if(points.length<=40) dots+='<circle class="revenue-point" cx="'+px.toFixed(1)+'" cy="'+yRevenue(p.revenue).toFixed(1)+'" r="2.7"></circle>';
      if(i%labelStep===0||i===points.length-1) labels+='<text x="'+px.toFixed(1)+'" y="'+(height-11)+'" text-anchor="middle">'+safe(chartLabel(p,payload.groupBy))+'</text>';
      var hitX=i===0?left:px-slot/2,hitW=points.length===1?plotW:slot;
      hits+='<rect data-dash-index="'+i+'" x="'+hitX.toFixed(1)+'" y="0" width="'+hitW.toFixed(1)+'" height="'+height+'" fill="transparent" style="cursor:pointer"></rect>';
    });
    wrap.innerHTML='<svg class="dashboard-chart" viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="نمودار درآمد و تعداد خرید"><defs><linearGradient id="dashRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6366f1" stop-opacity=".28"></stop><stop offset="100%" stop-color="#6366f1" stop-opacity="0"></stop></linearGradient></defs>'+grid+bars+'<path class="revenue-area" d="'+area+'"></path><path class="revenue-line" d="'+path+'"></path>'+dots+labels+'<line id="dashboardCrosshair" class="crosshair" x1="0" y1="'+top+'" x2="0" y2="'+(top+plotH)+'" style="display:none"></line>'+hits+'</svg><div class="dashboard-tooltip" id="dashboardTooltip" style="display:none"></div>';
    var tooltip=document.getElementById("dashboardTooltip"),cross=document.getElementById("dashboardCrosshair");
    function show(i){ var p=points[i],px=x(i),py=yRevenue(p.revenue); if(cross){cross.setAttribute("x1",String(px));cross.setAttribute("x2",String(px));cross.style.display="block";} if(tooltip){tooltip.style.display="block";tooltip.style.left=(px/width*100)+'%';tooltip.style.top=(py/height*100)+'%';tooltip.innerHTML='<strong>'+safe(chartLabel(p,payload.groupBy))+'</strong><div>درآمد: '+safe(money(p.revenue))+'</div><div>خرید: '+fa(p.purchases)+'</div><div class="muted">خرید اول '+fa(p.newPurchases)+' · تمدید '+fa(p.renewals)+'</div>';}}
    function hide(){if(cross)cross.style.display="none";if(tooltip)tooltip.style.display="none";}
    wrap.querySelectorAll('[data-dash-index]').forEach(function(el){var idx=Number(el.getAttribute('data-dash-index'));el.addEventListener('mouseenter',function(){show(idx);});el.addEventListener('mouseleave',hide);el.addEventListener('click',function(e){e.stopPropagation();show(idx);});});
    wrap.addEventListener('mouseleave',hide);
  }
  function periodNote(payload){
    var host=document.getElementById("dashboardPeriodNote"); if(!host) return;
    if(selectedRange==="today") host.textContent="امروز = از ۰۰:۰۰ تهران تا الان";
    else if(selectedRange==="yesterday") host.textContent="دیروز = ۰۰:۰۰ تا ۲۴:۰۰ به وقت تهران";
    else host.textContent="همه مرزهای روز بر اساس Asia/Tehran هستند";
  }
  function render(payload){ currentPayload=payload; renderKpis(payload); renderStatus(payload); renderPlans(payload); renderRecent(payload); renderChart(payload); periodNote(payload); }
  function queryString(){
    var q='?range='+encodeURIComponent(selectedRange);
    if(selectedRange==='custom'){
      var s=document.getElementById('dashboardCustomStart'),e=document.getElementById('dashboardCustomEnd');
      if(s&&s.value)q+='&customStart='+encodeURIComponent(s.value); if(e&&e.value)q+='&customEnd='+encodeURIComponent(e.value);
    }
    return q;
  }
  async function loadDashboard(force){
    var panel=document.getElementById("panel"),wrap=document.getElementById("dashboardChartWrap");
    if(!panel||!wrap||panel.style.display==="none")return; if(loadedOnce&&!force)return;
    if(selectedRange==='custom'){
      var s=document.getElementById('dashboardCustomStart'),e=document.getElementById('dashboardCustomEnd');
      if(!s||!e||!s.value||!e.value){ wrap.innerHTML='<div class="dashboard-chart-loading">شروع و پایان بازه را انتخاب کن.</div>'; return; }
    }
    var serial=++requestSerial; wrap.innerHTML='<div class="dashboard-chart-loading">در حال دریافت نمودار…</div>';
    try{ var payload=await api('/sales-trend'+queryString()); if(serial!==requestSerial)return; loadedOnce=true; render(payload); }
    catch(error){ if(serial!==requestSerial)return; wrap.innerHTML='<div class="dashboard-error"><div><div>'+safe(error&&error.message?error.message:'آمار دریافت نشد')+'</div><button class="btn secondary mini" type="button" id="dashboardRetry">تلاش دوباره</button></div></div>'; var retry=document.getElementById('dashboardRetry');if(retry)retry.onclick=function(){loadDashboard(true);}; }
  }

  document.querySelectorAll('[data-dashboard-range]').forEach(function(button){button.addEventListener('click',function(){selectedRange=button.getAttribute('data-dashboard-range')||'today';loadedOnce=false;setRangeUi();if(selectedRange!=='custom')loadDashboard(true);});});
  ['dashboardCustomStart','dashboardCustomEnd'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('change',function(){var s=document.getElementById('dashboardCustomStart'),e=document.getElementById('dashboardCustomEnd');if(s&&e&&s.value&&e.value){loadedOnce=false;loadDashboard(true);}});});
  ['overviewRetry','refreshOverview'].forEach(function(id){var button=document.getElementById(id);if(button)button.addEventListener('click',function(){loadedOnce=false;loadDashboard(true);});});
  var overviewTab=document.querySelector('nav button[data-tab="overview"]');if(overviewTab)overviewTab.addEventListener('click',function(){loadDashboard(false);});
  var panel=document.getElementById('panel');if(panel&&typeof MutationObserver!=='undefined'){new MutationObserver(function(){if(panel.style.display!=='none')loadDashboard(false);}).observe(panel,{attributes:true,attributeFilter:['style']});}
  setRangeUi();setClock();setInterval(setClock,1000);setTimeout(function(){loadDashboard(false);},0);
})();
</script>`;

export function withAdminDashboardUi(page: string): string {
  if (!page.includes(ORIGINAL_OVERVIEW)) return page;
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(
      '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
      '<div class="panel-head"><div><h2>داشبورد</h2><p class="dashboard-clock" id="dashboardIranClock">آمار بر اساس ساعت ایران</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>',
    )
    .replace(ORIGINAL_OVERVIEW, DASHBOARD_OVERVIEW)
    .replace("</body>", DASHBOARD_SCRIPT + "\n</body>");
}
