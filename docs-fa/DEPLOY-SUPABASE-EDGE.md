# انتشار بک‌اند روی Supabase Edge Functions

مسیر فعلی و رسمی لانچ بک‌اند (جایگزین مسیر Render در
[`DEPLOY-FREE-STACK.md`](DEPLOY-FREE-STACK.md) — Render برای اکانت جدید کارت
بانکی می‌خواست). فرانت همان Cloudflare Pages می‌ماند؛ دیتابیس و بک‌اند هر دو
داخل **یک پروژه‌ی Supabase** هستند.

---

## 📍 وضعیت فعلی لانچ (به‌روز: ۲۷ مرداد ۱۴۰۵ / 2026-08-18)

> **خلاصه در یک خط:** کد `main`، سایت، Pages API proxy، Supabase Edge v44 و API
> Worker جدید زنده‌اند؛ APK امضاشده آمادهٔ بارگذاری است. فقط گذاشتن لینک APK بعد
> از آپلود و smoke روی گوشی واقعی باقی مانده است.

### چه چیزی مانده (به ترتیب اهمیت)

| #   | کار                                                                              | چه کسی                 | بلاکِ چی است                                                     |
| --- | -------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| ۱   | بارگذاری `output/android/routino-android-1.0.apk` روی فضای ابری و دادن URL HTTPS | مالک                   | فعال‌شدن دکمهٔ دانلود اندروید با `ANDROID_DOWNLOAD_URL`          |
| ۲   | نصب APK روی یک گوشی واقعی و smoke ورود/اعلان/export                              | مالک + Codex           | تأیید سخت‌افزار؛ این سیستم device/AVD نداشت                      |
| ۳   | یک OTP واقعی و یک پرداخت واقعی کنترل‌شده                                         | فقط با تأیید صریح مالک | عمداً در تست خودکار اجرا نشد تا کاوه‌نگار یا پول واقعی مصرف نشود |

هر تراکنش واقعی نیازمند اقدام/تأیید مالک است؛ هیچ OTP یا پرداختی برای دورزدن
این مرز استفاده نمی‌شود.

### چه چیزی تمام شده ✅

شاخهٔ `main` شامل commit عملکردی `ad59ec1` روی GitHub و Cloudflare Pages زنده است. `routino.me/v1/*` از Pages
Function ثابت به API می‌رود و smoke زندهٔ landing، deep route، service worker،
plans، ping بدون auth، bad POST و DB readiness پاس شده است. Edge Function `api`
نسخهٔ 44 فعال است. Worker `routino-api` نیز با نسخهٔ
`a8a84906-8245-4ae9-94f1-cd8d8b76d9a5` زنده و با smoke واقعی `LOCAL`،
`MISS`، `HIT` و `BYPASS` تأیید شده است. تست‌های فرانت/Edge/Backend، load محلی،
Android lint و امضای APK پاس شده‌اند؛ نتیجهٔ کامل در
`docs-fa/LAUNCH-READINESS.md` است.

---

<details>
<summary>بایگانی وضعیت تاریخی ۴ اوت (برای مرجع؛ وضعیت فعلی نیست)</summary>

> ⚠️ این بخش بایگانی است و نباید برای تصمیم لانچ امروز استفاده شود.

**زیرساخت وب کامل دیپلوی شده و بالاست**، ولی هنوز در **حالت تست** برای پیامک و پرداخت:

| تکه                        | آدرس / مقدار                                  | وضعیت                                           |
| -------------------------- | --------------------------------------------- | ----------------------------------------------- |
| بک‌اند (Supabase Edge)     | `api.routino.me/health` → `{ok:true}`         | ✅ بالا                                         |
| دیتابیس                    | `api.routino.me/health/ready` → `db:up`       | ✅ وصل                                          |
| Cloudflare Worker          | `api.routino.me`                              | ✅ کار می‌کند                                   |
| سایت اصلی (CF Pages)       | `routino.me` → HTTP 200                       | ✅ بالا                                         |
| پلن‌ها (از DB)             | `/v1/plans` → m1=۵۹k، m3=۱۴۹k، m12=۴۴۹k تومان | ✅ seed شده                                     |
| `NODE_ENV` / `DB_DRIVER`   | `production` / `postgres`                     | ✅ درست                                         |
| **`SMS_PROVIDER`**         | **`kavenegar`**                               | ✅ provider واقعی در لاگ Edge                   |
| **`ZIBAL_MERCHANT`**       | مرچنت واقعی (secret)                          | ✅ تنظیم شده؛ مقدار در repo یا لاگ چاپ نمی‌شود  |
| **رلهٔ ثابت-IP زیبال**     | هنوز باید روی میزبان IPv4 ثابت منتشر شود      | ❌ خطای زندهٔ فعلی `115` تا ثبت IP رله در زیبال |
| **`ALLOW_TEST_PROVIDERS`** | تنظیم نشده                                    | ✅ محافظ production فعال                        |

