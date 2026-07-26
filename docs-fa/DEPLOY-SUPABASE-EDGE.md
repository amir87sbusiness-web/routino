# انتشار بک‌اند روی Supabase Edge Functions

مسیر فعلی و رسمی لانچ بک‌اند (جایگزین مسیر Render در
[`DEPLOY-FREE-STACK.md`](DEPLOY-FREE-STACK.md) — Render برای اکانت جدید کارت
بانکی می‌خواست). فرانت همان Cloudflare Pages می‌ماند؛ دیتابیس و بک‌اند هر دو
داخل **یک پروژه‌ی Supabase** هستند.

---

## 📍 وضعیت فعلی لانچ (به‌روز: ۳ مرداد ۱۴۰۵ / 2026-07-25)

> **Claude: قبل از هر کار مربوط به لانچ، این بخش کافیه — نیازی به دوباره‌کشف نیست.**

**زیرساخت وب کامل دیپلوی شده و بالاست**، ولی هنوز در **حالت تست** برای پیامک و پرداخت:

| تکه | آدرس / مقدار | وضعیت |
|---|---|---|
| بک‌اند (Supabase Edge) | `api.routino.me/health` → `{ok:true}` | ✅ بالا |
| دیتابیس | `api.routino.me/health/ready` → `db:up` | ✅ وصل |
| Cloudflare Worker | `api.routino.me` | ✅ کار می‌کند |
| سایت اصلی (CF Pages) | `routino.me` → HTTP 200 | ✅ بالا |
| پلن‌ها (از DB) | `/v1/plans` → m1=۵۹k، m3=۱۴۹k، m12=۴۴۹k تومان | ✅ seed شده |
| `NODE_ENV` / `DB_DRIVER` | `production` / `postgres` | ✅ درست |
| **`SMS_PROVIDER`** | **`console`** | ❌ **پیامک تستی — کاربر واقعی کد ورود نمی‌گیرد** |
| **`ZIBAL_MERCHANT`** | **`zibal`** (سندباکس) | ❌ **پول واقعی جابه‌جا نمی‌شود** |

- **پروژه‌ی Supabase:** نام `routino` · ref `axychfrteevhfdhgvfuv` · org `qgvjcextnciiezisegdt` · region eu-north-1.
  حسابِ مالکِ روتینو **جدا** از حسابی است که پروژه‌ی «sheetra» را دارد — برای مدیریت باید با حساب درست `supabase login` کرد.
- **چک‌کردن مقدار secretها بدون دیدن مقدار:** `supabase secrets list` فقط اثرانگشت (sha256) هر مقدار را می‌دهد؛ با محاسبه‌ی `printf "%s" "console" | sha256sum` و مقایسه می‌شود فهمید. جایگزین ساده‌تر: لاگ استارتاپ تابع `[api] edge function up (sms=… psp=…)` را در Dashboard → Edge Functions → api → Logs ببین.

### دو کارِ باقی‌مانده تا لانچ واقعی

هر دو: کاربر یک secret را ست می‌کند → سپس redeploy. **قالب کاوه‌نگار و مرچنت زیبال هر دو بررسی انسانیِ چندروزه دارند — زودتر شروع شوند.** (Claude نباید کلید/مرچنت را خودش وارد کند؛ کاربر `secrets set` را می‌زند، Claude فقط redeploy + تست.)

**۱) پیامک واقعی (بلاکر اصلی ورود):**
```bash
# کاربر (بعد از گرفتن کلید + تأیید قالب verify/lookup به نام routino-otp):
supabase secrets set SMS_PROVIDER=kavenegar KAVENEGAR_API_KEY=<key> --project-ref axychfrteevhfdhgvfuv
# اگر نام قالب routino-otp نیست: KAVENEGAR_TEMPLATE=<name> را هم اضافه کن (پیش‌فرض env: routino-otp)
# سپس:
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```
(احتیاط env.ts: در production اگر `SMS_PROVIDER=kavenegar` باشد و `KAVENEGAR_API_KEY` نباشد، تابع اصلاً بالا نمی‌آید.)

**۲) درگاه واقعی زیبال (قبل از پایان ۷ روز رایگانِ کاربرها):**
```bash
supabase secrets set ZIBAL_MERCHANT=<کد-پذیرنده-واقعی> --project-ref axychfrteevhfdhgvfuv
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```

### تست محلی (تأییدشده کار می‌کند)
`cd backend && npm run dev` (سرور :3000، sms=console → کد در ترمینال، psp=fake) + `npm run dev` (وب :5180، به :3000 پروکسی می‌شود). کل مسیر آنبوردینگ → ورود OTP → اپ اصلی محلی تست و سالم است.

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
  می‌کند — ۵۰ تست شامل کل مسیر پول. بک‌اند Node همچنان مرجع توسعه‌ی محلی است
  (`cd backend && npm run dev`) و ۱۱۶ تست خودش را دارد.

## چرخه‌ی یک تغییر بک‌اند

```bash
# ۱) منطق را در backend/src تغییر بده  ۲) کپی و تست  ۳) دیپلوی
npm run sync:edge
cd backend && npm test && cd .. && npm run test:edge
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```

> **اگر schema دیتابیس عوض شد** (مثل ستون/جدول جدید): اول `node scripts/gen-setup-sql.mjs` را بزن تا `supabase/setup.sql` تازه شود، بعد محتوایش را در Supabase → SQL Editor بچسبان (idempotent است، ضرری به دیتای موجود نمی‌زند). تابعِ Edge خودش migration اجرا نمی‌کند.

### 🔐 ورود با رمز عبور (بعد از افزوده‌شدن این قابلیت — یک‌بار)

۱) **migration**: `supabase/setup.sql` را دوباره در SQL Editor اجرا کن (ستون‌های `username`/`password_hash` روی `users` + جدول `login_attempts` را می‌سازد).
۲) **ساخت حساب صاحب اپ** — یکی از دو راه:
   - **پنل ادمین** (`api.routino.me/admin` یا مستقیم روی تابع): تب «کاربران» → «تنظیم/ریست رمز عبور» → شماره + رمز → اعمال (اگر حساب نباشد می‌سازد).
   - **خودکار با env**: secretهای `OWNER_PHONE`، `OWNER_PASSWORD` (و اختیاری `OWNER_USERNAME`) را ست کن؛ سرور موقع بالا آمدن حساب را می‌سازد و رمز اولیه را می‌گذارد. **هیچ‌وقت رمزی را که کاربر خودش عوض کرده بازنویسی نمی‌کند.**

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
   | `OWNER_PHONE` / `OWNER_PASSWORD` / `OWNER_USERNAME` | اختیاری — بوت‌استرپ حساب صاحب اپ برای ورود با رمز از همان بوت اول (بخش «ورود با رمز عبور» بالا) |
   | `SMS_PROVIDER` | فعلاً `console` (کد ورود در لاگ تابع) → بعداً `kavenegar` + `KAVENEGAR_API_KEY` (+ `KAVENEGAR_TEMPLATE` اگر نام قالب ≠ `routino-otp`) |
   | `PSP_PROVIDER` | فعلاً `zibal` با `ZIBAL_MERCHANT=zibal` (سندباکس) → بعداً مرچنت واقعی / `PSP_PROVIDERS=zarinpal,zibal` |

   > وضعیت فعلیِ همین secretها و دستورهای دقیقِ «واقعی‌کردن» در بخش [«📍 وضعیت فعلی لانچ»](#-وضعیت-فعلی-لانچ-به‌روز-۳-مرداد-۱۴۰۵--2026-07-25) بالای همین فایل است.

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
