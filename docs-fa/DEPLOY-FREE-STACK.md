# مسیر جایگزین VM / سرویس رایگان

مسیر رسمی لانچ در [DEPLOY-SUPABASE-EDGE.md](DEPLOY-SUPABASE-EDGE.md) است. این فایل
فقط برای حالتی است که آگاهانه backend Fastify را روی VM/Render اجرا می‌کنی.

## اجزا

- Cloudflare Pages برای وب
- Postgres واقعی برای دیتابیس
- backend Fastify پشت HTTPS/reverse proxy
- کاوه‌نگار برای OTP
- زرین‌پال به‌عنوان تنها درگاه production

## env لازم

```text
NODE_ENV=production
DB_DRIVER=postgres
DATABASE_URL=<postgres URL>
JWT_SECRET=<random 32+ chars>
OTP_PEPPER=<random 16+ chars>
ADMIN_TOKEN=<random 12+ chars>
TRUST_PROXY=true
SMS_PROVIDER=kavenegar
KAVENEGAR_API_KEY=<secret>
KAVENEGAR_TEMPLATE=routino-otp
PSP_PROVIDER=zarinpal
ZARINPAL_MERCHANT=<real merchant UUID>
PUBLIC_API_URL=https://api.routino.me
PUBLIC_WEB_URL=https://routino.me/app
APP_DEEP_LINK=routino://pay/result
CORS_ORIGINS=https://routino.me,https://localhost,capacitor://localhost
```

در production، fake و پیامک کنسولی توسط `env.ts` رد می‌شوند. قبل از بالا آوردن
نسخه جدید migration زرین‌پال-only را اجرا و سپس health/readiness را بررسی کن.

## گیت لانچ

```powershell
npm ci
Push-Location backend
npm ci
npm run typecheck
npm test -- --maxWorkers=1
Pop-Location
npm run test:edge -- --maxWorkers=1
npm run lint
npm run build
npm run build:mobile
```

بعد از deploy، یک OTP و پرداخت واقعی کنترل‌شده، callback/poll تکراری، برگشت وب و
deep-link روی گوشی واقعی باید جداگانه بررسی شوند. تست محلی جای شواهد production را
نمی‌گیرد.
