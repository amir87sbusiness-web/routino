# 🗺️ راهنمای کامل کد روتینو (Routino Codebase Guide)

> **این فایل برای چیه؟**
> ۱) برای خودت: بدون بلد بودن برنامه‌نویسی بفهمی هر بخش اپ کجاست و برای تغییر هر چیزی باید سراغ کدوم فایل بری.
> ۲) برای Claude (هوش مصنوعی): در جلسات بعدی به‌جای خوندن کل کد، اول این فایل رو بخونه تا توکن کمتری مصرف بشه.
>
> آخرین به‌روزرسانی: تیر ۱۴۰۵ (July 2026) — اگه کد رو خیلی تغییر دادی، از Claude بخواه این فایل رو هم آپدیت کنه.

---

## ۱. روتینو در یک نگاه

**روتینو** یه اپ عادت‌ساز (Habit Tracker) دوزبانه (فارسی/انگلیسی) با تقویم شمسی و میلادیه که این بخش‌ها رو داره:

- **امروز**: عادت‌های امروز + کارهای امروز + نمره روز
- **عادت‌ها**: ساخت/ویرایش عادت، دسته‌بندی‌ها، عادت‌های آماده (پیشنهادی)، نشان‌ها (Badge)
- **کارها (Tasks)**: کارهای روزانه با یادآوری
- **تایمر**: پومودورو / تایمر آزاد / کرونومتر — قابل اتصال به عادت‌های زمانی
- **ژورنال**: نوشته روزانه + نمره ۱ تا ۱۰ + حس‌وحال (ایموجی)
- **آنالیز**: نمودارها و مقایسه هفته‌ها
- **ورود با پیامک (OTP)** و **اشتراک پولی** (درگاه زیبال)

**سه شکل اجرا می‌شه:**
| شکل | چطوری |
|---|---|
| وب (PWA) | خروجی پوشه `dist/` — قابل نصب از مرورگر |
| اندروید | با Capacitor — خروجی وب داخل پوشه `www/` می‌ره و اپ اندروید از پوشه `android/` ساخته می‌شه |
| iOS | همون روش، از پوشه `ios/` |

**تکنولوژی‌ها (فقط برای اطلاع):** React + TypeScript + Vite + Tailwind (فرانت) · Fastify + Postgres/PGlite + Drizzle (بک‌اند) · Capacitor (موبایل)

---

## ۲. نقشه کلی پوشه‌ها

```
routino1.0/
├── src/                  ← 🎨 کل فرانت‌اند (چیزی که کاربر می‌بینه)
│   ├── routes/           ← صفحه‌های اپ (هر فایل = یک صفحه)
│   ├── components/       ← قطعه‌های تکرارشونده UI (کارت عادت، فرم‌ها، ...)
│   ├── lib/              ← منطق و محاسبات (بدون ظاهر)
│   │   ├── db/           ← ذخیره‌سازی محلی (دیتابیس داخل گوشی/مرورگر)
│   │   └── api/          ← ارتباط با سرور
│   └── state/            ← مغز اپ (نگهداری وضعیت کلی)
├── backend/              ← 🖥️ کل بک‌اند (سرور: ورود، اشتراک، پرداخت)
│   └── src/
│       ├── routes/       ← آدرس‌های API (مثل /v1/auth/...)
│       ├── services/     ← منطق اصلی (قیمت، اشتراک، کد پیامکی، توکن)
│       ├── providers/    ← اتصال به سرویس‌های بیرونی (پیامک کاوه‌نگار، درگاه زیبال)
│       ├── db/           ← ساختار جدول‌های دیتابیس سرور
│       └── plugins/      ← احراز هویت و مدیریت خطا
├── android/  ios/        ← پروژه‌های نیتیو موبایل (معمولاً دست نمی‌زنی)
├── public/               ← آیکون‌ها و مانیفست PWA
├── www/  dist/           ← خروجی‌های بیلد (تولید خودکار — ویرایش نکن)
├── vite.config.ts        ← تنظیمات بیلد فرانت + PWA
├── capacitor.config.ts   ← تنظیمات اپ موبایل (نام اپ، appId)
└── package.json          ← لیست دستورها و کتابخانه‌ها
```

---

## ۳. جریان کار اپ (خیلی مهم برای فهمیدن بقیه)

وقتی کاربر اپ رو باز می‌کنه، فایل [AppShell.tsx](../src/components/AppShell.tsx) به این ترتیب چک می‌کنه (بهش می‌گیم **گِیت**):

```
۱. آنبوردینگ دیده؟ نه → صفحه /onboarding
۲. وارد شده (شماره موبایل)؟ نه → صفحه /auth
۳. اشتراک فعال داره؟ نه → صفحه /subscribe
۴. همه اوکی → اپ اصلی (صفحه امروز)
```

**دیتا کجا ذخیره می‌شه؟** (اپ «آفلاین-اول» است؛ یعنی بدون اینترنت کامل کار می‌کنه)

