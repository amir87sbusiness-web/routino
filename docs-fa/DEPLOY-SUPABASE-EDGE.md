# انتشار بک‌اند روی Supabase Edge Functions

مسیر فعلی و رسمی لانچ بک‌اند (جایگزین مسیر Render در
[`DEPLOY-FREE-STACK.md`](DEPLOY-FREE-STACK.md) — Render برای اکانت جدید کارت
بانکی می‌خواست). فرانت همان Cloudflare Pages می‌ماند؛ دیتابیس و بک‌اند هر دو
داخل **یک پروژه‌ی Supabase** هستند.

---

## 📍 وضعیت فعلی لانچ (به‌روز: ۳۰ مرداد ۱۴۰۵ / 2026-08-21)

> **خلاصه در یک خط:** سرویس زنده و DB در بررسی خواندنی 21 August پاسخ سالم دادند
> و fingerprint تنظیمات با کاوه‌نگار و زیبال غیر-sandbox تطبیق داشت؛ اما تغییرات
> لانچِ working tree هنوز deploy و SQL جدید هنوز روی production اعمال نشده است.

### چه چیزی مانده (به ترتیب اهمیت)

| #   | کار                                                                              | چه کسی                 | بلاکِ چی است                                                     |
| --- | -------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| ۱   | اجرای `sync:edge`، deploy کد فعلی و اعمال `supabase/setup.sql` تولیدشده           | مالک + Codex           | رساندن قرارداد sync/trial/read-only/reminder فعلی به production |
| ۲   | smoke زندهٔ API، sync دوحساب/دودستگاه و برگشت پرداخت بعد از deploy                | مالک + Codex           | تأیید نسخهٔ تازه، بدون استنتاج از سرویس قدیمی                    |
| ۳   | بارگذاری APK و دادن URL واقعی HTTPS در `ANDROID_DOWNLOAD_URL`                      | مالک                   | فعال‌شدن دکمهٔ دانلود؛ URL حدسی وارد نمی‌شود                     |
| ۴   | نصب APK روی گوشی واقعی و ماتریس اعلان/ورود/export                                 | مالک + Codex           | تأیید سخت‌افزار و delivery؛ این سیستم گوشی/AVD نداشت             |
| ۵   | یک OTP واقعی و یک پرداخت واقعی کنترل‌شده                                          | فقط با تأیید صریح مالک | عمداً در تست خودکار اجرا نمی‌شود                                 |

هر تراکنش واقعی نیازمند اقدام/تأیید مالک است؛ هیچ OTP یا پرداختی برای دورزدن
این مرز استفاده نمی‌شود.

### چه چیزی تمام شده ✅

`routino.me/v1/*` از Pages Function ثابت به API می‌رود. در بررسی خواندنی
21 August، landing، health، DB readiness و plans پاسخ ۲۰۰ داشتند. fingerprint
secretها با `SMS_PROVIDER=kavenegar`، `PSP_PROVIDER=zibal`، مرچنت غیر-sandbox و
نبود `ALLOW_TEST_PROVIDERS` تطبیق داشت؛ مقدار secret نمایش یا تغییر داده نشد.
این شاهد فقط وضعیت سرویس فعلی است و جای deploy/smoke نسخهٔ تازه، OTP واقعی،
پرداخت واقعی یا تست اعلان روی گوشی را نمی‌گیرد. گزارش قرارداد فعلی در
`docs-fa/LAUNCH-READINESS.md` است.

> **NextPay در این تغییر فقط به‌صورت provider جدید آماده شده است.** هیچ deploy،
> اجرای SQL روی production، تنظیم `NEXTPAY_API_KEY` یا پرداخت واقعی انجام نشده؛
> `PSP_PROVIDER` زنده هم عوض نشده است. API key تا وقتی تأیید نشده نباید فعال شود.

---

<details>
<summary>بایگانی وضعیت تاریخی ۴ اوت (برای مرجع؛ وضعیت فعلی نیست)</summary>

> ⚠️ این بخش بایگانی است و نباید برای تصمیم لانچ امروز استفاده شود.

**زیرساخت وب کامل دیپلوی شده و بالاست**، ولی هنوز در **حالت تست** برای پیامک و پرداخت:

| تکه                        | آدرس / مقدار                                  | وضعیت                                                            |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| بک‌اند (Supabase Edge)     | `api.routino.me/health` → `{ok:true}`         | ✅ بالا                                                          |
| دیتابیس                    | `api.routino.me/health/ready` → `db:up`       | ✅ وصل                                                           |
| Cloudflare Worker          | `api.routino.me`                              | ✅ کار می‌کند                                                    |
| سایت اصلی (CF Pages)       | `routino.me` → HTTP 200                       | ✅ بالا                                                          |
| پلن‌ها (از DB)             | `/v1/plans` → m1=۵۹k، m3=۱۴۹k، m12=۴۴۹k تومان | ✅ seed شده                                                      |
| `NODE_ENV` / `DB_DRIVER`   | `production` / `postgres`                     | ✅ درست                                                          |
| **`SMS_PROVIDER`**         | **`console`**                                 | ❌ **پیامک تستی — کاربر واقعی کد ورود نمی‌گیرد**                 |
| **`ZIBAL_MERCHANT`**       | **`zibal`** (سندباکس)                         | ❌ **پول واقعی جابه‌جا نمی‌شود**                                 |
| **`ALLOW_TEST_PROVIDERS`** | **باید `true` باشد**                          | ⚠️ **تا وقتی دو ردیف بالا تستی‌اند، بدون این تابع بالا نمی‌آید** |

