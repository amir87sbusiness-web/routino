# انتشار بک‌اند روی Supabase Edge Functions

مسیر رسمی بک‌اند production روتینو Supabase Edge است. منطق اصلی در
`backend/src/` تغییر می‌کند و با `npm run sync:edge` به کپی generated تابع Edge
می‌رود. فرانت روی Cloudflare Pages و اپ موبایل با Capacitor باقی می‌مانند.

## قرارداد production

- تنها درگاه واقعی `PSP_PROVIDER=zarinpal` است.
- `ZARINPAL_MERCHANT` باید مرچنت UUID واقعی ۳۶نویسه‌ای باشد.
- fake فقط برای تست خودکار/توسعه است و production آن را بدون override رد می‌کند.
- `SMS_PROVIDER=console` نیز در production ممنوع است؛ برای لانچ `kavenegar` لازم است.
- `PUBLIC_API_URL` باید HTTPS و از مرورگر/گوشی کاربر قابل دسترس باشد.
- `PUBLIC_WEB_URL` باید مسیر واقعی وب‌اپ را داشته باشد و `APP_DEEP_LINK` با تنظیمات
  Capacitor/Android/iOS هماهنگ باشد.

## ترتیب انتشار

```powershell
npm ci
Push-Location backend
npm ci
npm run typecheck
npm test -- --maxWorkers=1
Pop-Location
npm run sync:edge
npm run test:edge -- --maxWorkers=1
node scripts/gen-setup-sql.mjs
```

برای release کشسان فعلی این توالی دو مرحله‌ای ایمن است؛ هیچ تست محلی اجازهٔ اجرای
production نمی‌دهد و همهٔ مراحل production مجوز جداگانه می‌خواهند:

1. project ref را دوباره چک کن؛ backup غیرخالی و قابل‌بازیابی از `users`، `records`، `payments`، `grants`، `entitlements`، `redemptions` و `discounts` بگیر و restore/read-only check آن را ثبت کن. migrationها را اول روی clone یا dry-run بررسی کن؛ `setup.sql` جای migration production نیست.
2. ابتدا artifact میانی sync fail-closed (در تاریخ این تغییر، commit `ce19d76`) را deploy کن. این نسخه هنوز به `provider_capacity_leases` و `checkout_provider` وابسته نیست. روی schema قدیمی، exchange عقب‌مانده و push قدیمی non-2xx می‌شوند تا outbox پاک نشود. این پنجره صفر-downtime نیست و باید کوتاه و مانیتورشده باشد.
3. `health/ready`، `/v1/plans`، cursor عادی، reset و باقی‌ماندن outbox را canary کن. سپس فقط migrationهای افزایشی را به ترتیب `20260905140000_elastic_launch_hardening.sql`، `20260905150000_sync_gc_admission_and_maintenance_bounds.sql`، `20260905160000_provider_capacity_and_atomic_otp.sql` و `20260905170000_elastic_checkout_identity.sql` اجرا کن. `170000` قبل از ساخت index، nonterminalهای منطقی تکراری را چک می‌کند و در صورت ابهام بدون تغییر داده abort می‌شود.
4. Edge نهایی را deploy کن و ابتدا sync و endpointهای بدون خرج provider را canary کن. OTP و checkout واقعی فقط در مرحلهٔ post-deploy و با تأیید مالک انجام می‌شوند. compactor هر دقیقه حداکثر ۱٬۰۰۰ و tombstone purge هر ۵ دقیقه حداکثر ۲٬۰۰۰ ردیف می‌گیرند؛ هر دو timeout و no-overlap دارند. ظرفیت ۱٬۴۴۰٬۰۰۰ task/day فقط schedule×batch نظری است، نه benchmark Supabase.

مرز rollback: بعد از اعمال این چهار migration، برای برگشت سریع فقط Edge را به artifact
میانی برگردان؛ schemaها افزایشی و با کد قبلی سازگارند. migration معکوس، حذف index/table
یا پاک‌کردن ردیف مجاز نیست. اگر cron مشکل ساخت، فقط با مجوز مالک job را موقتاً
`cron.unschedule` کن و داده/تابع را نگه دار.