- همه‌ی عادت‌ها/کارها/ژورنال/تنظیمات → **IndexedDB** داخل خود دستگاه (فایل‌های `src/lib/db/`)
- چیزهای مخصوص همین دستگاه (تم، اعلان‌ها، وضعیت ورود، اشتراکِ کش‌شده) → **localStorage**
- سرور فقط برای: ورود با پیامک، خرید اشتراک، و تایید اشتراک. اگه اینترنت نباشه اپ با همون اطلاعات محلی کار می‌کنه.

**مسیر تغییر دیتا:** هر صفحه‌ای که چیزی رو تغییر می‌ده تابع `update()` رو صدا می‌زنه (تعریفش در `src/state/app.tsx`) → تغییرها خودکار تشخیص داده می‌شن (`diff.ts`) → فقط همون رکوردهای تغییرکرده در IndexedDB ذخیره می‌شن (`persist.ts`).

---

## ۴. فرانت‌اند — فایل به فایل

### 🚪 نقطه شروع

| فایل | چیکار می‌کنه | چی رو اینجا عوض کنی |
|---|---|---|
| [index.html](../index.html) | صفحه پایه HTML | عنوان تب مرورگر، فونت |
| [src/client.tsx](../src/client.tsx) | روشن‌کردن اپ + مدیریت دیپ‌لینک بازگشت از درگاه پرداخت | معمولاً دست نمی‌زنی |
| [src/routes/__root.tsx](../src/routes/__root.tsx) | قالب سراسری: صفحه ۴۰۴، صفحه خطا، اعلان «نسخه جدید» | متن صفحه ۴۰۴ و خطا |
| [src/styles.css](../src/styles.css) | 🎨 همه رنگ‌ها و استایل سراسری (تم روشن/تیره، رنگ برند پیش‌فرض) | رنگ اصلی اپ، رنگ‌های حالت تیره، گردی گوشه‌ها، فونت |

### 🧠 مغز اپ

| فایل | چیکار می‌کنه | چی رو اینجا عوض کنی |
|---|---|---|
| [src/state/app.tsx](../src/state/app.tsx) | **مهم‌ترین فایل فرانت.** نگهداری کل وضعیت اپ (`db`)، تابع `update()`، اعمال تم/زبان/رنگ برند، یادآورها (هر ۳۰ ثانیه چک می‌کنه)، ضد دستکاری ساعت (tamper)، تازه‌سازی اشتراک از سرور | متن اعلان‌های یادآوری، منطق یادآور، تحمل دستکاری ساعت (`TAMPER_TOLERANCE`) |
| [src/lib/store.ts](../src/lib/store.ts) | تعریف «شکل» همه‌ی داده‌ها (عادت چه فیلدهایی داره، کار چیه، ...) + مقدارهای پیش‌فرض تنظیمات | مقدار پیش‌فرض تنظیمات کاربر جدید (زبان، تقویم، ساعت یادآور ژورنال `22:00`) |
| [src/lib/logic.ts](../src/lib/logic.ts) | **همه‌ی محاسبات**: کدوم روز عادت فعاله، درصد انجام، استریک 🔥، پیشرفت ماهانه، نشان‌ها، نمره روز، و `subscriptionActive` (چک فعال بودن اشتراک) | فرمول نمره‌دهی، منطق استریک، شرط گرفتن نشان |
| [src/lib/dates.ts](../src/lib/dates.ts) | تبدیل شمسی↔میلادی، نام ماه‌ها و روزها، عددهای فارسی (۱۲۳)، فرمت تاریخ | اسم ماه‌ها/روزها، فرمت نمایش تاریخ |
| [src/lib/presets.ts](../src/lib/presets.ts) | 📋 **دسته‌بندی‌های پیش‌فرض** (۱۶ تا) + **عادت‌های آماده** هر دسته + قیمت پلن‌ها (نسخه آفلاین) + ایموجی‌های حس‌وحال + پالت رنگ‌ها | اضافه/کم کردن دسته یا عادت آماده، تغییر ایموجی‌ها، رنگ‌های قابل انتخاب |
| [src/lib/chart.ts](../src/lib/chart.ts) | تبدیل داده‌های روزانه به ستون‌های نمودار (هفته/ماه/سه‌ماهه/سال) | نحوه دسته‌بندی ستون‌های نمودار |
| [src/lib/phone.ts](../src/lib/phone.ts) | ⚠️ استانداردسازی شماره موبایل (09... → 989...). **باید دقیقاً با نسخه بک‌اند یکی باشه** ([backend/src/lib/phone.ts](../backend/src/lib/phone.ts)) | تقریباً هیچ‌وقت — اگه تغییر دادی هر دو نسخه رو با هم عوض کن |
| [src/lib/backup.ts](../src/lib/backup.ts) | پشتیبان‌گیری و بازیابی کامل دیتا (Export/Import فایل JSON در «تنظیمات») | `parseBackup` اعتبارسنجی + `restoreDb` جایگزینی دیتا با حفظ هویت دستگاه |
| [src/lib/pwa.ts](../src/lib/pwa.ts) | نصب PWA، سرویس‌ورکر، درخواست ذخیره‌سازی پایدار | معمولاً دست نمی‌زنی |
| [src/lib/native.ts](../src/lib/native.ts) | هماهنگی نوار وضعیت اندروید/iOS با تم | معمولاً دست نمی‌زنی |
| [src/lib/native-notifications.ts](../src/lib/native-notifications.ts) | نوتیفیکیشن‌های سیستم‌عاملی موبایل (وقتی اپ بسته‌ست هم کار می‌کنن) | متن نوتیف‌های عادت/ژورنال/کار در موبایل |
| [src/lib/wipe.ts](../src/lib/wipe.ts) | جداسازی دیتا موقع تعویض شماره ورود (`loginAs`, `wipeContent`) — صدا زده می‌شه از `auth.tsx` | معمولاً دست نمی‌زنی |
| [src/lib/seed-demo.ts](../src/lib/seed-demo.ts) | دکمه‌ی «دیتای نمایشی» در تنظیمات — یک سال دیتای ساختگی می‌سازه برای دمو/تست (`applyDemoContent`) | فقط برای دمو، تو نسخه‌ی واقعی کاربر لازم نیست |
| [src/lib/backup-native.ts](../src/lib/backup-native.ts) | خروجی فایل پشتیبان روی موبایل (share sheet کپسیتور، چون دانلود مستقیم مرورگر اونجا کار نمی‌کنه) | معمولاً دست نمی‌زنی |
| [src/lib/utils.ts](../src/lib/utils.ts) | تابع کمکی `cn` (ترکیب کلاس‌های Tailwind) | معمولاً دست نمی‌زنی |

