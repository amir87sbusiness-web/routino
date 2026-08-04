# انتشار بک‌اند روی Supabase Edge Functions

مسیر فعلی و رسمی لانچ بک‌اند (جایگزین مسیر Render در
[`DEPLOY-FREE-STACK.md`](DEPLOY-FREE-STACK.md) — Render برای اکانت جدید کارت
بانکی می‌خواست). فرانت همان Cloudflare Pages می‌ماند؛ دیتابیس و بک‌اند هر دو
داخل **یک پروژه‌ی Supabase** هستند.

---

## 📍 وضعیت فعلی لانچ (به‌روز: ۱۳ مرداد ۱۴۰۵ / 2026-08-04)

> **خلاصه در یک خط:** همه‌چیزِ کد، امنیت، سایت و استقرار تمام است؛ تنها چیزی که
> مانده **دو حساب بیرونی** است که فقط مالک می‌تواند بگیرد (کاوه‌نگار و مرچنت
> واقعی زیبال) به‌علاوه‌ی **یک بار اجرای SQL** در پنل Supabase.

### چه چیزی مانده (به ترتیب اهمیت)

| # | کار | چه کسی | بلاکِ چی است |
|---|---|---|---|
| ۱ | **کاوه‌نگار**: حساب + شارژ + تأیید قالب `verify/lookup` | مالک (بررسی انسانی، چند روز) | 🔴 **کاربر جدید اصلاً نمی‌تواند ثبت‌نام کند** — کد پیامکی ارسال نمی‌شود |
| ۲ | **مرچنت واقعی زیبال** (کد پذیرنده) | مالک (احراز کسب‌وکار) | 🔴 پول به حساب نمی‌رسد؛ قبل از تمام‌شدن ۷ روزِ اولین کاربرها لازم است |
| ۳ | اجرای `supabase/setup.sql` در **SQL Editor** پنل Supabase | مالک | 🟡 سه ایندکس (`devices_refresh`، `otp_recent`، `payments_discount`) روی دیتابیس زنده نیستند. مسئله‌ی درستی نیست، مسئله‌ی مقیاس است: بدون `devices_refresh` هر بار تازه‌سازی توکن کل جدول `devices` اسکن می‌شود. بی‌خطر و قابل اجرای دوباره |
| ۴ | بعد از ۱ و ۲: `supabase secrets unset ALLOW_TEST_PROVIDERS` + redeploy | Claude می‌تواند | 🟡 برگرداندن محافظ‌های پروداکشن |

**چرا Claude نمی‌تواند ۱ و ۲ را انجام دهد؟** چون هر دو یعنی وارد کردن یک کلید/کد
پذیرنده — Claude اجازه‌ی دست‌زدن به این‌جور اعتبارنامه‌ها را ندارد. مالک
`secrets set` را می‌زند، Claude فقط redeploy و تست می‌کند.

### چه چیزی تمام شده ✅

کدِ اپ (عادت/کار/تایمر/ژورنال/آنالیز)، ورود با رمز و با پیامک، ۷ روز آزمایشی
خودکار، مسیر کامل پرداخت، پنل ادمین، ممیزی امنیتی پیش از لانچ، اینماد، متن حقوقی،
سایت معرفی `routino.me`، انتقال اپ به `/app/`، و استقرار هر دو روی
Cloudflare Pages + Supabase Edge.

---

<details>
<summary>جزئیات فنی وضعیت (باز کن اگر لازم شد)</summary>


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
| **`ALLOW_TEST_PROVIDERS`** | **باید `true` باشد** | ⚠️ **تا وقتی دو ردیف بالا تستی‌اند، بدون این تابع بالا نمی‌آید** |