> 🛑 **قبل از دیپلوی بعدی حتماً بخوان.**
> از این به بعد اگر `NODE_ENV=production` باشد، تابع با `ZIBAL_MERCHANT=zibal` (سندباکس) یا `SMS_PROVIDER=console` **بالا نمی‌آید** — مگر با اجازه‌ی صریح. چون سندباکس زیبال از بیرون هیچ تفاوتی ندارد: کاربر درگاه واقعی می‌بیند، «موفق» می‌گیرد، اشتراک واقعی هم می‌گیرد، و پول به حسابت نمی‌رسد.
> وضعیت فعلی (سندباکس عمدی) یعنی **اول این را بزن، بعد دیپلوی کن**:
>
> ```bash
> supabase secrets set ALLOW_TEST_PROVIDERS=true --project-ref axychfrteevhfdhgvfuv
> ```
>
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

**۳) فعال‌سازی کنترل‌شدهٔ NextPay — فقط بعد از تأیید API key و اجازهٔ صریح مالک:**

1. با کلید تأییدشده، یک preflight کنترل‌شدهٔ token-only انجام بده تا پذیرش
   `application/x-www-form-urlencoded` توسط API زنده قطعی شود؛ وارد صفحه پرداخت نشو.
2. قبل از SQL، duplicateهای `grants.payment_id` را بررسی کن؛ سپس
   `supabase/setup.sql` تازه را در SQL Editor اجرا کن.
3. `NEXTPAY_API_KEY` را در Supabase Secrets بگذار و فقط برای تست کنترل‌شده
   `PSP_PROVIDER=nextpay` کن؛ مقدار کلید را در فرمان/لاگ مشترک کپی نکن.
4. Edge Function `api` را deploy و health/log را بررسی کن؛ بعد با حساب مالک یک
   پرداخت کم‌مبلغ واقعی انجام بده و در DB تطبیق payment، `provider_ref`، یک grant
   و یک entitlement را ببین.
5. callback و poll را تکرار کن و قطعی کن grant دوم ساخته نمی‌شود؛ اگر هر ابهامی
   بود provider فعلی را برگردان و payment را برای recovery نگه دار، نه terminal حدسی.

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
                                  │
                                  ▼
                    Supabase Postgres (transaction pooler :6543)
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

برای NextPay، همین artifact موجود migration است و سیستم migration جدا ساخته نشده:
`payments.attempt_id`، `payments.provider_ref`، uniqueهای partial روی
`(user_id, attempt_id)` و `(provider, provider_ref)` و unique partial روی
`grants.payment_id`. قبل از ساخت unique آخر، SQL اگر duplicate تاریخی ببیند عمداً
متوقف می‌شود؛ هیچ grant مالی را خودکار حذف یا ادغام نمی‌کند.

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
   | `NEXTPAY_API_KEY`                                   | فقط وقتی بعداً `nextpay` را آگاهانه فعال می‌کنی؛ Secret سمت Edge و بدون مقدار پیش‌فرض. هرگز در فرانت/repository/log قرار نگیرد         |

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
روتینو **آفلاین-اول و cloud-synced** است. عادت‌ها، کارها، تایمر، ژورنال و
تنظیمات ابتدا در IndexedDB روی خود گوشی می‌مانند و سپس از طریق جدول عمومی
`records` به دستگاه‌های همان حساب می‌رسند. وب‌اپ همچنان روی Cloudflare Pages
است، اما دادهٔ syncable برای هر حساب مصرف پایدار Supabase دارد.

عددها حدس نیستند — `supabase/tests/quota.test.ts` مسیر production-like را با
مسیر production-like را روی PGlite اجرا می‌کند، ۴۸ رکورد کوچک syncable برای هر
حساب می‌نویسد و شیب مصرف account/device/subscription/records را اندازه می‌گیرد.

- پاسخ‌های idle API زیر ۴ کیلوبایت نگه داشته می‌شوند؛ pull اولیهٔ تاریخچه می‌تواند بزرگ‌تر باشد و pagination دارد.
- تنگنای واقعی هنوز **تعداد فراخوانی تابع** است. ping امنیتیِ foreground عمداً هر
  ۶۰ ثانیه است تا دستگاه باطل‌شده سریع بیرون برود؛ هر private request دیگر هم همان
  کنترل را انجام می‌دهد.
- final pull sync entitlement را هم برمی‌گرداند. access token پیش‌فرض ۱ ساعت است
  و کلاینت `exp` واقعی آن را می‌خواند.
- `/health`، preflightهای مجاز و ردشده، و HITهای `/v1/plans` در Worker پاسخ داده
  می‌شوند و invocation تابع Supabase مصرف نمی‌کنند. مسیر شخصی هیچ‌وقت cache نمی‌شود.
- اگر استفاده به سقف invocation نزدیک شد، ابتدا فاصلهٔ ping با دادهٔ واقعی مصرف
  بازبینی می‌شود؛ کم‌کردن امنیت پیش از داشتن عدد واقعی مجاز نیست.

**سینک دیتای شخصی در محصول لانچ فعال است.** `/v1/sync/push` و `/v1/sync/pull`
فقط auth-gated هستند، نه subscription-gated. `records` را پاک نکن: tombstoneها
تا GC زمان‌بندی‌شده نگه‌داری می‌شوند و watermark از زنده‌شدن دوبارهٔ حذف‌ها
جلوگیری می‌کند.

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
