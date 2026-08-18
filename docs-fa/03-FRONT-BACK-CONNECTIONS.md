# 🔗 وابستگی‌های فرانت و بک — هرچی این دو تا رو به هم وصل می‌کنه

> **چرا این فایل مهمه؟** فرانت و بک دو تا برنامه‌ی جدان، ولی سرِ یک سری «قرارداد» با هم توافق کردن. اگه یک طرف رو تغییر بدی و طرف دیگه رو نه، اپ به شکل‌های عجیب خراب می‌شه (مثلاً: یک نفر دو تا حساب می‌شه، یا قیمتِ نمایشی با قیمتِ کشیده‌شده فرق می‌کنه).
> این فایل همه‌ی اون قراردادها رو لیست می‌کنه + قانون «اینو عوض کردی؟ اونم عوض کن».

---

## ۱. تصویر بزرگ — فرانت کِی اصلاً با سرور حرف می‌زنه؟

اپ **آفلاین-اول** است؛ عادت‌ها و کارها و ژورنال هیچ ربطی به سرور ندارن. فقط ۴ موضوع سرور لازم دارن:

```
📵 بدون اینترنت کار می‌کنه:  عادت‌ها ، کارها ، تایمر ، ژورنال ، آنالیز ، تنظیمات
🌐 اینترنت لازم داره:        ورود با پیامک ، خرید اشتراک ، تایید اشتراک ، پنل ادمین
```

مسیر فیزیکی اتصال:
- **وب (توسعه):** فرانت آدرس `/v1/...` رو صدا می‌زنه ← وایت (`vite.config.ts` بخش `proxy`) می‌فرستدش به `http://localhost:3000`
- **وب (production):** همان `/v1/...` ← Pages Function در `functions/v1/[[path]].js` ← `https://api.routino.me/v1/...`. این مسیر same-origin است و به CORS وابسته نیست.
- **موبایل:** WebView آدرس کامل می‌خواد ← متغیر `VITE_API_URL` موقع `build:mobile` + موتور HTTP نیتیو Capacitor (بدون CORS)
- **مرورگر → سرور مستقیم:** فقط صفحه‌ی callback پرداخت و پنل `/admin`

---

## ۲. جدول کامل تماس‌ها — کی، به کجا، از کجا

| # | فرانت (کی صدا می‌زنه) | تابع فرانت (`src/lib/api/`) | آدرس API | بک‌اند (کی جواب می‌ده) |
|---|---|---|---|---|
| ۱ | `routes/auth.tsx` — دکمه «ارسال کد» | `auth.ts` ← `requestOtp` | `POST /v1/auth/otp/request` | `backend/src/routes/auth.ts` |
| ۲ | `routes/auth.tsx` — دکمه «تایید و ورود» | `auth.ts` ← `verifyOtp` | `POST /v1/auth/otp/verify` | `backend/src/routes/auth.ts` |
| ۳ | خودکار — وقتی توکن رو به انقضاست یا ۴۰۱ خورد | `auth.ts` ← `refreshTokens` | `POST /v1/auth/token/refresh` | `backend/src/routes/auth.ts` |
| ۲ب | `routes/auth.tsx` — دکمه «ورود» (پیش‌فرض) | `auth.ts` ← `passwordLogin` | `POST /v1/auth/password/login` | `backend/src/routes/auth.ts` |
| ۲ج | `routes/settings.tsx` — کارت «نام کاربری و رمز عبور» | `auth.ts` ← `fetchAccount`/`setUsername`/`setPassword` | `GET /v1/auth/account` · `POST /v1/auth/username` · `POST /v1/auth/password` | `backend/src/routes/auth.ts` |
| ۴ | `routes/settings.tsx` — دکمه «خروج» | `auth.ts` ← `logout` | `POST /v1/auth/logout` | `backend/src/routes/auth.ts` |
| ۵ | `state/app.tsx` — هر ۶ ساعت؛ در سه روز پایانی هر ۱ ساعت | `auth.ts` ← `fetchEntitlement` | `GET /v1/subscriptions/me` | `backend/src/routes/subscriptions.ts`؛ پرداخت callback‌گم‌شده را هم ترمیم می‌کند |
| ۵الف | `state/app.tsx` — boot/online/foreground و هر دقیقهٔ visible | `devices.ts` ← `pingDevice` | `GET /v1/devices/ping` | فقط اعتبار کاربر/دستگاه؛ پاسخ کوچک `{ok:true}` |
| ۵ب | (فقط پنل ادمین/دیباگ) | — | `GET /v1/subscriptions/grants` | `backend/src/routes/subscriptions.ts` — دفترکل تمدیدهای یک کاربر |
| ۶ | `routes/auth.tsx` — بعد از ورود، اگه اشتراک قدیمی محلی باشه | `auth.ts` ← `importSubscription` | `POST /v1/subscriptions/import` | `backend/src/routes/subscriptions.ts` |
| ۷ | `routes/subscribe.tsx` — موقع باز شدن صفحه | `payments.ts` ← `fetchPlans` | `GET /v1/plans` | `backend/src/routes/plans.ts` |
| ۸ | `routes/subscribe.tsx` — دکمه «اعمال» کد تخفیف | `payments.ts` ← `fetchQuote` | `POST /v1/payments/quote` | `backend/src/routes/payments.ts` |
| ۹ | `routes/subscribe.tsx` — دکمه «پرداخت» | `payments.ts` ← `checkout` | `POST /v1/payments/checkout` | `backend/src/routes/payments.ts` |
| ۱۰ | `routes/pay.result.tsx` — هر ۲.۵ ثانیه تا مشخص‌شدن نتیجه | `payments.ts` ← `fetchPayment` | `GET /v1/payments/:id` | `backend/src/routes/payments.ts` |
| ۱۱ | — (مرورگر، نه اپ) درگاه کاربر رو برمی‌گردونه | — | `GET /v1/payments/callback` | `backend/src/routes/payments.ts` |
| ۱۲ | — (مرورگر ادمین) | — | `GET /admin` + `/v1/admin/*` | `backend/src/routes/admin-panel.ts` و `admin.ts` |