### 💾 ذخیره‌سازی محلی (`src/lib/db/`) — ⚠️ منطقه حساس

این ۶ فایل با هم دیتابیس داخل دستگاه رو می‌سازن. **بدون دلیل خیلی خوب تغییرشون نده** — باگ اینجا یعنی از دست رفتن دیتای کاربر.

| فایل | نقش |
|---|---|
| [dexie.ts](../src/lib/db/dexie.ts) | تعریف جدول‌های IndexedDB (categories, habits, logs, tasks, timerSessions, journal, settings, feedback) |
| [local.ts](../src/lib/db/local.ts) | چیزهایی که فقط مال همین دستگاهه (تم، اعلان‌ها، ورود، اشتراک کش‌شده). لیست `SYNCED_SETTING_KEYS` می‌گه کدوم تنظیمات بین دستگاه‌ها مشترک می‌شن |
| [hydrate.ts](../src/lib/db/hydrate.ts) | موقع باز شدن اپ، دیتا رو از دیسک می‌خونه و می‌سازه. دسته‌های پیش‌فرض رو برای کاربر جدید می‌کاره |
| [diff.ts](../src/lib/db/diff.ts) | تشخیص اینکه بعد از هر تغییر، دقیقاً چی عوض شده (حیاتی‌ترین فایل ذخیره‌سازی) |
| [persist.ts](../src/lib/db/persist.ts) | نوشتن تغییرها روی دیسک (در پس‌زمینه، بدون معطلی UI) |
| [migrate.ts](../src/lib/db/migrate.ts) | انتقال یک‌باره دیتای نسخه‌های قدیمی (localStorage قدیمی → IndexedDB) |

### 🌐 ارتباط با سرور (`src/lib/api/`)

| فایل | نقش | چی رو اینجا عوض کنی |
|---|---|---|
| [client.ts](../src/lib/api/client.ts) | ارسال درخواست‌ها به سرور. آدرس سرور از متغیر `VITE_API_URL` میاد (روی وب: `/v1` که به لوکال پروکسی می‌شه) | آدرس سرور برای بیلد موبایل (متغیر محیطی `VITE_API_URL`) |
| [auth.ts](../src/lib/api/auth.ts) | ذخیره توکن‌های ورود، تمدید خودکار توکن، خروج | مدت‌زمان فرضی توکن (`ASSUMED_ACCESS_TTL_MS`) |
| [payments.ts](../src/lib/api/payments.ts) | گرفتن پلن‌ها، استعلام قیمت، شروع خرید، وضعیت پرداخت | معمولاً دست نمی‌زنی |

### 📱 صفحه‌های اپ (`src/routes/`) — هر فایل = یک صفحه