### SQL پایش قبل و بعد از canary

```sql
select * from routino_task_compaction_backlog(now());

select count(*) as eligible_tombstones,
       min(to_timestamp(updated_at / 1000.0)) as oldest_eligible_at
from records
where deleted = true
  and updated_at < floor(
    extract(epoch from (now() - interval '90 days')) * 1000
  )::bigint;

select jobid, jobname, schedule, active
from cron.job
where jobname in ('routino-task-month-compaction', 'routino-tombstone-purge');

select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname in ('routino-task-month-compaction', 'routino-tombstone-purge')
order by d.start_time desc
limit 40;

select kind, count(*) as active_leases, min(expires_at), max(expires_at)
from provider_capacity_leases
where expires_at > now()
group by kind;
```

هیچ query پاک‌سازی دستی روی payment/grant/entitlement/redemption اجرا نکن.
`provider_unknown` و همهٔ پرداخت‌های nonterminal باید تا تعیین نتیجه بمانند؛ migration
`170000` نیز در ابهام باید متوقف شود، نه اینکه مشتری را حذف یا status را حدس بزند.

برای retention حساب، قبل از هر write فایل
`supabase/precheck/20260902_trial_account_cleanup_dry_run.sql` را اجرا کن و فقط آمار
تجمیعی را ثبت کن. همهٔ `selected_with_*` باید صفر باشند. سپس migration افزایشی
`20260903120000_trial_account_retention.sql` را اجرا کن؛ زمان همان اجرای اول، کف
یک‌بارهٔ ۳۰روزهٔ کاربران قبلی است و retry آن را جابه‌جا نمی‌کند. cron جداگانهٔ
`20260903121000_trial_account_cleanup_cron.sql` فقط بعد از postcheck نصب می‌شود،
روزی یک بار batch=50 می‌گیرد و برای کاربران قبل از deploy تا پایان grace چیزی حذف
نمی‌کند.

`20260831120000_compact_habit_logs_by_month.sql` همهٔ `logs`های legacy را در یک
تراکنش به `habitMonths` تبدیل می‌کند، cursorهای عقب‌مانده را با `gc_seq` به reset
امن می‌فرستد و روی ردیف malformed کامل rollback می‌کند. هر migration قدیمی budget
باید پیش از اجرا روی clone با schema فعلی بررسی شود؛ این راهنما هیچ سقف ذخیره‌سازی
مادام‌العمر یا ظرفیت provider را تضمین نمی‌کند.

کد Edge این release ستون‌های accounting را در queryهای عمومی `users` انتخاب
نمی‌کند؛ بنابراین می‌توان ابتدا Edge را روی schema قدیمی smoke-test کرد، بعد migration
افزایشی را اجرا و دوباره sync را آزمود. نسخهٔ قدیمی Edge نیز با ستون/trigger جدید
سازگار است. اجرای migration قبل از backup معتبر یا روی پروژهٔ اشتباه ممنوع است.

این پروژه اکنون داده و پرداخت واقعی دارد؛ بنابراین فرض pre-launch دیگر معتبر نیست.
قبل از هر migration، نسخهٔ کلاینت‌های فعال و سازگاری پروتکل را بررسی کن، backup
قابل‌بازیابی بگیر و rollout را افزایشی انجام بده. migration یا deploy یک‌جای همهٔ
فایل‌ها مجاز نیست؛ ترتیب ویژهٔ احراز هویت پایین‌تر هم باید رعایت شود.

Secretهای لازم:

