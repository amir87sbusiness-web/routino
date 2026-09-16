const DASHBOARD_CSS = `
  /* UI-only admin refresh. No API, database, payment or subscription behavior lives here. */
  main{width:min(1240px,100%)}
  .topbar{min-height:64px;border-bottom-color:#ece8e1;box-shadow:0 1px 0 rgba(62,47,33,.02)}
  .panel-head{align-items:center;margin:0 0 14px}
  .panel-head h2{font-size:22px}
  .panel-head p{font-size:11px}
  nav{gap:4px;margin:0 0 18px;padding:4px;overflow-x:auto;background:#f3f1ed;border:1px solid var(--line);border-radius:14px}
  nav button{min-height:38px;padding:7px 13px;border:0;background:transparent;border-radius:10px;box-shadow:none}
  nav button:hover{background:rgba(255,255,255,.72);color:var(--txt)}
  nav button.on{background:var(--surface);color:var(--brand);box-shadow:0 1px 4px rgba(62,47,33,.09)}
  .overview-groups{gap:12px}
  .metric-group{border-radius:16px;box-shadow:none}
  .metric-group-head{min-height:38px;padding:7px 13px;background:#faf9f6}
  .metric-group-head h3{font-size:11px}
  .metric{min-height:88px;padding:12px 13px}
  .metric .k{font-size:10px}
  .metric .v{margin-top:4px;font-size:clamp(18px,4.2vw,24px)}
  .section-surface{border-radius:16px;box-shadow:none}
  .table-wrap{border-radius:14px}
  th,td{padding:10px 11px}
  .plan-card{border-radius:16px;box-shadow:none}
  .login-card{border-radius:20px;box-shadow:0 10px 30px rgba(62,47,33,.07)}
  @media (min-width:1024px){
    main{padding-top:24px}
    .overview-groups{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
    .overview-groups .metric-group:first-child{grid-column:1/-1}
    .overview-groups .metric-group.attention{grid-column:auto}
  }
  @media (max-width:679px){
    .topbar{min-height:60px;padding-block:8px}
    .brand p{display:none}
    main{padding-top:14px}
    .panel-head{align-items:flex-start;gap:10px}
    .panel-head h2{font-size:20px}
    nav{margin-inline:0;padding:3px;border-radius:12px}
    nav button{min-height:36px;padding-inline:11px;font-size:12px}
    .metric{min-height:82px;padding:11px}
    .section-surface{padding:12px}
  }
`;

const OLD_HEAD = '<div class="panel-head"><div><h2>نمای کلی</h2><p>هر بخش فقط هنگام بازشدن دادهٔ خودش را دریافت می‌کند.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی آمار</button></div>';
const NEW_HEAD = '<div class="panel-head"><div><h2>داشبورد</h2><p>فروش، کاربران و وضعیت اشتراک‌ها در یک نگاه.</p></div><button class="btn secondary" type="button" id="overviewRetry">تازه‌سازی</button></div>';

export function withAdminDashboardUi(page: string): string {
  return page
    .replace("</style>", DASHBOARD_CSS + "\n</style>")
    .replace(OLD_HEAD, NEW_HEAD);
}
