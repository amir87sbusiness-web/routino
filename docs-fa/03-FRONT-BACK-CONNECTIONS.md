# 🔗 وابستگی‌های فرانت و بک — هرچی این دو تا رو به هم وصل می‌کنه

> **چرا این فایل مهمه؟** فرانت و بک دو تا برنامه‌ی جدان، ولی سرِ یک سری «قرارداد» با هم توافق کردن. اگه یک طرف رو تغییر بدی و طرف دیگه رو نه، اپ به شکل‌های عجیب خراب می‌شه (مثلاً: یک نفر دو تا حساب می‌شه، یا قیمتِ نمایشی با قیمتِ کشیده‌شده فرق می‌کنه).
> این فایل همه‌ی اون قراردادها رو لیست می‌کنه + قانون «اینو عوض کردی؟ اونم عوض کن».

---

## ۱. تصویر بزرگ — فرانت کِی اصلاً با سرور حرف می‌زنه؟

اپ **آفلاین-اول و cloud-synced** است؛ UI عادت‌ها و کارها و ژورنال را از کپی محلی می‌خواند و تغییرهای قابل‌همگام‌سازی را هنگام اتصال از API ردوبدل می‌کند:

```
📵 بدون اینترنت کار می‌کنه:  عادت‌ها، کارها، تایمر، ژورنال، آنالیز، مرور هفتگی و یادآور محلی
🌐 اینترنت لازم داره:        ورود، خرید/تأیید اشتراک، sync/recovery و پنل ادمین
```

مسیر فیزیکی اتصال:

- **وب (توسعه):** فرانت آدرس `/v1/...` رو صدا می‌زنه ← وایت (`vite.config.ts` بخش `proxy`) می‌فرستدش به `http://localhost:3000`
- **وب (production):** همان `/v1/...` ← Pages Function در `functions/v1/[[path]].js` ← `https://api.routino.me/v1/...`. این مسیر same-origin است و به CORS وابسته نیست.
- **موبایل:** WebView آدرس کامل می‌خواد ← متغیر `VITE_API_URL` موقع `build:mobile` + موتور HTTP نیتیو Capacitor (بدون CORS)
- **مرورگر → سرور مستقیم:** فقط صفحه‌ی callback پرداخت و پنل `/admin`

---

## ۲. جدول کامل تماس‌ها — کی، به کجا، از کجا