> 🛑 **قبل از دیپلوی بعدی حتماً بخوان.**
> از این به بعد اگر `NODE_ENV=production` باشد، تابع با `ZIBAL_MERCHANT=zibal` (سندباکس) یا `SMS_PROVIDER=console` **بالا نمی‌آید** — مگر با اجازه‌ی صریح. چون سندباکس زیبال از بیرون هیچ تفاوتی ندارد: کاربر درگاه واقعی می‌بیند، «موفق» می‌گیرد، اشتراک واقعی هم می‌گیرد، و پول به حسابت نمی‌رسد.
> وضعیت فعلی دیگر سندباکس نیست و `ALLOW_TEST_PROVIDERS` هم تنظیم نشده است. بلاکر واقعی پرداخت، پاسخ `115` زیبال است: تماس باید از رلهٔ دارای IPv4 ثابت عبور کند و همان IP در پنل زیبال ثبت شود. هر بالا آمدن تابع، اگر چیزی تستی باشد، همچنان با `[!] TEST MODE — …` در لاگ چاپ می‌شود.

- **پروژه‌ی Supabase:** نام `routino` · ref `axychfrteevhfdhgvfuv` · org `qgvjcextnciiezisegdt` · region eu-north-1.
  حسابِ مالکِ روتینو **جدا** از حسابی است که پروژه‌ی «sheetra» را دارد — برای مدیریت باید با حساب درست `supabase login` کرد.
- **چک‌کردن مقدار secretها بدون دیدن مقدار:** `supabase secrets list` فقط اثرانگشت (sha256) هر مقدار را می‌دهد؛ با محاسبه‌ی `printf "%s" "console" | sha256sum` و مقایسه می‌شود فهمید. جایگزین ساده‌تر: لاگ استارتاپ تابع `[api] edge function up (sms=… psp=…)` را در Dashboard → Edge Functions → api → Logs ببین.

</details>

### دستورهای دقیق سرویس‌های بیرونی

secretها از طریق CLI یا داشبورد تنظیم می‌شوند و بعد تابع redeploy می‌شود. مقدار واقعی secret نباید در repo، لاگ یا گفتگو کپی شود.

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
supabase secrets set \
  ZIBAL_MERCHANT=<کد-پذیرنده-واقعی> \
  ZIBAL_RELAY_URL=https://zibal-relay.routino.me \
  ZIBAL_RELAY_SECRET=<همان-secret-رله> \
  --project-ref axychfrteevhfdhgvfuv