```text
NODE_ENV=production
DB_DRIVER=postgres
DATABASE_URL=<Supabase transaction pooler URL>
JWT_SECRET=<random 32+ chars>
OTP_PEPPER=<random 16+ chars>
ADMIN_PHONE=<owner phone, Supabase secret only>
ADMIN_SESSION_SECRET=<random 32+ chars>
PROXY_SECRET=<same value as Cloudflare Worker>
SMS_PROVIDER=kavenegar
KAVENEGAR_API_KEY=<server secret>
KAVENEGAR_TEMPLATE=routino-otp
PSP_PROVIDER=zarinpal
ZARINPAL_MERCHANT=<real merchant UUID>
SMS_PROVIDER_MAX_CONCURRENCY=32
PSP_PROVIDER_MAX_CONCURRENCY=64
PUBLIC_API_URL=https://api.routino.me
PUBLIC_WEB_URL=https://routino.me/app
APP_DEEP_LINK=routino://pay/result
CORS_ORIGINS=https://routino.me,https://localhost,capacitor://localhost
```

Secretها را در repository، bundle، log یا خروجی مشترک قرار نده. بعد از تنظیم secret
و migration، تابع را با تنظیم `verify_jwt=false` پروژه deploy کن:

```powershell
npx supabase functions deploy api --no-verify-jwt --project-ref <PROJECT_REF>
```

### ترتیب امن migrationهای احراز هویت ادمین

چون کاربر و پرداخت واقعی وجود دارد، سه migration جدید را یک‌جا و کورکورانه push نکن:

1. از جدول‌های عملیاتی و کاربر/پرداخت backup قابل‌بازیابی بگیر و project ref را دوباره چک کن.
2. فقط migration افزایشی `20260831140000_auth_rate_limit_buckets.sql` و migration افزایشی `20260831142000_payment_verify_backoff.sql` را اجرا کن؛ هیچ جدول کاربری حذف نمی‌شود.
3. Secretهای `ADMIN_PHONE` و `ADMIN_SESSION_SECRET` را روی سرور تنظیم کن و Edge جدید را deploy کن.
4. مالک باید در `/admin` شماره را خودش وارد کند، OTP واقعی بگیرد و ورود/خروج و یک درخواست ادمین را موفق ببیند.
5. فقط بعد از این اثبات و کنترل دوبارهٔ backup/countها، migration قراردادی `20260831141000_remove_legacy_auth_tables.sql` را اجرا کن. این migration اگر `admins` خالی نباشد عمداً abort می‌شود و فقط جدول‌های قدیمی `login_attempts` و `admins` را حذف می‌کند؛ به دادهٔ ژورنال، عادت، کاربر، اشتراک یا پرداخت دست نمی‌زند.

اگر مرحلهٔ ۴ موفق نشد، Edge قبلی را برگردان و migration قراردادی را اجرا نکن؛ جدول‌های قدیمی بلااستفاده اما سالم می‌مانند.

## اعتبارسنجی بعد از deploy

1. `health` و `health/ready`، لاگ cold-start و CORS وب/موبایل را بررسی کن.
2. مطمئن شو لاگ `psp=zarinpal` و `sms=kavenegar` دارد و هیچ هشدار TEST MODE نیست.
3. با تأیید مالک یک OTP واقعی و یک پرداخت کم‌مبلغ واقعی انجام بده.
4. در DB تطبیق `amount_rial`، `authority`، `status=paid`، یک grant و یک entitlement
   را ببین؛ callback و poll تکراری نباید grant دوم بسازند.
5. برگشت وب و deep-link را روی گوشی واقعی تست کن. build سبز یا emulator به‌تنهایی
   اثبات delivery در production نیست.
6. Rate Limiting/WAF سراسری Cloudflare برای OTP و checkout را جدا از محدودیت‌های
   هر شماره و IP بررسی کن. سقف روزانهٔ تجاری وجود ندارد؛ مقادیر concurrency باید با
   ظرفیت واقعی Kavenegar/ZarinPal و پلن Supabase تنظیم شوند، نه با تعداد کل کاربر.

هیچ deploy، تغییر secret، اجرای migration production یا تراکنش واقعی از اجرای
محلی تست‌ها استنتاج نمی‌شود؛ این اقدامات باید روی پروژه/حساب درست و با مجوز مالک
انجام و سپس با شواهد زنده ثبت شوند.
