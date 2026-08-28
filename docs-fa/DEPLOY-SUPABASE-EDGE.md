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

سپس migration
`supabase/migrations/20260828120000_zarinpal_only_payments.sql` را روی پروژه درست
اجرا کن. migration قبل از حذف ستون‌های قدیمی، اگر پرداخت تسویه‌نشده یا grant مالی
تکراری ببیند متوقف می‌شود و چیزی را حدسی حذف نمی‌کند.

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

هیچ deploy، تغییر secret، اجرای migration production یا تراکنش واقعی از اجرای
محلی تست‌ها استنتاج نمی‌شود؛ این اقدامات باید روی پروژه/حساب درست و با مجوز مالک
انجام و سپس با شواهد زنده ثبت شوند.