| #   | فرانت (کی صدا می‌زنه)                                       | تابع فرانت (`src/lib/api/`)                            | آدرس API                                                                     | بک‌اند (کی جواب می‌ده)                                                              |
| --- | ----------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ۱   | `routes/auth.tsx` — ثبت‌نام یا «فراموشی رمز عبور»           | `auth.ts` ← `requestOtp`                               | `POST /v1/auth/otp/request`                                                  | `backend/src/routes/auth.ts`                                                        |
| ۲   | `routes/auth.tsx` — تایید کد ۴ رقمی و ثبت رمز               | `auth.ts` ← `verifyOtp`                                | `POST /v1/auth/otp/verify`                                                   | `backend/src/routes/auth.ts`                                                        |
| ۲ب  | `routes/auth.tsx` — دکمه «ورود» (پیش‌فرض)                   | `auth.ts` ← `passwordLogin`                            | `POST /v1/auth/password/login`                                               | `backend/src/routes/auth.ts`                                                        |
| ۲ج  | `routes/settings.tsx` — کارت «نام کاربری و رمز عبور»        | `auth.ts` ← `fetchAccount`/`setUsername`/`setPassword` | `GET /v1/auth/account` · `POST /v1/auth/username` · `POST /v1/auth/password` | `backend/src/routes/auth.ts`                                                        |
| ۴   | `routes/settings.tsx` — دکمه «خروج»                         | `auth.ts` ← `logout`                                   | بدون API؛ پاک‌کردن توکن محلی                                                 | نشست سروری یا دستگاه ذخیره نمی‌شود                                                  |
| ۵   | `state/app.tsx` — boot، foreground و تغییرهای محصول         | `sync.ts` ← `exchangeSync`                             | `POST /v1/sync/exchange`                                                     | push و pull را در یک invocation انجام می‌دهد؛ فقط boot وضعیت اشتراک را هم می‌گیرد   |
| ۵ب  | (فقط پنل ادمین/دیباگ)                                       | —                                                      | `GET /v1/subscriptions/grants`                                               | `backend/src/routes/subscriptions.ts` — دفترکل تمدیدهای یک کاربر                    |
| ۵ج  | `routes/activation.tsx` — بعد از آماده‌کردن عادت اول        | `auth.ts` ← `startTrial`                               | `POST /v1/subscriptions/trial/start`                                         | `services/entitlement.ts` — تریال ۷روزهٔ فقط یک‌باره با transaction و قفل ردیف user |
| ۶   | `routes/auth.tsx` — بعد از ورود، اگه اشتراک قدیمی محلی باشه | `auth.ts` ← `importSubscription`                       | `POST /v1/subscriptions/import`                                              | `backend/src/routes/subscriptions.ts`                                               |
| ۷   | `routes/subscribe.tsx` — موقع باز شدن صفحه                  | `payments.ts` ← `fetchPlans`                           | `GET /v1/plans`                                                              | `backend/src/routes/plans.ts`                                                       |
| ۸   | `routes/subscribe.tsx` — دکمه «اعمال» کد تخفیف              | `payments.ts` ← `fetchQuote`                           | `POST /v1/payments/quote`                                                    | `backend/src/routes/payments.ts`                                                    |
| ۹   | `routes/subscribe.tsx` — دکمه «پرداخت»                      | `payments.ts` ← `checkout`                             | `POST /v1/payments/checkout`                                                 | `backend/src/routes/payments.ts`                                                    |
| ۱۰  | `routes/pay.result.tsx` — هر ۲.۵ ثانیه تا مشخص‌شدن نتیجه    | `payments.ts` ← `fetchPayment`                         | `GET /v1/payments/:id`                                                       | `backend/src/routes/payments.ts`                                                    |
| ۱۱  | — (مرورگر، نه اپ) درگاه کاربر رو برمی‌گردونه                | —                                                      | `GET /v1/payments/callback`                                                  | `backend/src/routes/payments.ts`                                                    |
| ۱۲  | — (مرورگر ادمین)                                            | —                                                      | `GET /admin` + `/v1/admin/*`                                                 | `backend/src/routes/admin-panel.ts` و `admin.ts`                                    |

> مسیرهای ۱، ۲، ۲ب، ۷ و ۱۱ عمومی‌اند؛ خروجِ ۴ اصلاً درخواست ندارد. بقیه (از جمله ۲ج: account/username/password) توکن ورود می‌خواهند (هدر `Authorization: Bearer ...`)؛ پنل ادمین شماره و OTP می‌گیرد، سپس با cookie امضاشدهٔ HttpOnly کار می‌کند و درخواست‌های تغییردهنده CSRF می‌خواهند.

---

## ۳. قراردادهای مشترک — «اینو عوض کردی؟ اونم عوض کن» ⚠️

### 📞 قرارداد ۱: استانداردسازی شماره موبایل (حساس‌ترین)

| طرف   | فایل                       |
| ----- | -------------------------- |
| فرانت | `src/lib/phone.ts`         |
| بک    | `backend/src/lib/phone.ts` |

هر دو باید `۰۹۱۲...` و `+98912...` و ارقام فارسی رو به **دقیقاً** یک شکل (`989123334444`) برسونن. چون شماره، کلیدِ یکتای حساب کاربریه — اختلاف یعنی **یک آدم = دو حساب** و دیتاش دو نصف می‌شه.
✅ محافظ خودکار: تست `backend/test/phone.parity.test.ts` — اگه یکی رو تغییر بدی و اون‌یکی رو نه، `npm test` بک‌اند قرمز می‌شه.

