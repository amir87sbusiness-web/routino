# انتشار بک‌اند روی Supabase Edge Functions

مسیر فعلی و رسمی لانچ بک‌اند (جایگزین مسیر Render در
[`DEPLOY-FREE-STACK.md`](DEPLOY-FREE-STACK.md) — Render برای اکانت جدید کارت
بانکی می‌خواست). فرانت همان Cloudflare Pages می‌ماند؛ دیتابیس و بک‌اند هر دو
داخل **یک پروژه‌ی Supabase** هستند.

---

## نقشه

```
کاربر ── routino.me ──────────► Cloudflare Pages (وب‌اپ)
کاربر ── api.routino.me ─────► Cloudflare Worker (cloudflare/api-worker.js)
                                  │  + x-proxy-secret  + x-client-ip
                                  ▼
                    Supabase Edge Function «api» (Deno + Hono)
                                  │
                                  ▼
                    Supabase Postgres (transaction pooler :6543)
```

- **Worker چرا؟** کاربر ایرانی به لبه‌ی Cloudflare می‌رسد؛ آدرس خام
  `*.supabase.co` هم با `PROXY_SECRET` مسدود است (فقط Worker می‌تواند تابع را
  صدا بزند) و هدر IP کاربر برای سقف‌های پیامکی قابل‌اعتماد می‌شود.
- مسیرهای عمومی (`/v1/...`، `/admin`، `/health`) عیناً مثل قبل‌اند — فرانت و
  callback درگاه و پنل ادمین هیچ تغییری نمی‌خواهند.

## معماری کد (مهم برای تغییرات بعدی)

- **منطق** (OTP، توکن‌ها، قیمت‌گذاری، اشتراک، **ماشین حالت پرداخت**، درگاه‌ها،
  صفحه‌ی نتیجه، صفحه‌ی ادمین) در `backend/src/` زندگی می‌کند و با
  `npm run sync:edge` **عیناً** در `supabase/functions/api/shared/` کپی می‌شود.
  تست `backend/test/edge-parity.test.ts` جلوی هر جدایی را می‌گیرد
  (`shared/` تولیدشده است — هرگز دستی ویرایش نکن؛ eslint هم عمداً نادیده‌اش
  می‌گیرد).
- **لایه‌ی HTTP اج** (Hono): `supabase/functions/api/{app,deps,routes/*}.ts` —
  آداپتور نازک روی همان سرویس‌ها. ورودی Deno فقط `index.ts` است.
- **تست‌ها**: `npm run test:edge` (ریشه) همین اپ اج را با PGlite زیر Node اجرا
  می‌کند — ۴۷ تست شامل کل مسیر پول. بک‌اند Node همچنان مرجع توسعه‌ی محلی است
  (`cd backend && npm run dev`) و ۱۱۵ تست خودش را دارد.

## چرخه‌ی یک تغییر بک‌اند

```bash
# ۱) منطق را در backend/src تغییر بده  ۲) کپی و تست  ۳) دیپلوی
npm run sync:edge
cd backend && npm test && cd .. && npm run test:edge
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```

## راه‌اندازی (یک‌بار)

1. **دیتابیس**: `supabase/setup.sql` (تولیدشده از همان DDL تست‌شده) روی پروژه
   اعمال شده — جدول‌ها + پلن‌ها + جاب ساعتی pg_cron برای پاک‌سازی OTP.
   اگر لازم شد دوباره: paste در SQL Editor (idempotent است).
2. **لاگین CLI**: `npx supabase login` (مرورگر باز می‌شود؛ با اکانت صاحب پروژه
   تأیید کن).
3. **Secrets تابع** (CLI: `npx supabase secrets set KEY=VALUE --project-ref …`
   یا Dashboard → Edge Functions → Secrets):

   | کلید | مقدار |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DB_DRIVER` | `postgres` |
   | `DATABASE_URL` | رشته‌ی **Transaction pooler (پورت 6543)** پروژه |
   | `JWT_SECRET` / `OTP_PEPPER` / `ADMIN_TOKEN` | رمزهای تصادفی تولیدشده |
   | `PROXY_SECRET` | همان مقدار Worker |
   | `PUBLIC_API_URL` | `https://api.routino.me` |
   | `PUBLIC_WEB_URL` | `https://routino.me` |
   | `CORS_ORIGINS` | `https://routino.me,https://localhost,capacitor://localhost` |
   | `SMS_PROVIDER` | فعلاً `console` (کد ورود در لاگ تابع) → بعداً `kavenegar` + `KAVENEGAR_API_KEY` |
   | `PSP_PROVIDER` | فعلاً `zibal` با `ZIBAL_MERCHANT=zibal` (سندباکس) → بعداً مرچنت واقعی / `PSP_PROVIDERS=zarinpal,zibal` |

4. **دیپلوی تابع**: دستور بالا (`--no-verify-jwt` حیاتی است؛ `config.toml` هم
   `verify_jwt=false` دارد).
5. **Worker**: محتوای `cloudflare/api-worker.js` را در Cloudflare →
   Workers & Pages → Create Worker بچسبان؛ متغیر secret به نام `PROXY_SECRET`
   بده؛ و در Settings → Domains دامنه‌ی `api.routino.me` را وصل کن.
6. **تست دود**: `https://api.routino.me/health` و `/health/ready` باید
   `{ok:true}` بدهند؛ `https://routino.me` → ورود با شماره → کد را از
   Dashboard → Edge Functions → api → Logs بردار.

## نکته‌ها

- تایمر پاک‌سازی OTP دیگر در پروسه نیست؛ **pg_cron** انجامش می‌دهد
  (`select * from cron.job` برای دیدنش).
- `/health` بدون `PROXY_SECRET` هم باز است (برای مانیتورینگ).
- Cold start تابع ~چند صد میلی‌ثانیه است؛ خواب ۱۵دقیقه‌ای Render را ندارد.
- محدودیت پلن رایگان Supabase: 500K فراخوانی تابع در ماه — برای شروع بسیار کافی.
