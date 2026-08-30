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

بعد از backup غیرخالی و dry-run، migrationهای `supabase/migrations/` را به ترتیب
نام اجرا کن. migration پرداخت قبل از حذف ستون قدیمی روی وضعیت مبهم متوقف می‌شود.
`20260831120000_compact_habit_logs_by_month.sql` نیز همهٔ `logs`های legacy را در
یک تراکنش به `habitMonths` تبدیل می‌کند، cursorهای عقب‌مانده را با `gc_seq` به reset
امن می‌فرستد و روی ردیف malformed کامل rollback می‌کند.
`20260831130000_account_sync_budgets.sql` سپس تعداد ردیف و بایت JSON هر حساب را
یک‌بار از دیتای موجود بک‌فیل می‌کند؛ اگر حسابی از ۵۰٬۰۰۰ ردیف یا ۱۲۸ MiB عبور کرده
باشد، migration بدون حذف یا حدس کامل rollback می‌شود تا بررسی دستی انجام شود.

کد Edge این release ستون‌های accounting را در queryهای عمومی `users` انتخاب
نمی‌کند؛ بنابراین می‌توان ابتدا Edge را روی schema قدیمی smoke-test کرد، بعد migration
budget را اجرا کرد و دوباره sync را آزمود. نسخهٔ قدیمی Edge نیز با ستون/trigger جدید
سازگار است. اجرای migration قبل از backup معتبر یا روی پروژهٔ اشتباه ممنوع است.

این release عمداً pre-launch است: migration ماه constraint نهایی پروتکل ۲ را فعال
می‌کند و بعد تابع Edge/فرانت/اپِ v2 منتشر می‌شوند. اگر قبل از اجرای این توالی نسخه‌ای
به کاربر واقعی داده شده باشد، این ترتیب دیگر مجاز نیست و باید rollout دوconstraintی
سازگار با کلاینت قدیمی جدا طراحی شود؛ migration و deploy را کورکورانه ادامه نده.

Secretهای لازم:

```text
NODE_ENV=production
DB_DRIVER=postgres
DATABASE_URL=<Supabase transaction pooler URL>
JWT_SECRET=<random 32+ chars>
OTP_PEPPER=<random 16+ chars>
ADMIN_TOKEN=<random 12+ chars>
PROXY_SECRET=<same value as Cloudflare Worker>
SMS_PROVIDER=kavenegar
KAVENEGAR_API_KEY=<server secret>
KAVENEGAR_TEMPLATE=routino-otp
PSP_PROVIDER=zarinpal
ZARINPAL_MERCHANT=<real merchant UUID>
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

## اعتبارسنجی بعد از deploy

1. `health` و `health/ready`، لاگ cold-start و CORS وب/موبایل را بررسی کن.
2. مطمئن شو لاگ `psp=zarinpal` و `sms=kavenegar` دارد و هیچ هشدار TEST MODE نیست.
3. با تأیید مالک یک OTP واقعی و یک پرداخت کم‌مبلغ واقعی انجام بده.
4. در DB تطبیق `amount_rial`، `authority`، `status=paid`، یک grant و یک entitlement
   را ببین؛ callback و poll تکراری نباید grant دوم بسازند.
5. برگشت وب و deep-link را روی گوشی واقعی تست کن. build سبز یا emulator به‌تنهایی
   اثبات delivery در production نیست.
6. Rate Limiting/WAF سراسری Cloudflare برای OTP و checkout را جدا از محدودیت‌های
   هر شماره، IP و حساب بررسی کن؛ سقف فعلی SMS حداکثر ۲۰۰۰ درخواست provider در روز است.

هیچ deploy، تغییر secret، اجرای migration production یا تراکنش واقعی از اجرای
محلی تست‌ها استنتاج نمی‌شود؛ این اقدامات باید روی پروژه/حساب درست و با مجوز مالک
انجام و سپس با شواهد زنده ثبت شوند.
