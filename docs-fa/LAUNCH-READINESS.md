# آمادگی لانچ روتینو

آخرین بازبینی: ۱۵ شهریور ۱۴۰۵ / 6 September 2026

این سند وضعیت **کد فعلی همین working tree** را خلاصه می‌کند. طراحی‌های قدیمی
`docs/superpowers/` تاریخی‌اند و قرارداد محصول امروز نیستند.

## قرارداد محصول فعلی

- روتینو local-first و cloud-synced است: UI از Dexie/IndexedDB می‌خواند و همان
  رکوردهای syncable با جدول عمومی `records` و API احراز‌شده بین دستگاه‌ها جابه‌جا
  می‌شوند. فرانت به Supabase/PostgREST دسترسی مستقیم ندارد.
- تعداد نصب‌های احراز‌شده محدودیت محصولی ندارد و دستگاه/نشست سروری ذخیره نمی‌شود.
  ورود با JWT سی‌روزهٔ stateless است؛ خروج محلی و تغییر رمز بدون revoke توکن قبلی است.
- ساخت حساب هیچ trialای نمی‌دهد. trial هفت‌روزه فقط بعد از فعال‌سازی معنادار و
  ساخت اولین عادت، یک‌بار برای کل حساب و با تصمیم authoritative سرور شروع می‌شود.
- پلن رایگان دائمی وجود ندارد. بعد از انقضا، محتوای موجود، تاریخچه، آنالیز، Export،
  حساب/امنیت، خرید و reset صریح محتوای syncشده در دسترس می‌مانند؛ نوشتن محتوای
  محصول و Import تا فعال‌شدن دسترسی قفل است.
- یادآور عادت/کار/ژورنال و lifecycle در اپ نیتیو با Local Notifications سیستم‌عامل
  زمان‌بندی می‌شود و برای زمان شلیک به اینترنت یا Supabase نیاز ندارد.
- تکمیل مستقیم کاربر visual feedback موجود را نگه می‌دارد و فقط در گذار واقعی
  ناقص→کامل، sound اصلی کوتاه و haptic دستگاه را طبق تنظیم محلی اجرا می‌کند.
- Analytics یک Weekly Review روی همان `dayScore` و `weekComparison` دارد؛ امروز
  ناتمام و روز بدون عادت موعددار را شکست حساب نمی‌کند و با دادهٔ کم insight نمی‌سازد.

## یکپارچگی فنی

- sync همیشه push-before-pull، cursorمحور، صفحه‌بندی‌شده و مستقل از entitlement
  است. tombstone، reset بعد از GC، بازیابی نصب تازه و جداسازی vault حساب‌ها پوشش
  رگرسیون دارند؛ remote hydration مسیر feedback تکمیل را صدا نمی‌زند.
- تنها مسیر عمومی تغییر محتوای محصول `AppProvider.update` است. bypassهای داخلی به
  عملیات نام‌دار و ممیزی‌شدهٔ entitlement، activation، preference، account/session،
  feedback و reset محدود شده‌اند.
- احراز هویت همان custom JWT stateless است؛ Supabase Auth وارد معماری نشده و
  middleware احراز هویت برای هر درخواست query دیتابیس اجرا نمی‌کند.
- همهٔ جدول‌های برنامه در setup تولیدشده RLS فعال و صفر policy دارند؛ جدول‌های
  دستگاه و رویداد امنیتی حذف شده‌اند و Edge با Postgres مستقیم کار می‌کند.
- `backend/src/` منبع canonical است. `supabase/functions/api/shared/` فقط با
  `npm run sync:edge` تولید می‌شود و parity test اختلاف را رد می‌کند.
- SMS و PSP سقف روزانهٔ تجاری ندارند؛ lease دیتابیسی فقط تماس هم‌زمان provider را
  محدود می‌کند. اشباع موقت قبل از خرج provider پس‌فشار می‌دهد و checkout با همان
  `attemptId` ادامه پیدا می‌کند، نه با payment تازه.
- maintenance دیتابیس batch و timeout ثابت دارد. backlog و تاریخچهٔ pg_cron باید با
  SQL سند deploy پایش شوند؛ عدد schedule×batch به معنی ظرفیت تضمینی کاربر نیست.

## وضعیت محیط زنده

آخرین بررسی خواندنی ثبت‌شده، سلامت API/DB و پلن‌ها را تأیید کرده بود؛ اما کد
زرین‌پال-only، migration و secretهای جدید هنوز در این سند به‌عنوان deployشده تأیید
نشده‌اند. مقدار هیچ secretی در تست محلی خوانده یا تغییر داده نمی‌شود. OTP و پرداخت
واقعی هم بدون تأیید مالک اجرا نمی‌شوند.

## کارهای لازم پیش از انتشار عمومی

1. تغییرات همین working tree هنوز deploy نشده‌اند: rollout دو مرحله‌ای Edge، backup
   قابل‌بازیابی و migrationهای `140000` تا `170000` باید طبق سند deploy انجام شوند.
2. ماتریس reminder روی حداقل یک گوشی واقعی، شامل اپ بسته/پس‌زمینه، permission،
   timezone/reboot و exact alarm اندروید باید اجرا شود؛ build یا شبیه‌ساز جای آن نیست.
3. یک OTP واقعی و یک پرداخت واقعی کنترل‌شده فقط با تأیید صریح مالک انجام شود.
4. URL واقعی APK بعد از آپلود در `ANDROID_DOWNLOAD_URL` قرار بگیرد؛ URL حدسی ممنوع است.
5. بودجهٔ SMS، ظرفیت واقعی providerها و Rate Limiting/WAF سراسری Cloudflare برای OTP
   و checkout بررسی شود؛ محدودیت شماره/IP به‌تنهایی جلوی چرخش هویت را نمی‌گیرد.
6. `npm run load:smoke` فقط روی API محلی اجرا شود و p50/p95/p99، حجم پاسخ، histogram
   status و خطاهای غیرمنتظره‌اش ثبت شود. این تست public read-only است و اثبات بار
   واقعی Postgres، پرداخت یا پیامک نیست؛ اجرای remote پیش‌فرض بسته است.

## گیت تأیید هر انتشار

```text
npm test
npm run test:edge
npm run lint
npm run build
npm run build:mobile
npm run sync:edge
node scripts/gen-setup-sql.mjs
node scripts/load-smoke.mjs --url http://127.0.0.1:3000
cd backend && npm test
cd backend && npm run typecheck
cd backend && npm run build
npm run cap:sync
```

گزارش load-smoke فقط وقتی معتبر است که backend محلی واقعاً در حال اجرا باشد. پاسِ
محلی به معنی deploy، اعمال SQL، سلامت WAF/provider یا توان ۱۰۰۰ کاربر در production
نیست؛ آن‌ها بعد از backup و canary زنده جداگانه اثبات می‌شوند.

## محدودیت‌های واقعی

- وب‌اپ کاملاً بسته کد اجرا نمی‌کند؛ revoke در اولین open/request/online اثر می‌کند.
- مرورگر نمی‌تواند Clear site data یا حذف پروفایل را متوقف کند؛ cloud sync و Export
  ریسک را کم می‌کنند.
- زمان تحویل اعلان به سیاست‌های سیستم‌عامل، battery optimization و permission وابسته
  است و فقط روی سخت‌افزار واقعی قابل تأیید است.