> مسیرهای ۱، ۲، ۲ب، ۳، ۴، ۷، ۱۱ عمومی‌اند؛ بقیه (از جمله ۲ج: account/username/password) توکن ورود می‌خوان (هدر `Authorization: Bearer ...`).

---

## ۳. قراردادهای مشترک — «اینو عوض کردی؟ اونم عوض کن» ⚠️

### 📞 قرارداد ۱: استانداردسازی شماره موبایل (حساس‌ترین)
| طرف | فایل |
|---|---|
| فرانت | `src/lib/phone.ts` |
| بک | `backend/src/lib/phone.ts` |

هر دو باید `۰۹۱۲...` و `+98912...` و ارقام فارسی رو به **دقیقاً** یک شکل (`989123334444`) برسونن. چون شماره، کلیدِ یکتای حساب کاربریه — اختلاف یعنی **یک آدم = دو حساب** و دیتاش دو نصف می‌شه.
✅ محافظ خودکار: تست `backend/test/phone.parity.test.ts` — اگه یکی رو تغییر بدی و اون‌یکی رو نه، `npm test` بک‌اند قرمز می‌شه.

### 💰 قرارداد ۲: کاتالوگ پلن‌ها
| طرف | کجا | نقش |
|---|---|---|
| بک (مرجع اصلی) | جدول `plans` (نصب اول: `backend/src/db/ddl.ts` ← `SEED_PLANS_SQL`) | قیمتی که واقعاً کشیده می‌شه |
| فرانت (کپی نمایشی) | `src/lib/presets.ts` ← ثابت `PLANS` | فقط برای وقتی سرور در دسترس نیست (نمایش آفلاین صفحه اشتراک) |

شناسه‌ها (`m1`، `m3`، `m12`) و قیمت‌ها باید یکی باشن. اگه فقط سرور رو عوض کنی، کاربر آفلاین قیمت قدیمی می‌بینه (خرید امنه چون مبلغ نهایی همیشه سمت سروره — ولی گیج‌کننده‌ست).

### 🗣️ قرارداد ۳: کدهای خطا و ترجمه فارسی‌شون
بک خطا رو این شکلی می‌ده: `{error: "کد", message: "متن انگلیسی"}` (ساخته‌شده در `backend/src/plugins/errors.ts`). فرانت با «کد» تصمیم می‌گیره چه فارسی‌ای نشون بده:

