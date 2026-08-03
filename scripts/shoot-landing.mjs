/**
 * عکس‌های واقعی از خودِ برنامه، برای صفحه‌ی معرفی.
 *
 *   node scripts/shoot-landing.mjs      (نیاز: dev server روی :5180)
 *
 * چرا اسکریپت و نه اسکرین‌شات دستی؟ چون هر بار که UI عوض شود باید دوباره گرفته
 * شوند، و دستی‌گرفتن یعنی بالاخره یک روز عکسِ نسخه‌ی قدیمی روی سایت می‌ماند.
 *
 * از Chrome نصب‌شده‌ی همین سیستم استفاده می‌کند (playwright-core مرورگر همراه
 * خودش ندارد) و خروجی را با sharp به WebP می‌دهد — هر دو از قبل در پروژه بودند.
 *
 * داده‌ی نمایشی مستقیم داخل IndexedDB نوشته می‌شود، چون دکمه‌ی «دادهٔ آزمایشی»
 * در تنظیمات با `SHOW_DEMO_SEED=false` خاموش است و آن یک پرچمِ محصول است، نه
 * چیزی که برای عکس گرفتن روشنش کنیم.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "landing", "shots");
const BASE = process.env.SHOT_BASE ?? "http://localhost:5180";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));

if (!CHROME) throw new Error("هیچ مرورگری پیدا نشد — Chrome یا Edge لازم است");

/** داده‌ی نمایشی: چند عادتِ باورپذیر با تاریخچه‌ی واقعی، نه اپِ خالی. */
function demoScript() {
  return `(async () => {
    const DAY = 86400000, now = Date.now();
    // تاریخِ محلی، نه UTC. اپ کلیدها را با تاریخ محلی می‌سازد و ایران UTC+3:30
    // است، پس toISOString بعضی ساعت‌ها یک روز عقب می‌افتد و «امروز» خالی می‌ماند.
    const key = (d) => { const x = new Date(d);
      return x.getFullYear() + "-" + String(x.getMonth()+1).padStart(2,"0") + "-" + String(x.getDate()).padStart(2,"0"); };
    const habits = [
      { id:"h1", name:"مطالعه",         categoryId:"study",       type:"quantity", target:30, unitKind:"time",  monthlyGoal:26 },
      { id:"h2", name:"ورزش صبحگاهی",   categoryId:"sport",       type:"binary",   target:1,                     monthlyGoal:20 },
      { id:"h3", name:"مدیتیشن",        categoryId:"selfdev",     type:"quantity", target:10, unitKind:"time",  monthlyGoal:25 },
      { id:"h4", name:"نوشیدن آب",      categoryId:"health",      type:"quantity", target:8,  unitKind:"count", monthlyGoal:28 },
      { id:"h5", name:"بدون شبکه اجتماعی", categoryId:"limits",   type:"binary",   target:1,                     monthlyGoal:22 },
    ].map((h, i) => ({ ...h, schedule:{kind:"daily"}, reminderTime:null, createdAt: now - 120*DAY, seq: i+1 }));

    // ~۹۰ روز تاریخچه با نرخ موفقیت بالا ولی نه صددرصد — باورپذیر بماند.
    const rate = { h1:0.86, h2:0.72, h3:0.9, h4:0.8, h5:0.68 };
    const logs = [];
    for (const h of habits) {
      for (let d = 90; d >= 1; d--) {
        const dk = key(now - d*DAY);
        if (Math.random() > rate[h.id]) continue;
        const val = h.type === "binary" ? 1 : h.target;
        logs.push({ key: h.id + "|" + dk, data: { habitId:h.id, dateKey:dk, value:val, done:true } });
      }
    }
    // امروز عمداً قطعی و نیمه‌تمام: سه‌تا انجام‌شده، آب نیمه‌کاره، یکی مانده.
    // نه خالی (که مرده به نظر برسد) نه صددرصد (که غیرواقعی باشد).
    const today = key(now);
    logs.push({ key:"h1|"+today, data:{ habitId:"h1", dateKey:today, value:30, done:true } });
    logs.push({ key:"h2|"+today, data:{ habitId:"h2", dateKey:today, value:1,  done:true } });
    logs.push({ key:"h3|"+today, data:{ habitId:"h3", dateKey:today, value:10, done:true } });
    logs.push({ key:"h4|"+today, data:{ habitId:"h4", dateKey:today, value:6,  done:false } });

    const tasks = [
      { id:"t1", title:"تماس با دکتر",        done:true  },
      { id:"t2", title:"خرید هفتگی",          done:false },
      { id:"t3", title:"جواب ایمیل‌ها",       done:false },
    ].map((t,i) => ({ ...t, dateKey:key(now), type:"binary", target:1, value:t.done?1:0, seq:i+1 }));

    const journal = [];
    const moods = ["😄","🙂","🤩","💪","😐"];
    const notes = [
      "امروز تمرکز خوبی داشتم، مخصوصاً موقع مطالعه.",
      "صبح زود بیدار شدم و کل روز انرژی داشتم.",
      "یه‌کم خسته بودم ولی باز هم ورزشم رو انجام دادم.",
    ];
    for (let d = 13; d >= 0; d--) {
      const dk = key(now - d*DAY);
      journal.push({ key: dk, data: { dateKey:dk, text: notes[d % notes.length],
        score: 6 + (d % 4), mood: moods[d % moods.length], updatedAt: now - d*DAY } });
    }

    const put = (db, store, rows) => new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      rows.forEach((r, i) => os.put({ key:r.key, data:r.data, updatedAt: now,
        deleted:0, dirty:1, seq: r.seq ?? i+1 }));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });

    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("routino");
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    // onboarded یک تنظیمِ همگام‌شونده است و در IndexedDB می‌نشیند، نه
    // localStorage — بدون این، هر عکس از صفحه‌ی خوش‌آمدگویی گرفته می‌شود.
    await put(db, "settings", [
      { key:"onboarded",  data:{ value:true } },
      { key:"lang",       data:{ value:"fa" } },
      { key:"calendar",   data:{ value:"jalali" } },
    ]);
    await put(db, "habits", habits.map(h => ({ key:h.id, data:h, seq:h.seq })));
    await put(db, "logs", logs);
    await put(db, "tasks", tasks.map(t => ({ key:t.id, data:t, seq:t.seq })));
    await put(db, "journal", journal);
    return { habits: habits.length, logs: logs.length, tasks: tasks.length };
  })()`;
}