| فایل | صفحه | نکته‌های تغییر |
|---|---|---|
| [index.tsx](../src/routes/index.tsx) | **امروز** (صفحه اصلی): سلام صبح/ظهر/عصر بخیر، حلقه درصد روز، نوار هفته، کارها، عادت‌های امروز | متن سلام‌ها، چیدمان صفحه اصلی |
| [habits.tsx](../src/routes/habits.tsx) | **عادت‌ها**: دکمه عادت آماده/دلخواه، فیلترها، کارت هر عادت (پیشرفت ماه + استریک)، نشان‌ها، ساخت دسته جدید، حذف عادت | متن‌ها، رفتار فیلترها |
| [habit.$habitId.tsx](../src/routes/habit.$habitId.tsx) | **جزئیات یک عادت**: استریک، درصد موفقیت، هدف ماهانه، نمودار روند، یادداشت‌های اخیر | کارت‌های آمار |
| [tasks.tsx](../src/routes/tasks.tsx) | **کارها**: انتخاب روز (امروز/فردا/دلخواه)، افزودن سریع، فرم پیشرفته (آیکون/رنگ/یادآور) | رنگ و آیکون پیش‌فرض کار جدید (`TASK_DEFAULT_COLOR`) |
| [timer.tsx](../src/routes/timer.tsx) | **تایمر**: پومودورو (پیش‌فرض ۲۵/۵)، تایمر آزاد، کرونومتر، اتصال به عادت زمانی، تاریخچه جلسات | زمان‌های پیش‌فرض (`POMODORO_PRESETS`، `FREE_PRESETS`)، سقف تاریخچه (۲۰۰) |
| [journal.tsx](../src/routes/journal.tsx) | **ژورنال**: ایموجی حس، نمره ۱-۱۰، متن، تاریخچه ۱۴ روز | تعداد روزهای تاریخچه، متن placeholder |
| [analytics.tsx](../src/routes/analytics.tsx) | **آنالیز**: این‌هفته/هفته‌قبل، نمودار کلی، شبکه تقویمی هر عادت، لیست کارهای انجام‌شده/نشده | بازه‌های نمودار (`RANGES`) |
| [settings.tsx](../src/routes/settings.tsx) | **تنظیمات**: حساب، زبان، تقویم، تم، رنگ برند (۸ رنگ + چرخ رنگ)، مدیریت دسته‌ها، نوتیف، ساعت ژورنال، خروج | لیست رنگ‌های برند (`BRAND_COLORS`)، چیدمان تنظیمات |
| [onboarding.tsx](../src/routes/onboarding.tsx) | **خوش‌آمدگویی**: ۳ اسلاید معرفی + تنظیمات اولیه | متن و ایموجی اسلایدها (آرایه `slides`) |
| [auth.tsx](../src/routes/auth.tsx) | **ورود**: پیش‌فرض **رمز عبور** (شماره موبایل یا نام کاربری + رمز)؛ لینک «ورود با کد پیامکی» به‌عنوان جایگزین (بار اول/فراموشی رمز). اشتراک قدیمی محلی رو هم به سرور منتقل می‌کنه | ⚠️ `SKIP_SMS` (بخش ۷)، متن خطاها، ترتیب دو روش ورود |
| [subscribe.tsx](../src/routes/subscribe.tsx) | **دیوار اشتراک**: لیست پلن‌ها (از سرور، با نسخه آفلاین پشتیبان)، کد تخفیف، دکمه پرداخت | ⚠️ `TEST_GRANT_BUTTON` (بخش ۷)، متن‌های صفحه خرید |
| [pay.result.tsx](../src/routes/pay.result.tsx) | **نتیجه پرداخت**: بعد از برگشت از درگاه، وضعیت رو از سرور می‌پرسه (تا ۱ دقیقه تلاش می‌کنه) | متن‌های موفق/لغو/ناموفق |

### 🧩 قطعه‌های UI (`src/components/`)

| فایل | نقش | چی رو اینجا عوض کنی |
|---|---|---|
| [AppShell.tsx](../src/components/AppShell.tsx) | **قاب اصلی اپ**: گِیت (بخش ۳)، منوی پایین موبایل / سایدبار دسکتاپ، زنگوله اعلان‌ها، پاپ‌آپ نظرسنجی (هر ۵ جلسه) | آیتم‌های منو (`NAV`)، فاصله نظرسنجی، اسپلش |
| [habits.tsx](../src/components/habits.tsx) | ردیف عادت (سوایپ برای انجام ✓)، فرم ساخت/ویرایش عادت، پاپ‌آپ جشن 🎉 (۷۰٪ و ۱۰۰٪ هدف ماهانه)، شبکه تقویمی ماه | آستانه سوایپ، درصدهای جشن (`[70, 100]`)، پیش‌فرض فرم عادت (`emptyDraft`: هدف ماهانه ۳۰ روز) |
| [tasks.tsx](../src/components/tasks.tsx) | ردیف کار (سوایپ)، کارت «کارهای امروز»، افزودن سریع | ظاهر ردیف کار |
| [WeekStrip.tsx](../src/components/WeekStrip.tsx) | نوار ۷ روز هفته بالای صفحه‌ها (با حلقه درصد دور هر روز) | ظاهر نوار هفته |
| [pwa.tsx](../src/components/pwa.tsx) | بنر «روتینو رو نصب کن» + اعلان «نسخه جدید آماده‌ست» + راهنمای نصب iOS | متن بنر نصب |
| [ui.tsx](../src/components/ui.tsx) | جعبه‌ابزار UI: دکمه، اینپوت، کارت، مودال، چیپ، نوار پیشرفت، انتخاب‌گر ساعت/تاریخ/مدت، نمودار میله‌ای (`MiniBars`)، چرخ رنگ، **لیست آیکون‌های دسته‌ها (`CATEGORY_ICONS`)**، لوگو | اضافه‌کردن آیکون جدید به دسته‌ها، شکل دکمه‌ها و مودال‌ها، لوگو |
| ~~`ui/` (پوشه)~~ | حذف شد — shadcn بلااستفاده بود؛ اپ از `ui.tsx` استفاده می‌کنه | — |

---

## ۵. بک‌اند — فایل به فایل

بک‌اند یه سرور جداست (پوشه `backend/`) که ۴ کار اصلی می‌کنه: **ورود با پیامک**، **اشتراک**، **پرداخت**، **پنل ادمین**.

### شروع و تنظیمات