| کد خطا | کجا تولید می‌شه (بک) | کجا ترجمه می‌شه (فرانت) | پیام فارسی |
|---|---|---|---|
| `invalid_phone` | `routes/auth.ts` | `routes/auth.tsx` ← `explain()` | «شماره موبایل معتبر وارد کن» |
| `rate_limited` | otp/checkout (+هدر `Retry-After`) | `auth.tsx` و `subscribe.tsx` | «درخواست زیاد بود. X دقیقه دیگه…» |
| `sms_failed` | `routes/auth.ts` | `auth.tsx` | «ارسال پیامک ناموفق بود» |
| `bad_code` | `routes/auth.ts` | `auth.tsx` | «کد اشتباهه یا منقضی شده» |
| `bad_credentials` | `routes/auth.ts` (ورود با رمز) | `auth.tsx` ← `explain()` | «شماره/نام‌کاربری یا رمز عبور اشتباهه» — عمداً برای هر سه حالتِ «حساب نیست/رمز ندارد/رمز غلط» یکسان (ضد شناسایی کاربر) |
| `invalid_username` / `username_taken` | `routes/auth.ts` (تنظیم نام کاربری) | `settings.tsx` ← `explain()` | «نام کاربری نامعتبر» / «قبلاً گرفته شده» |
| `weak_password` / `wrong_password` | `routes/auth.ts` (تنظیم/تغییر رمز) + `services/admin.ts` | `settings.tsx` ← `explain()` | «رمز ضعیف است» / «رمز عبور فعلی اشتباهه» |
| `blocked` | `routes/auth.ts` / `plugins/auth.ts` | `auth.tsx` | «این حساب مسدود شده» |
| `psp_failed` | `routes/payments.ts` | `subscribe.tsx` | «درگاه پرداخت در دسترس نیست» |
| `not_signed_in` | خود فرانت (`api/auth.ts` وقتی توکن نیست) | `subscribe.tsx` | کارت «ورود با شماره موبایل» |
| دلایل رد کد تخفیف: `expired` `exhausted` `already_used` `other_user` `inactive` `unknown` | `services/pricing.ts` ← `checkDiscount` | `subscribe.tsx` ← `explainReason()` | «کد منقضی شده» و... |

➕ **کد خطای جدید ساختی؟** هم در بک بسازش، هم در `explain()`/`explainReason()` فرانت ترجمه‌ش کن — وگرنه کاربر پیام انگلیسی خام یا «یه مشکلی پیش اومد» می‌بینه.

### 🎫 قرارداد ۴: شکل «وضعیت اشتراک» (Entitlement)
بک برمی‌گردونه: `{status: "active|expired|none", planId, expiresAt, issuedAt}` (ساخته‌شده در `backend/src/services/entitlement.ts`).
فرانت با تابع `entitlementToSubscription` (در `src/lib/api/auth.ts`) تبدیلش می‌کنه به `db.subscription` محلی که گِیت اپ ازش تغذیه می‌شه.
نکته ظریف: جوابِ `none` عمداً روی دیتای محلی نمی‌شینه (که اشتراک قدیمیِ هنوز منتقل‌نشده پاک نشه) — این منطق در `src/state/app.tsx` است.

### 💳 قرارداد ۵: چرخه پرداخت و آدرس‌های برگشت
زنجیره‌ی کامل و فایل‌های درگیر:

```
subscribe.tsx (فرانت)
  → POST /payments/checkout (بک: payments.ts)
  → کاربر می‌ره به paymentUrl (صفحه درگاه زیبال/فیک)
  → درگاه برمی‌گردونه به:  PUBLIC_API_URL/v1/payments/callback?trackId&success&status&orderId
  → بک تایید سرور-به-سرور می‌کنه و صفحه HTML نتیجه می‌سازه (sendResultPage در payments.ts)
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

**پارامترهای callback** بسته به درگاه فرق دارن: زیبال `trackId`, `success`, `status`, `orderId` می‌فرسته (درگاه فیک هم عمداً همین رو تقلید می‌کنه)، زرین‌پال `Authority`, `Status=OK|NOK`. روت `callback` هر دو شکل رو می‌شناسه، پرداخت رو با هر توکنی که اومده پیدا می‌کنه، و بعد بر اساس درگاهِ ذخیره‌شده روی سطر پرداخت (`payments.provider`) تأیید می‌کنه.

### 🌍 قرارداد ۶: آدرس‌ها و CORS
| متغیر | کجا | باید چی باشه |
|---|---|---|
| `VITE_API_URL` | فرانت (موقع بیلد موبایل) | آدرس کامل و عمومی سرور API |
| پروکسی `/v1` | فرانت — `vite.config.ts` | آدرس سرور در توسعه (پیش‌فرض `localhost:3000`) |
| `CORS_ORIGINS` | بک — env | **باید شامل** `https://localhost` (اندروید) و `capacitor://localhost` (iOS) باشه وگرنه اپ موبایل کلاً نمی‌تونه به API وصل شه — رایج‌ترین گیر Capacitor+API |
| `PUBLIC_API_URL` | بک — env | آدرس همین سرور از دید گوشیِ کاربر (درگاه به اینجا redirect می‌کنه — `localhost` روی گوشی معنی نداره!) |
| `PUBLIC_WEB_URL` | بک — env | آدرس نسخه وب اپ |
| `androidScheme: 'https'` | فرانت — `capacitor.config.ts` | دلیل اینکه origin اندروید `https://localhost` است — اگه عوضش کنی CORS_ORIGINS هم عوض می‌شه |

### 🔐 قرارداد ۷: عمر توکن‌ها
| طرف | کجا | مقدار |
|---|---|---|
| بک (مرجع) | env ← `ACCESS_TTL_SECONDS` | ۳۶۰۰ ثانیه (۱ ساعت) |
| فرانت | `src/lib/api/auth.ts` | زمان واقعی `exp` را از JWT می‌خواند و ۱ دقیقه زودتر تمدید می‌کند |

اگر توکن قدیمی/خراب `exp` نداشته باشد، فرانت فقط به‌عنوان fallback یک ساعت فرض می‌کند. هر درخواست خصوصی همچنان وضعیت کاربر و دستگاه را از سرور می‌سنجد؛ در نتیجه revoke منتظر انقضای JWT نمی‌ماند.

### 🔒 قرارداد ۸: دیتای شخصی فقط لوکال — ✅ سیاست لانچ

- عادت، لاگ، کار، ژورنال، تایمر، آنالیز، دسته و تنظیمات شخصی فقط در IndexedDB همان مرورگر/WebView می‌مانند.
- `state/app.tsx` دیگر موتور sync را اجرا نمی‌کند. مسیرهای قدیمی `POST /v1/sync/push` و `GET /v1/sync/pull` در محیط واقعی همیشه `410 sync_disabled` می‌دهند. روشن‌کردن `LEGACY_PERSONAL_SYNC_ENABLED` در production باعث می‌شود سرور اصلاً بالا نیاید.
- جدول `records` فقط برای مهاجرت/پاک‌سازی نصب‌های قدیمی در schema مانده و نباید رکورد تازه بگیرد.
- هر حساب روی این مرورگر یک vault جدا دارد (`src/lib/db/vault.ts`)؛ A→B→A هیچ دیتایی را حذف یا قاطی نمی‌کند.
- Export همیشه فعال است. Import در `src/lib/import-policy.ts` فقط برای اشتراک پولی فعال است و هم قبل از file picker و هم قبل از commit دوباره چک می‌شود.
- سرور فقط داده‌های حساب/ورود، دستگاه و رویداد امنیتی، اشتراک و پرداخت را نگه می‌دارد؛ محتوای شخصی اپ را نه.

### 🎁 قرارداد ۹: دوره آزمایشی و گِیت اشتراک
- تریال ۷ روزه رو **فقط سرور** می‌ده (`TRIAL_DAYS` در `backend/src/routes/auth.ts`، موقع اولین ورود) — کلاینت دیگه حق نداره خودش تریال بسازه.
- ولی گِیت اپ (`subscriptionActive` در `src/lib/logic.ts`) از **کپی محلی** (`db.subscription`) می‌خونه، نه مستقیم از سرور — که آفلاین هم کار کنه. refresh کامل سرور در حالت عادی هر ۶ ساعت و در سه روز پایانی اشتراک هر ۱ ساعت انجام می‌شود؛ ping امنیت دستگاه جدا و سبک است.
- نتیجه: دکمه‌ی تستی فرانت (`TEST_GRANT_BUTTON`) فقط همین کپی محلی رو پر می‌کنه — سرور خبردار نمی‌شه و خرید واقعی باهاش تست نمی‌شه. (`TEST_LOGIN_BUTTON` دیگه وجود نداره.)