const signedInFor = (theme) => `(() => {
  const now = Date.now();
  localStorage.setItem("routino:local:v1", JSON.stringify({
    auth:{phone:"989121234567",verifiedAt:now},
    subscription:{planId:"m12",startedAt:now,expiresAt:now+300*86400000,trial:false},
    notifications:[],
    meta:{sessions:12,lastFeedbackSession:12,lastSeen:now,tampered:false,
          celebrated:[],firedReminders:[],dataOwner:"989121234567"},
    theme:"__THEME__",notificationsEnabled:true }));
  localStorage.setItem("routino:auth:v1", JSON.stringify({
    access:"x",refresh:"y",deviceId:"d1",accessExpiresAt:now+900000 }));
  localStorage.setItem("routino:onboarded","1");
  return true;
})()`.replace("__THEME__", theme);

/**
 * موبایل و لپ‌تاپ، و بیشترشان تم تاریک.
 *
 * تم از settings.theme در localStorage می‌آید (تنظیمِ مخصوصِ دستگاه)، نه از
 * prefers-color-scheme سیستم — پس همان را موقع seed می‌نشانیم، و colorScheme
 * مرورگر هم هماهنگ می‌شود تا اسکرول‌بار و پس‌زمینه‌ی خودِ مرورگر هم جور دربیاید.
 */
const PHONE = { w: 402, h: 874, kind: "phone" };
const DESK = { w: 1440, h: 900, kind: "desktop" };
const SHOTS = [
  // تاریک — نسخه‌ی اصلی که در صفحه‌ی معرفی نشان داده می‌شود
  { name: "today-dark",     path: "/app/",          theme: "dark",  ...PHONE },
  { name: "habits-dark",    path: "/app/habits",    theme: "dark",  ...PHONE },
  { name: "analytics-dark", path: "/app/analytics", theme: "dark",  ...PHONE },
  { name: "timer-dark",     path: "/app/timer",     theme: "dark",  ...PHONE },
  { name: "journal-dark",   path: "/app/journal",   theme: "dark",  ...PHONE },
  { name: "desktop-dark",           path: "/app/",          theme: "dark", ...DESK },
  { name: "desktop-analytics-dark", path: "/app/analytics", theme: "dark", ...DESK },
  // روشن — چند تا برای اینکه معلوم باشد هر دو تم هست
  { name: "today",     path: "/app/",          theme: "light", ...PHONE },
  { name: "analytics", path: "/app/analytics", theme: "light", ...PHONE },
  { name: "desktop",   path: "/app/",          theme: "light", ...DESK },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const written = [];

  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 2, // رتینا — روی صفحه‌های امروزی تار نشود
      locale: "fa-IR",
      colorScheme: s.theme,
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/app/`, { waitUntil: "domcontentloaded" });
    await page.evaluate(signedInFor(s.theme));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(demoScript());
    await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400); // انیمیشن‌ها و رندر نمودارها

    const png = await page.screenshot({ type: "png" });
    const file = join(OUT, `${s.name}.webp`);
    await sharp(png).webp({ quality: 82 }).toFile(file);
    written.push([`${s.name}.webp`, readFileSync(file).length]);
    await ctx.close();
  }

  await browser.close();
  const kb = (n) => (n / 1024).toFixed(1) + "KB";
  console.log("[shoot-landing] " + OUT);
  for (const [f, n] of written) console.log("  " + f.padEnd(24) + kb(n));
  console.log("  total " + kb(written.reduce((a, [, n]) => a + n, 0)));
}

main().catch((e) => { console.error(e); process.exit(1); });