| فایل | نقش | چی رو اینجا عوض کنی |
|---|---|---|
| [index.ts](../backend/src/index.ts) | نقطه شروع سرور: انتخاب دیتابیس (PGlite برای توسعه / Postgres واقعی)، انتخاب پیامک (کنسول/کاوه‌نگار) و درگاه (فیک/زیبال) — **همه با متغیر محیطی، نه تغییر کد** | معمولاً دست نمی‌زنی |
| [env.ts](../backend/src/env.ts) | 📌 **لیست همه متغیرهای محیطی** + مقدارهای پیش‌فرض: پورت، `SMS_PROVIDER`، `PSP_PROVIDER`، `ADMIN_TOKEN`، `JWT_SECRET`، مدت کد OTP (۱۲۰ ثانیه)، `CORS_ORIGINS`، آدرس‌های عمومی و... | مقدارهای پیش‌فرض؛ در پروداکشن حتماً از env واقعی |
| [app.ts](../backend/src/app.ts) | سرهم‌کردن سرور: CORS، فشرده‌سازی، ثبت همه مسیرها | اضافه‌کردن مسیر (route) جدید |
| [db/schema.ts](../backend/src/db/schema.ts) | ساختار جدول‌های دیتابیس سرور: `users`، `records` (دیتای سینک)، `devices`، `otp_codes`، `plans`، `discounts`، `redemptions`، `payments`، `grants` (دفترکل اشتراک)، `entitlements`، `feedback` | فیلد جدید به جدول‌ها (با احتیاط + مهاجرت) |
| [db/ddl.ts](../backend/src/db/ddl.ts) | SQL ساخت جدول‌ها + 💰 **قیمت اولیه پلن‌ها** (`SEED_PLANS_SQL`: m1=۵۹هزار، m3=۱۴۹هزار، m12=۴۴۹هزار تومان) + کد تخفیف تستی ROUTINO20 | قیمت پلن‌های جدید (⚠️ فقط برای نصب اول — بعدش باید مستقیم در دیتابیس/پنل عوض بشه) |
| [db/client.ts](../backend/src/db/client.ts) | تایپ دیتابیس (سازگاری Postgres و PGlite) | دست نزن |

### مسیرهای API (`backend/src/routes/`)

| فایل | آدرس‌ها | نقش |
|---|---|---|
| [auth.ts](../backend/src/routes/auth.ts) | `/v1/auth/otp/request` `/verify` · **`/password/login`** · **`/account` (GET)** · **`/username`** · **`/password`** · `/token/refresh` `/logout` | ورود با پیامک **و ورود با رمز** (شماره/نام‌کاربری). تنظیم نام کاربری و رمز از تنظیمات (نیازمند توکن). هش رمز = scrypt در [services/password.ts](../backend/src/services/password.ts)؛ سقف تلاش‌ها در [services/login-throttle.ts](../backend/src/services/login-throttle.ts). **کاربر جدید = ۷ روز رایگان** (`TRIAL_DAYS`) |
| [payments.ts](../backend/src/routes/payments.ts) | `/v1/payments/quote` `/checkout` `/callback` `/:id` | 💰 **مسیر پول** — قیمت فقط سمت سرور حساب می‌شه، مبلغ تاییدشده درگاه با مبلغ ما مقایسه می‌شه، گرنت دوباره ساختاراً غیرممکنه (`applied_at`). صفحه HTML نتیجه پرداخت هم همین‌جاست (`sendResultPage`) |
| [subscriptions.ts](../backend/src/routes/subscriptions.ts) | `/v1/subscriptions/me` `/import` `/grants` | وضعیت اشتراک + انتقال یک‌باره اشتراک قدیمی محلی (محدود به `IMPORT_MAX_DAYS`=۴۰۰ روز، فقط یک بار) |
| [plans.ts](../backend/src/routes/plans.ts) | `/v1/plans` | لیست عمومی پلن‌ها (از جدول `plans` دیتابیس) |
| [admin.ts](../backend/src/routes/admin.ts) | `/v1/admin/*` | API ادمین: آمار، جستجوی کاربر، بلاک، هدیه‌دادن اشتراک، لیست پرداخت‌ها، ساخت/ویرایش کد تخفیف. با هدر `x-admin-token` |
| [admin-panel.ts](../backend/src/routes/admin-panel.ts) | `/admin` | 🖥️ **پنل ادمین** — یک صفحه HTML کامل (بدون فریم‌ورک). ظاهر و متن پنل همین‌جاست |
| [dev-gateway.ts](../backend/src/routes/dev-gateway.ts) | `/v1/dev/gateway` | درگاه پرداخت تقلبی برای تست (فقط وقتی `PSP_PROVIDER=fake`) |
| [health.ts](../backend/src/routes/health.ts) | `/health` `/health/ready` | چک سلامت سرور |

### منطق اصلی (`backend/src/services/`)