---

## ۴. سه سناریوی کامل از اول تا آخر (برای فهم عمقی)

### 🔑 سناریو «ورود»
1. کاربر شماره می‌زنه → `auth.tsx` ← `normalizePhone` (فرانت `phone.ts`) → `POST /auth/otp/request`
2. بک: `normalizePhone` (بک `phone.ts` — همون جواب!) → سقف‌ها (`services/otp.ts`) → ساخت کد → پیامک (`providers/sms/*`؛ در توسعه: چاپ در ترمینال بک)
3. کاربر کد رو می‌زنه → `POST /auth/otp/verify` → بک: چک کد → کاربر جدید؟ ساخت حساب + تریال ۷ روزه → توکن‌ها + entitlement
4. فرانت: توکن‌ها به localStorage (`routino:auth:v1`) → اگه اشتراک قدیمی محلی هست: `POST /subscriptions/import` (یک‌باره) → `db.auth` و `db.subscription` پر می‌شن → گِیت باز → صفحه اصلی

### 💳 سناریو «خرید»
1. `subscribe.tsx`: پلن‌ها از `GET /plans` (نبود سرور = نسخه آفلاین presets)
2. کد تخفیف → `POST /payments/quote` → بک قیمت و دلیل رد/قبول می‌ده
3. «پرداخت» → `POST /payments/checkout` → بک: قیمت رو **خودش دوباره** حساب می‌کنه، سطر payment می‌سازه، از درگاه `trackId` می‌گیره → فرانت کاربر رو می‌فرسته به `paymentUrl`
4. درگاه ← callback بک ← تایید سرور-به-سرور + **تطبیق مبلغ** ← فعال‌سازی با قفل `applied_at` ← صفحه نتیجه ← برگشت به اپ (وب یا دیپ‌لینک)
5. `pay.result.tsx`: استعلام `GET /payments/:id` (که پرداخت‌های گم‌شده رو هم خود-درمانی می‌کنه) → کش محلی اشتراک آپدیت → گِیت باز 🎉

### 📅 سناریو «یه روز عادی بدون اینترنت»
1. اپ باز می‌شه → `hydrate` از IndexedDB (سرور لازم نیست)
2. `state/app.tsx` می‌خواد entitlement تازه کنه → آفلاین → بی‌صدا رد می‌شه → کپی محلی معتبر می‌مونه
3. کاربر عادت تیک می‌زنه/ژورنال می‌نویسه → همه‌چی فقط در vault محلی همان حساب ذخیره می‌شه
4. هیچ فرقی با آنلاین حس نمی‌شه — این خاصیت ساختاریه، نه شانسی

---

## ۵. چک‌لیست نهایی «با هم عوض شو» ✅

| اگه اینو تغییر دادی | اینا رو هم چک کن |
|---|---|
| `src/lib/phone.ts` | `backend/src/lib/phone.ts` + تست parity |
| قیمت/پلن در دیتابیس سرور | `PLANS` در `src/lib/presets.ts` |
| کد خطای جدید در بک | `explain()` در `auth.tsx` / `explainReason()` در `subscribe.tsx` |
| `ACCESS_TTL_SECONDS` (بک) | تست `src/lib/api/auth-expiry.test.ts` برای parse کردن `exp` و fallback |
| دیپ‌لینک `routino://` | `APP_DEEP_LINK` (env بک) + `src/client.tsx` + `AndroidManifest.xml` |
| آدرس سرور | `VITE_API_URL` (بیلد موبایل) + `functions/v1/[[path]].js` (وب) + `CORS_ORIGINS` + `PUBLIC_API_URL` + `PUBLIC_WEB_URL` |
| `androidScheme` در capacitor.config.ts | `CORS_ORIGINS` بک |
| جدول سینک‌شونده جدید | `SYNCED_TABLES` (فرانت) + `SYNC_KINDS` و قید `records_kind_valid` (بک) |
| شکل جواب entitlement | `entitlementToSubscription` در `src/lib/api/auth.ts` |
| پارامترهای callback پرداخت | `dev-gateway.ts` (درگاه فیک باید همچنان زیبال رو تقلید کنه) + `pay.result.tsx` |