> 🛑 **قبل از دیپلوی بعدی حتماً بخوان.**
> از این به بعد اگر `NODE_ENV=production` باشد، تابع با `ZIBAL_MERCHANT=zibal` (سندباکس) یا `SMS_PROVIDER=console` **بالا نمی‌آید** — مگر با اجازه‌ی صریح. چون سندباکس زیبال از بیرون هیچ تفاوتی ندارد: کاربر درگاه واقعی می‌بیند، «موفق» می‌گیرد، اشتراک واقعی هم می‌گیرد، و پول به حسابت نمی‌رسد.
> وضعیت فعلی (سندباکس عمدی) یعنی **اول این را بزن، بعد دیپلوی کن**:
> ```bash
> supabase secrets set ALLOW_TEST_PROVIDERS=true --project-ref axychfrteevhfdhgvfuv
> ```
> و روزی که مرچنت واقعی + کاوه‌نگار وصل شد، این را **پاک کن** (`supabase secrets unset ALLOW_TEST_PROVIDERS`) تا محافظ برگردد.
> هر بالا آمدن تابع، هرچه تستی باشد را با `[!] TEST MODE — …` در لاگ چاپ می‌کند.

- **پروژه‌ی Supabase:** نام `routino` · ref `axychfrteevhfdhgvfuv` · org `qgvjcextnciiezisegdt` · region eu-north-1.
  حسابِ مالکِ روتینو **جدا** از حسابی است که پروژه‌ی «sheetra» را دارد — برای مدیریت باید با حساب درست `supabase login` کرد.
- **چک‌کردن مقدار secretها بدون دیدن مقدار:** `supabase secrets list` فقط اثرانگشت (sha256) هر مقدار را می‌دهد؛ با محاسبه‌ی `printf "%s" "console" | sha256sum` و مقایسه می‌شود فهمید. جایگزین ساده‌تر: لاگ استارتاپ تابع `[api] edge function up (sms=… psp=…)` را در Dashboard → Edge Functions → api → Logs ببین.

</details>

### دستورهای دقیقِ دو کار بیرونی

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
# و حالا که هم پیامک هم درگاه واقعی شد، محافظ را برگردان:
supabase secrets unset ALLOW_TEST_PROVIDERS --project-ref axychfrteevhfdhgvfuv
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```
بعد از دیپلوی، لاگ تابع **نباید** هیچ خط `[!] TEST MODE` داشته باشد. اگر داشت، یعنی یکی از دو سرویس هنوز تستی است.

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
5. **Worker**: **دستی paste نمی‌شود — از گیت دیپلوی می‌شود.** Worker به اسم
   `routino` به همین ریپو وصل است و با هر push روی `main` خودش دوباره دیپلوی
   می‌کند، طبق `wrangler.toml` **در ریشه‌ی ریپو** (که به
   `cloudflare/api-worker.js` اشاره می‌کند).
   - ⚠️ فایل عمداً در ریشه است، نه داخل `cloudflare/`: بیلد دنبال کانفیگ در
     «root directory» می‌گردد که پیش‌فرضش ریشه‌ی ریپوست. اولین تلاش برای دیپلوی
     گیت‌محور دقیقاً به همین دلیل هیچ کاری نکرد.
   - ⚠️ `name` در `wrangler.toml` باید دقیقاً برابر اسم Worker موجود باشد.
     اگر نباشد، یک Worker **دومِ خالی** ساخته می‌شود، `api.routino.me` روی
     قدیمی می‌ماند، و بیلد «موفق» گزارش می‌دهد در حالی که هیچ‌چیز عوض نشده.
   - `PROXY_SECRET` در داشبورد می‌ماند (Settings → Variables → Secrets)، نه در
     فایل؛ و باید با `PROXY_SECRET` تابع Supabase یکی باشد وگرنه همه‌چیز ۴۰۳.
   - چون از گیت می‌آید، **Worker را در داشبورد ویرایش نکن** — push بعدی
     ویرایشت را بی‌صدا پاک می‌کند.
6. **تست دود**: `https://api.routino.me/health` و `/health/ready` باید
   `{ok:true}` بدهند؛ `https://routino.me` → ورود با شماره → کد را از
   Dashboard → Edge Functions → api → Logs بردار.

## نکته‌ها

- تایمر پاک‌سازی OTP دیگر در پروسه نیست؛ **pg_cron** انجامش می‌دهد
  (`select * from cron.job` برای دیدنش).
- `/health` بدون `PROXY_SECRET` هم باز است (برای مانیتورینگ).
- Cold start تابع ~چند صد میلی‌ثانیه است؛ خواب ۱۵دقیقه‌ای Render را ندارد.
- محدودیت پلن رایگان Supabase: 500K فراخوانی تابع در ماه — برای شروع بسیار کافی.