| فایل | نقش | نکته |
|---|---|---|
| [entitlement.ts](../backend/src/services/entitlement.ts) | «کی تا کِی اجازه استفاده داره»: جدول `grants` = دفترکل همه تمدیدها (هیچ‌وقت پاک نمی‌شه)، جدول `entitlements` = جواب فعلی. تمدید روی اشتراک فعال جمع می‌شه (ماه تقویمی واقعی) | جواب سوال «پول دادم ولی فعال نشد» همیشه از جدول grants درمیاد |
| [pricing.ts](../backend/src/services/pricing.ts) | محاسبه قیمت نهایی + اعتبارسنجی کد تخفیف (منقضی/ظرفیت/تک‌کاربره/قبلاً استفاده‌شده). تبدیل تومان→ریال (×۱۰) فقط همین‌جاست | |
| [otp.ts](../backend/src/services/otp.ts) | کدهای پیامکی: ۶ رقمی، ۲ دقیقه اعتبار، ۵ بار تلاش. **سقف‌های ارسال** (`LIMITS`): هر شماره ۱/دقیقه، ۵/ساعت، ۱۰/روز؛ هر IP ۲۰/ساعت؛ کل سیستم ۲۰۰۰/روز | سقف‌ها رو اینجا عوض کن — اینا جلوی خالی‌شدن شارژ پیامکت رو می‌گیرن |
| [tokens.ts](../backend/src/services/tokens.ts) | توکن ورود: access (۱۵ دقیقه) + refresh (۱۸۰ روز، با هر بار استفاده عوض می‌شه) | مدت‌ها در env.ts |

### سرویس‌های بیرونی (`backend/src/providers/`)

| فایل | نقش |
|---|---|
| [sms/console.ts](../backend/src/providers/sms/console.ts) | حالت توسعه: کد پیامکی رو در ترمینال سرور چاپ می‌کنه (به‌جای ارسال واقعی) |
| [sms/kavenegar.ts](../backend/src/providers/sms/kavenegar.ts) | ارسال واقعی با کاوه‌نگار (verify/lookup — قالبش باید در پنل کاوه‌نگار تایید شده باشه) |
| [psp/fake.ts](../backend/src/providers/psp/fake.ts) | درگاه تقلبی تست |
| [psp/zibal.ts](../backend/src/providers/psp/zibal.ts) | درگاه واقعی زیبال (مرچنت `"zibal"` = حالت سندباکس) |
| [psp/zarinpal.ts](../backend/src/providers/psp/zarinpal.ts) | درگاه واقعی زرین‌پال (REST v4؛ توکن رشته‌ای `authority`، مبلغ ریالی) |
| [psp/router.ts](../backend/src/providers/psp/router.ts) | روتر چند-درگاه: سریع‌ترین سالم + جایگزینی خودکار (با یک درگاه فقط رد می‌کنه) |

---

## ۶. دستور پخت: «می‌خوام فلان چیز رو عوض کنم» 🍳

| می‌خوای... | برو سراغ... |
|---|---|
| 💰 قیمت پلن‌ها رو عوض کنی | دیتابیس سرور، جدول `plans` (یا برای نصب تازه: [ddl.ts](../backend/src/db/ddl.ts) `SEED_PLANS_SQL`). نسخه نمایشی آفلاین هم در [presets.ts](../src/lib/presets.ts) ثابت `PLANS` — دوتاشون باید یکی باشن |
| 🎁 مدت هدیه کاربر جدید (۷ روز) رو عوض کنی | [backend/src/routes/auth.ts](../backend/src/routes/auth.ts) خط ۱۱ — `TRIAL_DAYS` |
| 🏷️ کد تخفیف بسازی | پنل ادمین (`/admin` → تب تخفیف‌ها) یا API `/v1/admin/discounts` |
| 🎨 رنگ اصلی (نارنجی) اپ رو عوض کنی | [src/styles.css](../src/styles.css) متغیر `--primary` (هر دو حالت روشن و تیره) |
| 🎨 لیست رنگ‌های قابل انتخاب برند در تنظیمات | [settings.tsx](../src/routes/settings.tsx) ثابت `BRAND_COLORS` |
| 📋 دسته‌بندی یا عادت آماده جدید اضافه کنی | [presets.ts](../src/lib/presets.ts) — `DEFAULT_CATEGORIES` و `PRESET_HABITS` (آیکون‌هاش باید در `CATEGORY_ICONS` فایل [ui.tsx](../src/components/ui.tsx) باشه) |
| ✍️ هر متن فارسی/انگلیسی اپ رو عوض کنی | متن‌ها همه‌جا به شکل `t("فارسی", "English")` نوشته شدن — همون صفحه مربوطه رو باز کن و متن رو پیدا کن |
| ⏰ زمان‌های پیش‌فرض پومودورو | [timer.tsx](../src/routes/timer.tsx) — `POMODORO_PRESETS` و `FREE_PRESETS` |
| 🔔 متن نوتیف‌ها | داخل اپ/وب: [state/app.tsx](../src/state/app.tsx) (بخش reminder scheduler) · موبایل (اپ بسته): [native-notifications.ts](../src/lib/native-notifications.ts) |
| 📊 درصدهای جشن (۷۰٪/۱۰۰٪) | [components/habits.tsx](../src/components/habits.tsx) تابع `applyLog` — آرایه `[70, 100]` |
| 🗓️ هدف ماهانه پیش‌فرض عادت جدید (۳۰ روز) | [components/habits.tsx](../src/components/habits.tsx) تابع `emptyDraft` — `monthlyGoal: "30"` |
| 📱 اسم اپ / شناسه اندروید | [capacitor.config.ts](../capacitor.config.ts) — `appId` و `appName` |
| 🖼️ آیکون و لوگو | `public/icons/` + کامپوننت `Logo` در [ui.tsx](../src/components/ui.tsx) + دستور `npm run icons` |
| 📶 آدرس سرور برای اپ موبایل | متغیر `VITE_API_URL` موقع بیلد (`build:mobile`)؛ پیش‌فرض وب `/v1` است (پروکسی در [vite.config.ts](../vite.config.ts)) |
| 📲 پیامک واقعی روشن کنی | env سرور: `SMS_PROVIDER=kavenegar` + `KAVENEGAR_API_KEY=...` (کد عوض نمی‌شه) |
| 💳 درگاه واقعی زیبال روشن کنی | env سرور: `PSP_PROVIDER=zibal` + `ZIBAL_MERCHANT=مرچنت-واقعی` (کد عوض نمی‌شه) |
| 🔐 رمز پنل ادمین | env سرور: `ADMIN_TOKEN` (حداقل ۱۲ کاراکتر) |
| 🚫 سقف ارسال پیامک | [backend/src/services/otp.ts](../backend/src/services/otp.ts) — ثابت `LIMITS` |
| 🧭 آیتم‌های منوی پایین/کنار | [AppShell.tsx](../src/components/AppShell.tsx) — آرایه `NAV` |
| 😀 ایموجی‌های حس‌وحال | [presets.ts](../src/lib/presets.ts) — `MOOD_EMOJIS` |
| ⭐ فاصله پاپ‌آپ نظرسنجی (هر ۵ جلسه) | [AppShell.tsx](../src/components/AppShell.tsx) — شرط `sessions - lastFeedbackSession >= 5` |

