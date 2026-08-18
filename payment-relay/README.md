# رلهٔ پرداخت روتینو

این سرویس فقط دو درخواست سروربه‌سرور زیبال (`request` و `verify`) را از یک IPv4 ثابت عبور می‌دهد. دیتابیس، صف، cron و رابط عمومی ندارد و اطلاعات کارت را ذخیره یا لاگ نمی‌کند.

## متغیرهای سرویس

| نام              | مقدار                                                          |
| ---------------- | -------------------------------------------------------------- |
| `ZIBAL_MERCHANT` | کد پذیرندهٔ واقعی زیبال                                        |
| `RELAY_SECRET`   | یک secret تصادفی حداقل ۳۲ کاراکتری؛ دقیقاً همان مقدار Supabase |
| `PORT`           | اختیاری؛ پیش‌فرض `3000`                                        |

## اجرا با Docker

```bash
docker build -t routino-payment-relay .
docker run -d --restart unless-stopped \
  -p 3000:3000 \
  -e ZIBAL_MERCHANT='<merchant>' \
  -e RELAY_SECRET='<random-32+-character-secret>' \
  routino-payment-relay
```

سرویس را پشت HTTPS روی دامنه‌ای مثل `zibal-relay.routino.me` قرار بده. health check:

```bash
curl -fsS https://zibal-relay.routino.me/health
```

پاسخ سالم:

```json
{ "ok": true, "service": "routino-payment-relay" }
```

## IP زیبال

از داخل همان میزبان، IPv4 خروجی را بخوان و **فقط همان IP ثابت** را در تنظیمات درگاه روتینو در زیبال ثبت کن. IP دامنه، Cloudflare، گوشی یا Supabase درست نیست؛ IP باید آدرس خروجی خود میزبان رله باشد.

بعد، secretهای Edge Function را تنظیم کن:

```bash
npx supabase secrets set \
  ZIBAL_RELAY_URL=https://zibal-relay.routino.me \
  ZIBAL_RELAY_SECRET='<same-relay-secret>' \
  --project-ref axychfrteevhfdhgvfuv
```

تنظیم فقط یکی از این دو مقدار در production عمداً باعث می‌شود تابع بالا نیاید؛ پرداخت نیمه‌پیکربندی‌شده نباید به کاربر نمایش داده شود.
