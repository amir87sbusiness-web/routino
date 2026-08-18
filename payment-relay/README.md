# رلهٔ پرداخت روتینو

این سرویس فقط دو درخواست سروربه‌سرور زیبال (`request` و `verify`) را از یک IPv4 ثابت عبور می‌دهد. دیتابیس، صف، cron و رابط عمومی ندارد و اطلاعات کارت را ذخیره یا لاگ نمی‌کند.

## متغیرهای سرویس

| نام              | مقدار                                                          |
| ---------------- | -------------------------------------------------------------- |
| `ZIBAL_MERCHANT` | کد پذیرندهٔ واقعی زیبال                                        |
| `RELAY_SECRET`   | یک secret تصادفی حداقل ۳۲ کاراکتری؛ دقیقاً همان مقدار Supabase |
| `PORT`           | اختیاری؛ پیش‌فرض `3000`                                        |

در حالت production مقدار آزمایشی `zibal` عمداً رد می‌شود تا خرید آزمایشی به‌اشتباه اشتراک واقعی نسازد. `ALLOW_TEST_PROVIDERS=true` فقط برای محیط تست است و روی سرور اصلی نباید تنظیم شود.

## اجرا با Docker

```bash
docker build -t routino-payment-relay .
docker run -d --restart unless-stopped \
  --name routino-payment-relay \
  -p 127.0.0.1:3000:3000 \
  -e ZIBAL_MERCHANT='<merchant>' \
  -e RELAY_SECRET='<random-32+-character-secret>' \
  routino-payment-relay
```

پورت داخلی نباید مستقیماً روی اینترنت باز باشد. یک DNS از نوع `A` مثل `zibal-relay.routino.me` به IPv4 ثابت سرور بساز و سرویس را پشت HTTPS قرار بده. نمونهٔ حداقلی Caddy:

```caddyfile
zibal-relay.routino.me {
  request_body {
    max_size 8KB
  }
  reverse_proxy 127.0.0.1:3000
}
```

در فایروال فقط SSH محدود و پورت‌های `80/443` را باز نگه دار؛ پورت `3000` عمومی نباشد. اگر DNS پشت پروکسی Cloudflare است، WAF و rate limiting را برای مسیرهای `/v1/request` و `/v1/verify` فعال کن. IP خروجی همچنان IPv4 خود سرور است، نه IP پروکسی Cloudflare.

health check:

```bash
curl -fsS https://zibal-relay.routino.me/health
```

پاسخ سالم:

```json
{ "ok": true, "service": "routino-payment-relay" }
```

## IP زیبال

از داخل همان میزبان، IPv4 خروجی را بخوان:

```bash
curl -4 https://icanhazip.com
```

**فقط همان IP ثابت** را در تنظیمات درگاه روتینو در زیبال ثبت کن. IP دامنه، Cloudflare، گوشی یا Supabase درست نیست؛ IP باید آدرس خروجی خود میزبان رله باشد.

این نسخه برای یک نمونهٔ فعال طراحی شده است؛ حافظهٔ nonce داخل همان فرایند نگهداری می‌شود. برای چند replica باید nonce store مشترک اضافه شود، وگرنه محافظت replay بین replicaها کامل نیست. برای مصرف کم حساب‌های رایگان، همان یک نمونه کافی است و هیچ دیتابیس، cron یا polling ندارد.

بعد، secretهای Edge Function را تنظیم کن:

```bash
npx supabase secrets set \
  ZIBAL_RELAY_URL=https://zibal-relay.routino.me \
  ZIBAL_RELAY_SECRET='<same-relay-secret>' \
  --project-ref axychfrteevhfdhgvfuv
```

تنظیم فقط یکی از این دو مقدار در production عمداً باعث می‌شود تابع بالا نیاید؛ پرداخت نیمه‌پیکربندی‌شده نباید به کاربر نمایش داده شود.