### 💰 قرارداد ۲: کاتالوگ پلن‌ها

| طرف                | کجا                                                                | نقش                                                         |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| بک (مرجع اصلی)     | جدول `plans` (نصب اول: `backend/src/db/ddl.ts` ← `SEED_PLANS_SQL`) | قیمتی که واقعاً کشیده می‌شه                                 |
| فرانت (کپی نمایشی) | `src/lib/presets.ts` ← ثابت `PLANS`                                | فقط برای وقتی سرور در دسترس نیست (نمایش آفلاین صفحه اشتراک) |

شناسه‌ها (`m1`، `m3`، `m12`) و قیمت‌ها باید یکی باشن. اگه فقط سرور رو عوض کنی، کاربر آفلاین قیمت قدیمی می‌بینه (خرید امنه چون مبلغ نهایی همیشه سمت سروره — ولی گیج‌کننده‌ست).

### 🗣️ قرارداد ۳: کدهای خطا و ترجمه فارسی‌شون

بک خطا رو این شکلی می‌ده: `{error: "کد", message: "متن انگلیسی"}` (ساخته‌شده در `backend/src/plugins/errors.ts`). فرانت با «کد» تصمیم می‌گیره چه فارسی‌ای نشون بده:

| کد خطا                                                                                    | کجا تولید می‌شه (بک)                                       | کجا ترجمه می‌شه (فرانت)                   | پیام فارسی                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_phone`                                                                           | `routes/auth.ts`                                           | `routes/auth.tsx` ← `explain()`           | «شماره موبایل معتبر وارد کن»                                                                                                             |
| `rate_limited`                                                                            | otp/checkout (+هدر `Retry-After`)                          | `auth.tsx` و `subscribe.tsx`              | «درخواست زیاد بود. X دقیقه دیگه…»                                                                                                        |
| `sms_failed`                                                                              | `routes/auth.ts`                                           | `auth.tsx`                                | «ارسال پیامک ناموفق بود»                                                                                                                 |
| `bad_code`                                                                                | `routes/auth.ts`                                           | `auth.tsx`                                | «کد اشتباهه یا منقضی شده»                                                                                                                |
| `bad_credentials`                                                                         | `routes/auth.ts` (ورود با رمز)                             | `auth.tsx` ← `explain()`                  | «شماره/نام‌کاربری یا رمز عبور اشتباهه» — عمداً برای هر سه حالتِ «حساب نیست/رمز ندارد/رمز غلط» یکسان (ضد شناسایی کاربر)                   |
| `invalid_username` / `username_taken`                                                     | `routes/auth.ts` (تنظیم نام کاربری)                        | `settings.tsx` ← `explain()`              | «نام کاربری نامعتبر» / «قبلاً گرفته شده»                                                                                                 |
| `weak_password` / `wrong_password`                                                        | `routes/auth.ts` (ثبت‌نام/تغییر رمز) + `services/admin.ts` | `auth.tsx` و `settings.tsx` ← `explain()` | «رمز ضعیف است» / «رمز عبور فعلی اشتباهه»                                                                                                 |
| `psp_failed`                                                                              | `routes/payments.ts`                                       | `subscribe.tsx`                           | «درگاه پرداخت در دسترس نیست»                                                                                                             |
| `duplicate_payment_attempt`                                                               | `services/payment-flow.ts`                                 | `subscribe.tsx`                           | «این تلاش قبلاً ثبت شده؛ کمی صبر کن»                                                                                                     |
| `provider_busy` (+هدر `Retry-After` و همان `paymentId`)                                   | `services/payment-flow.ts`                                 | `subscribe.tsx`                           | ظرفیت لحظه‌ای درگاه پر است؛ همان `attemptId` با مکث کوتاه retry می‌شود و پس از reload نیز همان payment منطقی ادامه می‌یابد، نه ردیف تازه |
| `payment_request_unknown`                                                                 | create زرین‌پال با پاسخ timeout/network/malformed          | `subscribe.tsx`                           | درخواست خودکار تکرار نمی‌شود؛ تلاش مبهم برای بررسی باقی می‌ماند                                                                          |
| `not_signed_in`                                                                           | خود فرانت (`api/auth.ts` وقتی توکن نیست)                   | `subscribe.tsx`                           | کارت «ورود با شماره موبایل»                                                                                                              |
| دلایل رد کد تخفیف: `expired` `exhausted` `already_used` `other_user` `inactive` `unknown` | `services/pricing.ts` ← `checkDiscount`                    | `subscribe.tsx` ← `explainReason()`       | «کد منقضی شده» و...                                                                                                                      |

➕ **کد خطای جدید ساختی؟** هم در بک بسازش، هم در `explain()`/`explainReason()` فرانت ترجمه‌ش کن — وگرنه کاربر پیام انگلیسی خام یا «یه مشکلی پیش اومد» می‌بینه.

### 🎫 قرارداد ۴: شکل «وضعیت اشتراک» (Entitlement)

بک برمی‌گردونه: `{status: "active|expired|none", planId, expiresAt, issuedAt}` (ساخته‌شده در `backend/src/services/entitlement.ts`).
فرانت با تابع `entitlementToSubscription` (در `src/lib/api/auth.ts`) تبدیلش می‌کنه به `db.subscription` محلی که گِیت اپ ازش تغذیه می‌شه.
نکته ظریف: هر vault یک فلگ local به نام `legacyEntitlementMigrationResolved` دارد. تا قبل از حل‌شدن، `none` همراه یک اشتراک قدیمیِ فعال باعث import محدود می‌شود؛ اعتبار زمانی legacy با `issuedAt` سرور سنجیده می‌شود و درخواست import به `user.id` همان vault قفل است. فقط خطای موقت شبکه/سرور همان کش را موقتاً نگه می‌دارد؛ پاسخ قطعی یا خطای قطعی 4xx مهاجرت را حل می‌کند و `none` authoritative کش کهنه را پاک می‌کند.

### 💳 قرارداد ۵: چرخه پرداخت و آدرس‌های برگشت

زنجیره‌ی کامل و فایل‌های درگیر:

```
subscribe.tsx (فرانت)
  → POST /payments/checkout با attemptId ثابت برای همان retry
  → خروج از صفحه signal را abort می‌کند؛ پاسخ دیررس CapacitorHttp دیگر به redirect نمی‌رسد
  → بک قیمت trusted را ذخیره و فقط یک create زرین‌پال می‌فرستد
  → کاربر می‌ره به paymentUrl زرین‌پال (fake فقط در تست/توسعه)
  → درگاه برمی‌گردونه به PUBLIC_API_URL/v1/payments/callback
  → بک با lease دیتابیسی، Verify سرور-به-سرور و تطبیق DB را انجام می‌دهد
  → grant unique + entitlement + applied_at در یک transaction ثبت می‌شوند
  → اون صفحه کاربر رو می‌فرسته به:
       وب:      PUBLIC_WEB_URL/pay/result?paymentId=…&status=…
       موبایل:  APP_DEEP_LINK (پیش‌فرض routino://pay/result?paymentId=…&status=…)
  → موبایل: شنونده‌ی دیپ‌لینک در src/client.tsx آدرس رو می‌گیره و می‌بره به صفحه /pay/result
  → pay.result.tsx با GET /payments/:id نتیجه‌ی قطعی رو می‌گیره و اشتراک محلی رو آپدیت می‌کنه
```

**اگه دیپ‌لینک (`routino://`) رو عوض کنی، ۳ جا باید هماهنگ بشن:**

1. env بک‌اند: `APP_DEEP_LINK`
2. فرانت: الگوی `pay/result` در `src/client.tsx`
3. اندروید: intent-filter در `android/app/src/main/AndroidManifest.xml` (و مشابهش در iOS)

**پارامترهای callback** فقط `paymentId` سروری، `Authority` و `Status=OK|NOK` هستند و هر سه untrusted‌اند. مقدار تکراری/آرایه‌ای یا authority ناسازگار پاسخ خنثی می‌گیرد. فقط Verify سرور-به‌سرور با مبلغ DB می‌تواند پرداخت را paid کند؛ در crash بین صدور و ذخیره Authority، bind فقط پس از Verify موفق انجام می‌شود.

### 🌍 قرارداد ۶: آدرس‌ها و CORS

| متغیر                    | کجا                           | باید چی باشه                                                                                                                                               |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`           | فرانت (موقع بیلد موبایل)      | آدرس کامل و عمومی سرور API                                                                                                                                 |
| پروکسی `/v1`             | فرانت — `vite.config.ts`      | آدرس سرور در توسعه (پیش‌فرض `localhost:3000`)                                                                                                              |
| `CORS_ORIGINS`           | بک — env                      | **باید شامل** `https://localhost` (اندروید) و `capacitor://localhost` (iOS) باشه وگرنه اپ موبایل کلاً نمی‌تونه به API وصل شه — رایج‌ترین گیر Capacitor+API |
| `PUBLIC_API_URL`         | بک — env                      | آدرس همین سرور از دید گوشیِ کاربر (درگاه به اینجا redirect می‌کنه — `localhost` روی گوشی معنی نداره!)                                                      |
| `PUBLIC_WEB_URL`         | بک — env                      | آدرس نسخه وب اپ                                                                                                                                            |
| `androidScheme: 'https'` | فرانت — `capacitor.config.ts` | دلیل اینکه origin اندروید `https://localhost` است — اگه عوضش کنی CORS_ORIGINS هم عوض می‌شه                                                                 |

### 🔐 قرارداد ۷: عمر توکن‌ها

| طرف       | کجا                        | مقدار                               |
| --------- | -------------------------- | ----------------------------------- |
| بک (مرجع) | env ← `ACCESS_TTL_SECONDS` | ۲۵۹۲۰۰۰ ثانیه (۳۰ روز)              |
| فرانت     | `src/lib/api/auth.ts`      | زمان واقعی `exp` را از JWT می‌خواند |

احراز هویت stateless است و query سراسری تازه‌ای روی همه درخواست‌ها وجود ندارد. مسیرهای user-dependent وجود user را داخل query فعلی خود می‌سنجند؛ توکن حساب قابل‌پاک‌سازی از موعد مؤثر حذف جلوتر نمی‌رود. خروج فقط توکن محلی را پاک می‌کند و تغییر رمز توکن قبلی را زودتر باطل نمی‌کند.

### 🔒 قرارداد ۸: دیتای شخصی local-first و cloud-synced — ✅ سیاست لانچ

- عادت، لاگ، کار، ژورنال، تایمر و دسته ابتدا در IndexedDB همان مرورگر/WebView ذخیره می‌شوند؛ همهٔ تنظیمات مثل تم، زبان و اعلان فقط روی همان دستگاه در localStorage می‌مانند و هرگز sync نمی‌شوند.
- `state/app.tsx` تغییرهای محصول را ۱۰ ثانیه بعد از آخرین ویرایش batch می‌کند. در hidden/pagehide و رفتن اپ نیتیو به پس‌زمینه، outbox را فوری و best-effort با `keepalive` می‌فرستد؛ boot، ورود تازه و foreground نیز pull می‌کنند، ولی foreground تمیزِ تکراری در فاصلهٔ کمتر از ۱۰ ثانیه درخواست دوم نمی‌سازد. poll دوره‌ای و ping امنیتی وجود ندارد. `POST /v1/sync/exchange` push و pull را در یک invocation انجام می‌دهد و فقط auth می‌خواهد؛ boot همان پاسخ را برای وضعیت اشتراک هم استفاده می‌کند.
- جدول `records` منبع عمومی سرور برای delta sync است؛ cursor، LWW، tombstone و reset watermark جلوی گم‌شدن/زنده‌شدن دوبارهٔ دادهٔ حذف‌شده را می‌گیرند.
- exchange فقط قرارداد `protocolVersion: 2` را می‌پذیرد. فرانت لاگ‌های dirty روزانه را در packet جزئی `habitMonths` می‌فرستد؛ سرور یک ردیف کامل به‌ازای هر عادت-ماه نگه می‌دارد و سلول‌ها را جدا merge می‌کند. پاسخ ماه کامل در فرانت به جدول محلی `logs` باز می‌شود، بنابراین UI/آفلاین/Export همچنان تاریخچهٔ روزانهٔ کامل می‌بینند.
- taskهای تکمیل‌شدهٔ سرد ممکن است داخل DB در `taskMonths` تغییرناپذیر نگه‌داری شوند، اما این kind هرگز از API بیرون نمی‌آید: سرور آن را صفحه‌بندی‌شده و bounded به `tasks` معمولی باز می‌کند و task جدیدترِ همان id روی نسخهٔ archive غلبه می‌کند. بنابراین نمودار سالانه، جست‌وجو، Export، آفلاین و UI هیچ نمایش تازه‌ای نمی‌شناسند و همچنان روی آرایهٔ task فردی محلی کار می‌کنند.
- برای هر صفحهٔ pull فقط یک query مالک+رکورد انجام می‌شود؛ prefix خام حداکثر ۲۵۶ KiB و lookahead فقط یک archive است. این سازوکار فشار DB/Edge را محدود می‌کند ولی اندازه‌گیری fixture هیچ تضمین تعداد کاربر یا پلن provider نیست.
- قرارداد پاسخ exchange شامل `rejectedRecords[{kind,id,updatedAt,code,retryAt?}]` است. سرور payload هر kind را دقیق validate می‌کند ولی متن رکورد ردشده را برنمی‌گرداند؛ فرانت فقط ردیف‌های تسویه‌شدهٔ همان نسخه را clean می‌کند. `account_quota_exceeded` همان نسخه را با `dirty: 2` تا `retryAt` نگه می‌دارد: رشد سالانه تا پایان دوره و سقف ردیف فقط تا retry محدود روزانه؛ این wait state نه داده را پاک می‌کند و نه هر چند ثانیه retry می‌زند. این قرارداد در `backend/src/services/sync-record-validation.ts`، `backend/src/services/sync.ts`، `src/lib/api/sync.ts` و `src/lib/sync/engine.ts` باید با هم تغییر کند.
- بدنهٔ JSON در Fastify و Edge حداکثر ۶۴ KiB است. Edge هم `Content-Length` و هم تعداد واقعی بایت‌های stream را قبل از `JSON.parse` کنترل می‌کند؛ خطای آن `413 payload_too_large` است.
- هر حساب روی این مرورگر یک vault جدا دارد (`src/lib/db/vault.ts`)؛ A→B→A هیچ دیتایی را حذف یا قاطی نمی‌کند.
- Export همیشه فعال است. Import در `src/lib/import-policy.ts` فقط برای اشتراک پولی فعال است و هم قبل از file picker و هم قبل از commit دوباره چک می‌شود.
- قرارداد عمومی فقط شش kind `categories/habits/habitMonths/tasks/timerSessions/journal` دارد؛ جدول `records` علاوه بر آن می‌تواند `taskMonths` داخلی داشته باشد که فقط سرور می‌بیند. هیچ دستگاه یا تنظیماتی روی سرور ذخیره نمی‌شود. PostgREST با RLS بدون policy بسته است و فرانت فقط از Edge API احراز‌شده استفاده می‌کند.
- سقف حساب ۵۰٬۰۰۰ ردیف است و سقف ۱۲۸ MiB مادام‌العمر وجود ندارد. محدودیت write برابر ۱۰ MiB رشد مثبت JSON در هر دورهٔ ۳۶۵روزهٔ خود حساب است؛ دادهٔ پیش از migration grandfathered می‌ماند. فشرده‌سازی taskهای قدیمی job دیتابیس است و هیچ request اضافه از اپ یا Edge تولید نمی‌کند.
- ترتیب production اجباری و دو مرحله‌ای است: backup/dry-run؛ deploy artifact میانی sync fail-closed؛ migrationهای `20260905140000`، `150000`، `160000` و `170000` به همین ترتیب؛ سپس deploy Edge نهایی و canary. full-resync چندصفحه‌ای با `fullResyncGcSeq` فقط خواندنی است، پس outbox تا عبور cursor از watermark ارسال یا تسویه نمی‌شود. rollback بعد از migration فقط برگشت Edge است؛ داده/پرداخت یا schema افزایشی حذف نمی‌شود.
- در schema قدیمی فقط نبودن دقیق `routino_push_records(` writer سازگار را فعال می‌کند؛ وجود ناقص ستون‌های سالانه عمداً ۵۰۰ می‌دهد تا allowance جدید دور زده نشود.

### 🎁 قرارداد ۹: دوره آزمایشی و گِیت اشتراک

- ساخت حساب هیچ دسترسی رایگانی نمی‌دهد. تریال ۷روزه را فقط endpoint صریح `POST /subscriptions/trial/start` و منطق `startTrialOnce` سمت سرور می‌سازد؛ کلاینت نه تاریخ هفت‌روزه می‌سازد و نه فلگ تریال local-only دارد.
- فعال‌سازی فقط وقتی ممکن است که هیچ grant قبلی (trial/payment/migration/admin) و هیچ entitlement materialized وجود نداشته باشد. retry، نصب مجدد و دستگاه دوم همان جواب فعلی را می‌گیرند و زمان اضافه نمی‌شود.
- گِیت اپ با `accessState` از auth، وضعیت نشست، فلگ حل‌شدن migration و کپی محلی entitlement تصمیم می‌گیرد: فقط `none` حل‌شده به `/activation` می‌رود؛ active-trial/active-paid نوشتن دارند؛ expired داخل اپ و sync می‌ماند ولی `AppProvider.update()` محتوای محصول را فقط‌خواندنی می‌کند. `tampered` بدون جواب authoritative حالت تأیید آنلاین است، نه paywall.
- پاسخ entitlement یک `deletionAt` اختیاری دارد. موعد حساب بدون تریال `created_at + 30 days` و حساب trial-only دیرترینِ آن و پایان تریال است؛ فعالیت آن را تمدید نمی‌کند. migration انتشار برای کاربران موجود کف یک‌بارهٔ ۳۰روزه می‌گذارد. فرانت این مقدار را از پاسخ‌های موجود cache می‌کند و فقط در سه روز پایانی هشدار Export/خرید نشان می‌دهد؛ heartbeat، SMS یا endpoint تازه‌ای ندارد.
- retention روی visibility پنل اثر مصنوعی ندارد: `GET /v1/admin/users` و جزئیات کاربر همهٔ ردیف‌های موجود `users`، شامل ثبت‌نام بدون تریال و تریال فعال/منقضی را برمی‌گردانند و grant ادمین همان قرارداد قبلی را دارد. حساب فقط بعد از حذف واقعی دیگر در پنل دیده نمی‌شود.

---

## ۴. سه سناریوی کامل از اول تا آخر (برای فهم عمقی)

### 🔑 سناریو «ورود»

1. کاربر «ثبت‌نام» یا «فراموشی رمز عبور» را می‌زند، شماره می‌نویسد → `auth.tsx` ← `normalizePhone` (فرانت `phone.ts`) → `POST /auth/otp/request`
2. بک: `normalizePhone` (بک `phone.ts` — همون جواب!) → سقف‌ها (`services/otp.ts`) → ساخت کد → پیامک (`providers/sms/*`؛ در توسعه: چاپ در ترمینال بک)
3. کاربر کد ۴ رقمی و رمز جدید را می‌زند → `POST /auth/otp/verify` با `intent` → بک: چک کد → ثبت‌نامِ حساب تازه یا تغییر رمز → JWT سی‌روزه + entitlement (برای حساب تازه: `none`)
4. فرانت: توکن به localStorage (`routino:auth:v1`) → vault همان user باز می‌شود → یک `sync/exchange` اولیه دادهٔ دستگاه‌های دیگر و وضعیت اشتراک را می‌گیرد؛ برای ورود تازه یک pull محدود دیگر پس از ۲ ثانیه انجام می‌شود تا تغییر هم‌زمان دستگاه قبلی سریع برسد

### 💳 سناریو «خرید»

1. `subscribe.tsx`: پلن‌ها از `GET /plans` (نبود سرور = نسخه آفلاین presets)
2. کد تخفیف → `POST /payments/quote` → بک قیمت و دلیل رد/قبول می‌ده
3. «پرداخت» → فرانت برای همان retry یک `attemptId` UUID نگه می‌دارد → بک قیمت را **خودش** حساب می‌کند و Authority زرین‌پال را ذخیره می‌کند → فرانت به `paymentUrl`
4. زرین‌پال ← callback untrusted ← Verify سرور-به‌سرور با مبلغ DB ← grant/entitlement/applied اتمیک و فقط یک‌بار ← صفحه نتیجه ← برگشت به اپ
5. `pay.result.tsx`: استعلام `GET /payments/:id` (که پرداخت‌های گم‌شده رو هم خود-درمانی می‌کنه) → کش محلی اشتراک آپدیت → گِیت باز 🎉

### 📅 سناریو «یه روز عادی بدون اینترنت»

1. اپ باز می‌شه → `hydrate` از IndexedDB (سرور لازم نیست)
2. `state/app.tsx` می‌خواد entitlement تازه کنه → آفلاین → بی‌صدا رد می‌شه → کپی محلی معتبر می‌مونه
3. کاربر عادت تیک می‌زنه/ژورنال می‌نویسه → تغییر فوراً در vault محلی همان حساب ذخیره و `dirty` می‌شود
4. با برگشت اینترنت، engine ابتدا push و بعد pull افزایشی را انجام می‌دهد؛ کار آفلاین منتظر این مرحله نمی‌ماند

---

## ۵. چک‌لیست نهایی «با هم عوض شو» ✅

| اگه اینو تغییر دادی                    | اینا رو هم چک کن                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/lib/phone.ts`                     | `backend/src/lib/phone.ts` + تست parity                                                                               |
| قیمت/پلن در دیتابیس سرور               | `PLANS` در `src/lib/presets.ts`                                                                                       |
| کد خطای جدید در بک                     | `explain()` در `auth.tsx` / `explainReason()` در `subscribe.tsx`                                                      |
| `ACCESS_TTL_SECONDS` (بک)              | تست `src/lib/api/auth-expiry.test.ts` برای parse کردن `exp` و fallback                                                |
| دیپ‌لینک `routino://`                  | `APP_DEEP_LINK` (env بک) + `src/client.tsx` + `AndroidManifest.xml`                                                   |
| آدرس سرور                              | `VITE_API_URL` (بیلد موبایل) + `functions/v1/[[path]].js` (وب) + `CORS_ORIGINS` + `PUBLIC_API_URL` + `PUBLIC_WEB_URL` |
| `androidScheme` در capacitor.config.ts | `CORS_ORIGINS` بک                                                                                                     |
| جدول سینک‌شونده جدید                   | `SYNCED_TABLES` (فرانت) + `SYNC_KINDS` و قید `records_kind_valid` (بک)                                                |
| شکل جواب entitlement                   | `entitlementToSubscription` در `src/lib/api/auth.ts`                                                                  |
| پارامترهای callback پرداخت             | `dev-gateway.ts` (fake باید شکل زرین‌پال را تقلید کند) + `pay.result.tsx`                                             |