---

## ۷. ⚠️ حالت‌های تستی — قبل از انتشار واقعی حذف/خاموش کن

| کجا | چی | چطور خاموش می‌شه |
|---|---|---|
| [src/routes/auth.tsx](../src/routes/auth.tsx) | `SKIP_SMS = false` → اگه `true` بشه کلاً بدون سرور وارد می‌شه (فقط دمو) | `false` بمونه |
| [src/routes/subscribe.tsx](../src/routes/subscribe.tsx) | `TEST_GRANT_BUTTON` → دکمه «تمدید تستی بدون پرداخت» — الان از قبل `false` است | اگه برای تست خودت روشنش کردی، قبل از انتشار دوباره `false` کن |
| env سرور | `PSP_PROVIDER=fake` → درگاه تقلبی | در پروداکشن خودش خطا می‌ده؛ `zibal` بذار |
| env سرور | `SMS_PROVIDER=console` → کد در ترمینال | در پروداکشن `kavenegar` بذار |
| env سرور | همه‌ی secretهای `dev-only...` | در پروداکشن سرور اصلاً بالا نمیاد تا عوضشون نکنی (عمداً) |

---

## ۸. اجرا و بیلد

```bash
# فرانت (از ریشه پروژه)
npm run dev            # اجرای وب روی http://localhost:5173 (API پروکسی می‌شه به :3000)
npm run build          # بیلد وب → dist/
npm run build:mobile   # بیلد موبایل → www/
npm run cap:android    # بیلد + سینک + باز کردن اندروید استودیو
npm test               # تست‌های فرانت

# بک‌اند (داخل پوشه backend/)
npm run dev            # سرور روی :3000 — بدون نصب هیچی (PGlite خودش دیتابیسه)
npm test               # تست‌های بک‌اند
```

- در حالت توسعه، کد پیامکی ورود **در ترمینالِ بک‌اند** چاپ می‌شه (`[sms:console] OTP for ... -> 123456`).
- پرداخت تستی: درگاه فیک صفحه «پرداخت موفق/انصراف» نشون می‌ده.
- پنل ادمین: `http://localhost:3000/admin` — توکن پیش‌فرض dev: `dev-only-admin-token`.
- استقرار روی سرور واقعی (مسیر فعلی) + **وضعیت فعلی لانچ** (چی بالاست، چی هنوز تستیه): [DEPLOY-SUPABASE-EDGE.md](DEPLOY-SUPABASE-EDGE.md) · راه‌اندازی موبایل: [MOBILE_SETUP.md](MOBILE_SETUP.md)

---

## ۹. 🚨 منطقه‌های خطرناک — بدون فهم کامل تغییر نده

1. **`src/lib/db/*`** (مخصوصاً `diff.ts` و `migrate.ts`) — باگ = از دست رفتن بی‌صدای دیتای کاربر.
2. **`backend/src/routes/payments.ts`** — مسیر پول. منطق `applied_at` و مقایسه مبلغ (`amount mismatch`) عمداً این شکلیه؛ جابه‌جایی یک شرط می‌تونه یعنی گرنت دوباره یا گم‌شدن پول.
3. **`src/lib/phone.ts` و `backend/src/lib/phone.ts`** — باید بایت‌به‌بایت یکی باشن؛ اختلاف = یک آدم با دو اکانت.
4. **`src/routeTree.gen.ts`** — تولید خودکاره؛ هیچ‌وقت دستی ویرایش نکن.
5. **پوشه‌های `www/` و `dist/`** — خروجی بیلدن؛ تغییر دستی با بیلد بعدی پاک می‌شه.
6. **`updatedAt: 0` برای دسته‌های پیش‌فرض** در hydrate/migrate — عمدیه (برای سینک آینده)؛ «اصلاحش» نکن.
7. تنظیمات PWA در [vite.config.ts](../vite.config.ts) — سرویس‌ورکر روی بیلد موبایل باید خاموش بمونه (`disable: isMobile`).