# و حالا که هم پیامک هم درگاه واقعی شد، محافظ را برگردان:
supabase secrets unset ALLOW_TEST_PROVIDERS --project-ref axychfrteevhfdhgvfuv
npx supabase functions deploy api --no-verify-jwt --project-ref axychfrteevhfdhgvfuv
```

قبل از این دستور، `payment-relay/` را روی میزبان دارای IPv4 ثابت اجرا کن، همان IPv4 خروجی را در تنظیمات درگاه روتینو داخل زیبال ثبت کن و `/health` رله را بگیر. Cloudflare Worker و Supabase Edge معمولی IP خروجی ثابت ندارند و نباید IPهای فعلی یا رنج عمومی آن‌ها را در زیبال ثبت کرد. رله در production با merchant آزمایشی `zibal` عمداً بالا نمی‌آید، دیتابیس/cron/polling ندارد و فقط هنگام `request` یا `verify` پرداخت مصرف ایجاد می‌کند.

بعد از دیپلوی، لاگ تابع **نباید** هیچ خط `[!] TEST MODE` داشته باشد. اگر داشت، یعنی یکی از دو سرویس هنوز تستی است.

### تست محلی (تأییدشده کار می‌کند)

`cd backend && npm run dev` (سرور :3000، sms=console → کد در ترمینال، psp=fake) + `npm run dev` (وب :5180، به :3000 پروکسی می‌شود). کل مسیر آنبوردینگ → ورود OTP → اپ اصلی محلی تست و سالم است.

---

## نقشه

```
کاربر ── routino.me ──────────► Cloudflare Pages (وب‌اپ)
مرورگر ─ routino.me/v1/* ─────► Pages Function (`functions/v1/[[path]].js`)
کاربر ── api.routino.me ─────► Cloudflare Worker (cloudflare/api-worker.js)
                                  │  + x-proxy-secret  + x-client-ip
                                  ▼
                    Supabase Edge Function «api» (Deno + Hono)
                         │                 │ فقط request/verify زیبال
                         ▼                 ▼
       Supabase Postgres (pooler :6543)   رلهٔ IPv4 ثابت ──► زیبال
```

- **Worker چرا؟** کاربر ایرانی به لبه‌ی Cloudflare می‌رسد؛ آدرس خام
  `*.supabase.co` هم با `PROXY_SECRET` مسدود است (فقط Worker می‌تواند تابع را
  صدا بزند) و هدر IP کاربر برای سقف‌های پیامکی قابل‌اعتماد می‌شود.
- **Pages Function چرا؟** bundle وب same-origin `/v1` را صدا می‌زند. این Function
  فقط همان namespace را به `api.routino.me` می‌فرستد تا login/اشتراک هیچ‌وقت به
  fallback لندینگ نخورد و CORS هم در مسیر وب دخیل نباشد. بعد از هر deploy،
  `https://routino.me/v1/plans` باید JSON و هدر `x-routino-pages-proxy: 1` بدهد.
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
  می‌کند — در بررسی لانچ ۹۳ تست پاس شد. بک‌اند Node همچنان مرجع توسعه‌ی محلی است
  (`cd backend && npm run dev`) و در همان بررسی ۲۵۳ تست خودش پاس شد.

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

   | کلید                                                | مقدار                                                                                                                                 |
   | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
   | `NODE_ENV`                                          | `production`                                                                                                                          |
   | `DB_DRIVER`                                         | `postgres`                                                                                                                            |
   | `DATABASE_URL`                                      | رشته‌ی **Transaction pooler (پورت 6543)** پروژه                                                                                       |
   | `JWT_SECRET` / `OTP_PEPPER` / `ADMIN_TOKEN`         | رمزهای تصادفی تولیدشده                                                                                                                |
   | `PROXY_SECRET`                                      | همان مقدار Worker                                                                                                                     |
   | `PUBLIC_API_URL`                                    | `https://api.routino.me`                                                                                                              |
   | `PUBLIC_WEB_URL`                                    | `https://routino.me`                                                                                                                  |
   | `CORS_ORIGINS`                                      | `https://routino.me,https://localhost,capacitor://localhost`                                                                          |
   | `OWNER_PHONE` / `OWNER_PASSWORD` / `OWNER_USERNAME` | اختیاری — بوت‌استرپ حساب صاحب اپ برای ورود با رمز از همان بوت اول (بخش «ورود با رمز عبور» بالا)                                       |
   | `SMS_PROVIDER`                                      | فعلاً `console` (کد ورود در لاگ تابع) → بعداً `kavenegar` + `KAVENEGAR_API_KEY` (+ `KAVENEGAR_TEMPLATE` اگر نام قالب ≠ `routino-otp`) |
   | `PSP_PROVIDER`                                      | فعلاً `zibal` با `ZIBAL_MERCHANT=zibal` (سندباکس) → بعداً مرچنت واقعی / `PSP_PROVIDERS=zarinpal,zibal`                                |
   | `ZIBAL_RELAY_URL`                                   | آدرس HTTPS سرویس `payment-relay/` روی میزبان دارای IPv4 ثابت                                                                          |
   | `ZIBAL_RELAY_SECRET`                                | secret حداقل ۳۲ کاراکتری؛ عین مقدار `RELAY_SECRET` روی رله                                                                            |

   > وضعیت فعلیِ همین secretها و دستورهای دقیقِ «واقعی‌کردن» در بخش [«📍 وضعیت فعلی لانچ»](#-وضعیت-فعلی-لانچ-به‌روز-۳-مرداد-۱۴۰۵--2026-07-25) بالای همین فایل است.

4. **دیپلوی تابع**: دستور بالا (`--no-verify-jwt` حیاتی است؛ `config.toml` هم
   `verify_jwt=false` دارد).
5. **Worker**: ⚠️ **push کردن Worker را دیپلوی نمی‌کند. دستور دستی لازم است:**

   ```bash
   npx wrangler deploy --config cloudflare/wrangler.toml
   ```

   **اسم Worker: `routino-api`** — اتصال account-level دامنهٔ
   `api.routino.me` در ۱۸ اوت ۲۰۲۶ مستقیماً روی همین service تأیید شده است. در
   `cloudflare/wrangler.toml` نوشته شده و **نباید خودسرانه تغییر کند**: عوض‌کردن
   اسم آن‌جا Worker را رنیم نمی‌کند، یک Worker **دوم** می‌سازد، دامنه روی کد
   قبلی می‌ماند، و دیپلوی همچنان «موفق» گزارش می‌دهد.

   > 🔴 **این خطا دوبار رخ داده است.** ابتدا `routino` (نام پروژهٔ Pages) و بعد
   > `plain-field-ead8` در فایل قرار داشتند. هر دو deploy موفق گزارش می‌دادند،
   > اما API حساب Cloudflare نشان داد custom domain واقعاً متعلق به
   > `routino-api` است. تست `deployment contract` اکنون نام درست را قفل می‌کند.
   > **درس:** بعد از هر تغییر `cloudflare/api-worker.js`، دیپلوی را با یک
   > چک واقعی تأیید کن، نه با «push شد پس رفت».
   - **اگر می‌خواهی خودکار شود:** داشبورد → آن Worker → Settings → Build →
     اتصال به ریپو با **Root directory = `cloudflare`**. (الان وصل نیست —
     شمارنده‌ی «Workers build mins» صفر است.)
   - `PROXY_SECRET` در داشبورد می‌ماند (Settings → Variables → Secrets)، نه در
     فایل؛ و باید با `PROXY_SECRET` تابع Supabase یکی باشد وگرنه همه‌چیز ۴۰۳.
     `wrangler deploy` سکرت‌های موجود را پاک نمی‌کند.
   - `cloudflare/wrangler.toml` عمداً route/custom-domain ندارد، تا دیپلوی با
     اتصالِ موجودِ `api.routino.me` سر شاخ نشود.

   **تست دودِ Worker بعد از هر دیپلوی** (هر سه باید درست باشند):

   ```bash
   curl -s https://api.routino.me/health                      # {"ok":true,"edge":"cloudflare"}
   curl -sI https://api.routino.me/admin | grep -i content-security-policy   # باید باشد
   for i in 1 2; do curl -sI --compressed https://api.routino.me/v1/plans | grep -i x-routino-cache; done
   # ↑ پاسخ اول MISS و پاسخ دوم HIT است = کش لبه کار می‌کند
   ```

   ⚠️ **خط اول را نشمار.** کش ۵ دقیقه عمر دارد و نوشتنش غیرهمزمان است
   (`waitUntil`)، پس اولین درخواستِ بعد از انقضا همیشه MISS است و تازه دارد کش را
   پر می‌کند. با فقط دو درخواست، تست به‌طور تصادفی «خراب» گزارش می‌دهد در حالی که
   سالم است. ضمناً کش هر دیتاسنترِ Cloudflare جداست، پس شناسه‌ها بین شبکه‌های
   مختلف لزوماً یکی نیستند.

6. **تست دود**: `https://api.routino.me/health` و `/health/ready` باید
   `{ok:true}` بدهند؛ `https://routino.me` → ورود با شماره → کد را از
   Dashboard → Edge Functions → api → Logs بردار.

---

## 💰 سهمیه‌های پلن رایگان — پر می‌شوند یا نه؟

**جواب کوتاه: نه، و با فاصله‌ی خیلی زیاد.** دلیلش معماری است، نه خوش‌شانسی:
روتینو **آفلاین-اول** است. عادت‌ها، کارها، تایمر، ژورنال و آنالیز همه در
IndexedDB روی خود گوشی می‌مانند و **هیچ‌وقت به سرور نمی‌روند**. سرور فقط
می‌داند «این شماره وجود دارد و اشتراکش تا فلان تاریخ است». وب‌اپ هم روی
Cloudflare Pages است، پس یک بایت هم از Supabase خرج نمی‌کند.

عددها حدس نیستند — `supabase/tests/quota.test.ts` مسیر production-like را با
`LEGACY_PERSONAL_SYNC_ENABLED=false` روی Postgres واقعی (PGlite) اجرا می‌کند،
خالی‌ماندن `records` را می‌سنجد و شیب مصرف حساب/دستگاه/اشتراک را اندازه می‌گیرد.

- پاسخ‌های API زیر ۴ کیلوبایت نگه داشته می‌شوند و دیتای شخصی اصلاً وارد egress نمی‌شود.
- تنگنای واقعی هنوز **تعداد فراخوانی تابع** است. ping امنیتیِ foreground عمداً هر
  ۶۰ ثانیه است تا دستگاه باطل‌شده سریع بیرون برود؛ هر private request دیگر هم همان
  کنترل را انجام می‌دهد.
- refresh کامل entitlement در حالت عادی هر ۶ ساعت و در سه روز پایانی هر ۱ ساعت
  است. access token پیش‌فرض ۱ ساعت است و کلاینت `exp` واقعی آن را می‌خواند.
- `/health`، preflightهای مجاز و ردشده، و HITهای `/v1/plans` در Worker پاسخ داده
  می‌شوند و invocation تابع Supabase مصرف نمی‌کنند. مسیر شخصی هیچ‌وقت cache نمی‌شود.
- اگر استفاده به سقف invocation نزدیک شد، ابتدا فاصلهٔ ping با دادهٔ واقعی مصرف
  بازبینی می‌شود؛ کم‌کردن امنیت پیش از داشتن عدد واقعی مجاز نیست.

**سینک دیتای شخصی در محصول لانچ بازنشسته شده است.** جدول `records` فقط برای
پاک‌سازی نسخه‌های قدیمی در schema مانده؛ routeهای sync در production پاسخ 410
می‌دهند و `LEGACY_PERSONAL_SYNC_ENABLED=true` در production جلوی boot را می‌گیرد.
بعد از deploy، قبل از حذف دادهٔ قدیمی تعداد ردیف‌ها را ثبت کن و سپس در یک
تراکنش فقط `records` را خالی کن.

⚠️ **یک نکته‌ی جدا:** پروژه‌ی رایگان Supabase بعد از **۷ روز بی‌ترافیکی pause
می‌شود** و API می‌خوابد. تا قبل از رسیدن کاربر واقعی، همین که هفته‌ای یک بار
`api.routino.me/health` را باز کنی کافی است.

---

## نکته‌ها

- تایمر پاک‌سازی OTP دیگر در پروسه نیست؛ **pg_cron** انجامش می‌دهد
  (`select * from cron.job` برای دیدنش). سه جاب هست: پاک‌سازی ساعتیِ `otp_codes`،
  ساعتیِ `login_attempts`، و هفتگیِ سشن‌های باطل‌شده در `devices`.
- **`/v1/plans` روی Cloudflare کش می‌شود** (۵ دقیقه، در `cloudflare/api-worker.js`).
  وضعیت زنده‌بودن این تغییر را بعد از هر انتشار با `x-routino-cache: HIT` تأیید کن؛
  push گیت به‌تنهایی مدرک انتشار Worker نیست.
  جوابش برای همه یکسان است و از ایران ~۱٫۰۵ ثانیه طول می‌کشید — حالا از لبه‌ی
  Cloudflare جواب می‌گیرد. **یعنی اگر قیمت پلنی را در پنل ادمین عوض کردی، تا
  ۵ دقیقه ممکن است قیمت قبلی را ببینی.** هیچ مسیر دیگری کش نمی‌شود.
- `/health` بدون تماس با Supabase در خود Worker پاسخ داده می‌شود؛ preflightهای CORS
  هم همان‌جا پاسخ/رد می‌شوند.
- Cold start تابع ~چند صد میلی‌ثانیه است؛ خواب ۱۵دقیقه‌ای Render را ندارد.
  (اندازه‌گیری از ایران: cold ~۵٫۹ ثانیه، warm ~۱٫۰ ثانیه. این تأخیر **UI را
  بلاک نمی‌کند** چون گِیت اشتراک روی کش محلی تصمیم می‌گیرد، نه روی جواب سرور.)