---

## ۱۰. یادداشت فشرده برای Claude (فنی — برای صرفه‌جویی توکن)

> Claude: قبل از تحلیل دوباره‌ی کد، این بخش + بخش‌های بالا کافیه. فقط فایل‌هایی که واقعاً لازمه رو باز کن.

- **State:** single in-memory `Db` object (`src/lib/store.ts`) in `AppProvider` (`src/state/app.tsx`). All mutations via `update(fn)`; immutable spreads preserve refs → `diffDb(prev,next)` (`lib/db/diff.ts`) reference-equality diff → `applyChanges` writes RecordRows (key,data,updatedAt,deleted,dirty,seq) to Dexie tables. Device-local slice (auth, subscription, notifications, meta, theme, notificationsEnabled) → localStorage `routino:local:v1` via `lib/db/local.ts`. Legacy blob `routino:v1` imported once by `migrate.ts` (never deleted).
- **Gate:** `AppShell` → onboarding → auth (`db.auth`, device-local) → `subscriptionActive(db)` (local cache + `meta.tampered` check) → app. Entitlement refreshed once per boot from `GET /v1/subscriptions/me` (never applies `none`).
- **Auth tokens:** localStorage `routino:auth:v1` (`lib/api/auth.ts`), access ~15min JWT, opaque rotating refresh; single-flight refresh; offline never signs out.
- **Password auth:** phone-first UI defaults to password (`/auth/password/login`, identifier = canonical phone OR lowercased username — disambiguated by whether `normalizePhone` succeeds, since usernames must start with a letter). Hash = scrypt (`services/password.ts`, edge-safe, NOT the unused `argon2` dep). Brute-force limits per-identifier(8)/per-IP(50) over `login_attempts` ledger (`services/login-throttle.ts`); generic `bad_credentials` + DUMMY_HASH verify on miss = no user enumeration. Set username/password from settings when signed in (`/auth/username`, `/auth/password`). Provision without SMS: admin panel «تنظیم/ریست رمز» → `POST /admin/users/set-password` (creates + 7-day trial), OR `OWNER_PHONE`/`OWNER_PASSWORD`/`OWNER_USERNAME` env bootstrap on boot (`services/owner-bootstrap.ts`, idempotent, never overwrites an existing password).
- **Sync:** NOT implemented yet (outbox `dirty:1` + server `records` table + per-user `seq` cursor ready; Phase 4/5 pending).
- **Payments:** client names planId+code only. checkout → psp.request → redirect; callback verifies server-to-server, asserts `v.amount === payment.amountRial`, grants via `applied_at IS NULL` claim; `GET /payments/:id` self-heals stuck `redirected`. Free (100% off) grants directly. Toman→Rial ×10 only in `pricing.ts`.
- **Entitlement:** `grants` append-only ledger + `entitlements` materialized; `grantInterval` stacks with `make_interval` (real calendar months); import (`/subscriptions/import`) once-only, capped IMPORT_MAX_DAYS, `ensureExpiresAt` (max, no stacking).
- **OTP:** hashed sha256+pepper, 120s TTL, 5 attempts, newest-unconsumed-only; rate limits in `services/otp.ts` LIMITS; otp_codes rows = rate-limit ledger, purged >24h.
- **Backend infra:** Fastify, deps-injection via `app.deps` (`buildApp`), DB = NodePg|PGlite union (`db/client.ts`, `rowsOf` for raw SQL). Tests use PGlite via `backend/test/helpers`.
- **Charts:** `analyticsDayKeys` (rolling windows) + `buildChartBars` (`lib/chart.ts`) shared by analytics + habit detail; rendered by `MiniBars` (`components/ui.tsx`).
- **Timer:** ref-based interval tick (not setState updaters — StrictMode safety); commits focus minutes to linked time-habit/task via `applyLog` inside updater; sessions sorted by endedAt, capped 200.
- **Native:** CapacitorHttp for API (CORS-free), LocalNotifications for OS reminders (`native-notifications.ts`), StatusBar overlay in `native.ts`, deep link `routino://pay/result` handled in `client.tsx`. PWA SW disabled on mobile builds; `virtual:pwa-register` prompt-style updates on web.
- **i18n:** inline `t(fa, en)` everywhere; no translation files. Dates via `lib/dates.ts` (jalaali-js); week starts Sat (jalali) / Sun (gregorian); `faNum` for Persian digits.
- **Known test-only flags:** `TEST_LOGIN_BUTTON` (auth.tsx), `TEST_GRANT_BUTTON` (subscribe.tsx), `SKIP_SMS` (auth.tsx), fake PSP + console SMS via env.
