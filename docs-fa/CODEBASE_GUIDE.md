# 🗺️ راهنمای کامل کد روتینو (Routino Codebase Guide)

> **این فایل برای چیه؟**
> ۱) برای خودت: بدون بلد بودن برنامه‌نویسی بفهمی هر بخش اپ کجاست و برای تغییر هر چیزی باید سراغ کدوم فایل بری.
> ۲) برای Claude (هوش مصنوعی): در جلسات بعدی به‌جای خوندن کل کد، اول این فایل رو بخونه تا توکن کمتری مصرف بشه.
>
> آخرین به‌روزرسانی: **۱۳ مرداد ۱۴۰۵ (2026-08-04)** — اگه کد رو خیلی تغییر دادی، از Claude بخواه این فایل رو هم آپدیت کنه.
>
> 📍 **دنبال «الان کجاییم و چی مونده؟» می‌گردی؟** بخش «وضعیت فعلی لانچ» در
> [DEPLOY-SUPABASE-EDGE.md](DEPLOY-SUPABASE-EDGE.md) — همان‌جا با جدول نوشته شده.

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
├── landing/              ← 🌐 سایت عمومی routino.me (قالب HTML + عکس‌های محصول)
│   ├── index.template.html   صفحه‌ی اول
│   ├── legal.template.html   صفحه‌ی /legal/
│   └── shots/                عکس‌های واقعی اپ (با `npm run shots`)
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
| [src/lib/logic.ts](../src/lib/logic.ts) | **همه‌ی محاسبات**: کدوم روز عادت فعاله، درصد انجام، استریک 🔥، پیشرفت ماهانه، نشان‌ها، نمره روز، و `subscriptionActive` (چک فعال بودن اشتراک) + `applyServerEntitlement` (جواب سرور، و پاک‌کردن پرچم دستکاری ساعت) | فرمول نمره‌دهی، منطق استریک، شرط گرفتن نشان |
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
| [timer.tsx](../src/routes/timer.tsx) | **تایمر**: پومودورو (پیش‌فرض ۲۵/۵ و ۴ دور)، تایمر آزاد، کرونومتر، اتصال به عادت زمانی، تاریخچه جلسات | زمان‌های پیش‌فرض (`POMODORO_PRESETS`، `FREE_PRESETS`)، تعداد دورهای قابل انتخاب (`CYCLE_CHOICES`)، سقف تاریخچه (۲۰۰) |
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
| [AppShell.tsx](../src/components/AppShell.tsx) | **قاب اصلی اپ**: گِیت (بخش ۳)، منوی پایین موبایل / سایدبار دسکتاپ، زنگوله اعلان‌ها، پاپ‌آپ نظرسنجی (حداکثر روزی یک‌بار) | آیتم‌های منو (`NAV`)، فاصله نظرسنجی (`FEEDBACK_INTERVAL`)، اسپلش |
| [FeedbackModal.tsx](../src/components/FeedbackModal.tsx) | فرم «نظرت درباره روتینو؟» — هم پاپ‌آپ خودکار، هم دکمه‌ی تنظیمات | متن‌ها و لیست بخش‌های قابل انتخاب |
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
| 🏷️ کد تخفیف بسازی | پنل ادمین (`/admin` → تب تخفیف‌ها) یا API `/v1/admin/discounts` — قواعدش پایین‌تر، بخش ۶.۱ |
| 🎨 رنگ اصلی (نارنجی) اپ رو عوض کنی | [src/styles.css](../src/styles.css) متغیر `--primary` (هر دو حالت روشن و تیره) |
| 🎨 لیست رنگ‌های قابل انتخاب برند در تنظیمات | [settings.tsx](../src/routes/settings.tsx) ثابت `BRAND_COLORS` |
| 📋 دسته‌بندی یا عادت آماده جدید اضافه کنی | [presets.ts](../src/lib/presets.ts) — `DEFAULT_CATEGORIES` و `PRESET_HABITS` (آیکون‌هاش باید در `CATEGORY_ICONS` فایل [ui.tsx](../src/components/ui.tsx) باشه) |
| ✍️ هر متن فارسی/انگلیسی اپ رو عوض کنی | متن‌ها همه‌جا به شکل `t("فارسی", "English")` نوشته شدن — همون صفحه مربوطه رو باز کن و متن رو پیدا کن |
| ⏰ زمان‌های پیش‌فرض پومودورو | [timer.tsx](../src/routes/timer.tsx) — `POMODORO_PRESETS` و `FREE_PRESETS` |
| 🔁 تعداد دورهای پومودورو | [timer.tsx](../src/routes/timer.tsx) — `CYCLE_CHOICES` (پیش‌فرض ۴ دور در `pomoCycles`) |
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
| ⭐ فاصله پاپ‌آپ نظرسنجی (روزی یک‌بار) | [AppShell.tsx](../src/components/AppShell.tsx) — ثابت `FEEDBACK_INTERVAL` |
| 🌐 متن یا ظاهر صفحه‌ی اول سایت | [landing/index.template.html](../landing/index.template.html)، بعدش `npm run build:landing` |
| 🖼️ عکس‌های صفحه‌ی اول (بعد از تغییر UI) | `npm run dev` روی :5180 بعد `npm run shots` — عکس‌های استفاده‌نشده خودکار منتشر نمی‌شوند |

---

### ۶.۲ صفحه‌ی اول عمداً حرفی از پول نمی‌زند 💡

تصمیم مالک (مرداد ۱۴۰۵): در `routino.me` **هیچ اشاره‌ای به قیمت، اشتراک، خرید یا
دوره‌ی آزمایشی نیست** و فرم ثبت‌نام هم ندارد. کارِ صفحه فقط این است که محصول را
نشان بدهد و بازدیدکننده را با دکمه ببرد به `/app/`. حساب‌باز‌کردن و ۷ روز
آزمایشی داخل خود اپ اتفاق می‌افتد (`TRIAL_DAYS` در
[backend/src/routes/auth.ts](../backend/src/routes/auth.ts)) و صفحه‌ی خرید فقط
وقتی دیده می‌شود که آن ۷ روز تمام شده باشد.

پس اگر جایی در صفحه‌ی اول دنبال کارت قیمت یا فرم شماره گشتی و پیدا نکردی:
**حذف شده، از قلم نیفتاده.** ماژول `src/lib/signup-intent.ts` هم که شماره و پلن
را از آدرس (`/app/?start=…&plan=…`) به اپ می‌رساند با همین تغییر حذف شد.

---

### ۶.۱ کد تخفیف — قواعد کامل 🏷️

از پنل ادمین (`/admin` → تب تخفیف‌ها) می‌سازی. هر کد این تنظیمات رو داره:

| تنظیم | معنی | مثال |
|---|---|---|
| `code` | خود کد. **بی‌توجه به بزرگی/کوچکی حرف** (کاربر `off50` بزنه با `OFF50` یکیه). فقط حرف/عدد/`-`/`_`، بین ۳ تا ۳۲ نویسه | `NOWRUZ40` |
| `percent` | درصد تخفیف، ۱ تا ۱۰۰. **۱۰۰ = رایگان** (اصلاً به درگاه نمی‌ره، مستقیم اشتراک می‌ده) | `40` |
| `maxUses` | **چند نفر** بتونن استفاده کنن. خالی = بی‌نهایت | `50` |
| `expiresAt` | تا چه تاریخی معتبره. خالی = بدون انقضا | ۱۴۰۵/۰۶/۳۱ |
| `phone` | فقط برای **یک شماره‌ی خاص**. خالی = برای همه | `09121112233` |
| `active` | خاموش/روشن کردن فوری بدون حذف | `true` |

**قواعد ثابت (تغییرشون نده):**
- **هر کاربر فقط یک بار** از هر کد استفاده می‌کنه — این با کلید اصلی جدول `redemptions` تضمین شده، نه با یه شرط `if`.
- **`maxUses` حالا واقعاً سقفه.** قبلاً فقط پرداخت‌های *تمام‌شده* شمرده می‌شد، پس اگه ۱۰ نفر هم‌زمان می‌رفتن درگاه، همه تخفیف می‌گرفتن. الان کسی که **همین حالا داخل درگاهه** هم یک ظرفیت اشغال می‌کنه.
- اگه کسی وارد درگاه بشه و پرداخت رو نصفه رها کنه، ظرفیتش **بعد از ۳۰ دقیقه خودکار آزاد می‌شه** (`RESERVATION_MINUTES` در [pricing.ts](../backend/src/services/pricing.ts)).
- تخفیف و «آفر» ضربی روی هم اعمال می‌شن، و **قیمت فقط سمت سرور** حساب می‌شه. کلاینت هیچ‌وقت مبلغ نمی‌فرسته.
- زمان انقضا با **ساعت سرور (UTC)** مقایسه می‌شه.

**مثال‌ها:**
- کمپین نوروز برای ۱۰۰ نفر اول: `percent=40`, `maxUses=100`, `expiresAt=آخر فروردین`
- کد اینفلوئنسر بدون سقف تا آخر ماه: `percent=25`, `maxUses=خالی`, `expiresAt=آخر ماه`
- عذرخواهی از یک مشتری خاص: `percent=100`, `phone=شماره‌اش`, `maxUses=1`

---

## ۷. ⚠️ حالت‌های تستی — قبل از انتشار واقعی حذف/خاموش کن

| کجا | چی | چطور خاموش می‌شه |
|---|---|---|
| [src/routes/auth.tsx](../src/routes/auth.tsx) | `SKIP_SMS = false` → اگه `true` بشه کلاً بدون سرور وارد می‌شه (فقط دمو) | `false` بمونه |
| [src/routes/subscribe.tsx](../src/routes/subscribe.tsx) | `TEST_GRANT_BUTTON` → دکمه «تمدید تستی بدون پرداخت» — الان از قبل `false` است | اگه برای تست خودت روشنش کردی، قبل از انتشار دوباره `false` کن |
| env سرور | `PSP_PROVIDER=fake` → درگاه تقلبی | در پروداکشن خودش خطا می‌ده؛ `zibal` بذار |
| env سرور | `SMS_PROVIDER=console` → کد در ترمینال | در پروداکشن سرور بالا نمیاد مگه `ALLOW_TEST_PROVIDERS=true`؛ برای واقعی `kavenegar` بذار |
| env سرور | `ZIBAL_MERCHANT=zibal` → **سندباکس زیبال** | در پروداکشن سرور بالا نمیاد مگه `ALLOW_TEST_PROVIDERS=true`. ⚠️ این خطرناک‌ترین حالت تستیه: از بیرون هیچ فرقی با درگاه واقعی نداره — کاربر «موفق» می‌بینه، اشتراک واقعی می‌گیره، ولی پولی به حسابت نمی‌رسه |
| env سرور | `ALLOW_TEST_PROVIDERS=true` → اجازه‌ی موندن روی دو مورد بالا | روز لایو **حذفش کن** |
| env سرور | همه‌ی secretهای `dev-only...` | در پروداکشن سرور اصلاً بالا نمیاد تا عوضشون نکنی (عمداً) |

**چطور بفهمم چیزی تستی مونده؟** لاگ استارتاپ سرور/تابع. هر چیزی که تستی باشه با `[!] TEST MODE — …` چاپ می‌شه. اگه هیچ خطی نبود، همه‌چی واقعیه.

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
6.۱ **`meta.tampered`** — پرچم دستکاری ساعت. چسبنده‌ست و `subscriptionActive` رو `false` می‌کنه، یعنی کل اپ قفل می‌شه. **تنها راه پاک‌شدنش باید جوابِ سرور یا یک پرداخت موفق باشه** (`applyServerEntitlement`). اگه این پاک‌شدن رو برداری، کاربری که ساعت گوشیش جلو بوده و بعد درستش کرده، **برای همیشه** از اشتراکِ پول‌داده‌اش محروم می‌شه.
7. تنظیمات PWA در [vite.config.ts](../vite.config.ts) — سرویس‌ورکر روی بیلد موبایل باید خاموش بمونه (`disable: isMobile`).

---

## ۱۰. یادداشت فشرده برای Claude (فنی — برای صرفه‌جویی توکن)

> Claude: قبل از تحلیل دوباره‌ی کد، این بخش + بخش‌های بالا کافیه. فقط فایل‌هایی که واقعاً لازمه رو باز کن.

- **State:** single in-memory `Db` object (`src/lib/store.ts`) in `AppProvider` (`src/state/app.tsx`). All mutations via `update(fn)`; immutable spreads preserve refs → `diffDb(prev,next)` (`lib/db/diff.ts`) reference-equality diff → `applyChanges` writes RecordRows (key,data,updatedAt,deleted,dirty,seq) to Dexie tables. Device-local slice (auth, subscription, notifications, meta, theme, notificationsEnabled) → localStorage `routino:local:v1` via `lib/db/local.ts`. Legacy blob `routino:v1` imported once by `migrate.ts` (never deleted).
- **Gate:** `AppShell` → onboarding → auth (`db.auth`, device-local) → `subscriptionActive(db)` (local cache + `meta.tampered` check) → app. Entitlement refreshed once per boot from `GET /v1/subscriptions/me` (never applies `none`). A brand-new phone gets a 7-day trial on `/auth/otp/verify`, so a first-time user goes landing → onboarding → auth → **app**, never touching `/subscribe`.
- **Landing (`landing/index.template.html`, built by `scripts/build-landing.mjs`):** static, no framework, no signup form, and by owner decision **no mention of price, subscription or the trial**. Its only job is CTA → `/app/`. `copyShots` publishes only the screenshots the HTML actually references, so an orphaned `landing/shots/*.webp` is not shipped. Dark-only on purpose (`color-scheme: dark`) because the product itself is dark. Structure (Aug 2026 redesign, owner's request) follows the ordinary mobile-app-site order — the same order productiveapp.io uses: two-column hero with a phone → four-up badge strip → five alternating feature rows → desktop shot → a card rail replacing the reviews wall → store buttons → closing banner → footer. **Only the shape was taken**; colour, copy, font, icons, imagery and every claim are ours, and the background is deliberately warm near-black rather than neutral so the brand orange sits on it. **No fabricated social proof:** where such sites put "15M downloads", an App Store rating and seven testimonials, this page carries a four-item `.awards` strip and a `#why` rail of true product statements — do not put a number there until a real one exists, and do not put a quotation there until a real user exists. **Nothing on the page moves except things appearing** (owner's request): every screen is a still (`clip-*-still.webp`, the first frame of the clips). The animated clips and the `.reel` machinery that swapped them in mid-scroll were **removed**, which cut published imagery from 811KB to 199KB; `clip-*.webp` still sit in `landing/shots/` but are unreferenced, so the build leaves them behind. `scripts/film-landing.mjs` (`npm run film`) still exists if they are ever wanted back. The hero phone is five stacked stills revealed **once**, 0.5s each at 1/1.5/2/2.5s with `fill: both`, so **`<img>` order matters** — "today" is last because it is what stays on screen; the reveal is gated behind `.js`, so without JavaScript the first still simply stays and the phone is never blank. The first still is `fetchpriority=high` and `<link rel=preload>`ed, since it is the LCP. Four traps: (1) the phone inside `.scene` is meant to be cropped at the **bottom** only — the scene is `overflow: hidden` with `align-items: start`, because centring a phone taller than its scene also slices its top corner off; (2) when the rows stack under 900px, `.feat-art` needs an explicit `width: 100%`, since `.feat` is `align-items: center` so children do not stretch and the art column snaps to its 520px intrinsic width — and because `body` is `overflow-x: hidden` that silently clips content instead of producing a scrollbar; (3) the `#why` rail moves with `scrollIntoView`, never `scrollLeft`/`scrollBy`, because engines disagree on how RTL `scrollLeft` is numbered (Chrome counts 0 → negative) so hand-computed offsets work in one browser and do nothing in the rest — and it needs `block: "nearest"` or the browser also jumps the page vertically; (4) for reduced motion pass `behavior: "instant"`, not `"auto"` — `"auto"` defers to CSS, and CSS sets `scroll-behavior: smooth` on `.rail`, so `"auto"` still animated for users who asked it not to. The Android CTA deliberately has no `href` and carries `aria-disabled` plus a «به‌زودی» tag — **do not invent an APK URL**; give `#android-btn` a real `href` and drop `soon` when the owner supplies the file. Nothing is visible-by-default-inverted: elements render visible and only the `.js` class (inline `head` script) hides them so animation can run, so a JS failure degrades to a fully readable page, never a blank one.
- **Auth tokens:** localStorage `routino:auth:v1` (`lib/api/auth.ts`), access ~15min JWT, opaque rotating refresh; single-flight refresh; offline never signs out.
- **Password auth:** phone-first UI defaults to password (`/auth/password/login`, identifier = canonical phone OR lowercased username — disambiguated by whether `normalizePhone` succeeds, since usernames must start with a letter). Hash = scrypt (`services/password.ts`, edge-safe). The `argon2` dependency it deliberately did not use has now been REMOVED — do not add it back: it is a native node-gyp module that nothing imports and that breaks alpine/musl Docker builds. Brute-force limits per-identifier(8)/per-IP(50) over `login_attempts` ledger (`services/login-throttle.ts`); generic `bad_credentials` + DUMMY_HASH verify on miss = no user enumeration. Set username/password from settings when signed in (`/auth/username`, `/auth/password`). **`/auth/password` calls `revokeOtherDevices`** (`services/tokens.ts`) — a password change is how a user evicts an intruder, and refresh tokens live 180 days and rotate silently, so without it the change is cosmetic. The caller's own `deviceId` (from the access-token `did` claim) is kept so they aren't signed out of the device they just used. NOTE: `supabase/functions/api/routes/*` is hand-written, NOT generated — a route change must be mirrored there by hand; only `shared/` comes from `npm run sync:edge`. Provision without SMS: admin panel «تنظیم/ریست رمز» → `POST /admin/users/set-password` (creates + 7-day trial), OR `OWNER_PHONE`/`OWNER_PASSWORD`/`OWNER_USERNAME` env bootstrap on boot (`services/owner-bootstrap.ts`, idempotent, never overwrites an existing password).
- **Device limit:** `MAX_ACTIVE_DEVICES = 2` + `enforceDeviceLimit` (`services/tokens.ts`), called right after `issueForDevice` in BOTH login paths (`routes/auth.ts` and the hand-ported Hono copy). Evicts by `last_seen_at DESC NULLS LAST` — never `created_at`, which would bump the owner's daily phone instead of a stale tablet. Runs on sign-in ONLY and costs the request path nothing: `rotateRefresh` already refuses a row with `revoked_at`, so an evicted device dies at its next refresh. Ceiling worth knowing: the app is offline-first and the paywall reads a cached local subscription, so an evicted device keeps working until that cache expires — the limit bites at renewal, not immediately. Tests: `backend/test/device-limit.test.ts`.
- **Sync: IMPLEMENTED.** `POST /v1/sync/push` + `GET /v1/sync/pull?cursor=N`, logic in `services/sync.ts` (shared, parity-tested), client engine in `src/lib/sync/`. Protocol: every write to `records` takes a number from `users.seq`, a device remembers the highest it has seen, and pulling is "everything above my cursor". Two invariants carry it: (1) `seq` is allocated by `UPDATE users SET seq = seq + n RETURNING seq` **inside the same statement as the INSERT** (a CTE: `with bump as (update users …) insert into records … select … from incoming cross join bump`). The row lock is what makes seq order match commit order, and a lock is only held to the end of its STATEMENT — split into reserve-then-insert it is released at the semicolon, so a push holding a lower block can commit after a reader passed it and those rows are invisible to that device forever. A SEQUENCE cannot do this job at all. Pushes are also de-duplicated by `(kind,id)` first: `ON CONFLICT DO UPDATE` raises 21000 if one statement touches a key twice, and the habit-delete cascade can collide with a log the client sent itself — that 500 wedged sync permanently for the account; (2) conflicts are last-write-wins on `updated_at`, a CLIENT clock, clamped server-side to `min(client, now + 60s)` — unclamped, one device set to 2099 wins every conflict on the account forever. Deletes are tombstone ROWS; a habit tombstone cascades to its logs server-side so deleting a habit is a 1-row push, not 400. Triggers: boot, foreground (`visibilitychange`), and a 5-min timer. **The client must NOT adopt the cursor a push returns** — that number is the log position after its own rows, and everything below it includes whatever the OTHER devices wrote since this one last pulled, so adopting it skipped them permanently (the laptop's habit never reached the phone). Re-pulling this device's own writes is the price and it is free: `mergeRemote` drops them on the `local >= remote` tie. Covered by `src/lib/sync/engine.test.ts`, which drives the engine against a fake server that numbers rows the way the real one does. A push chunk the server refuses with a 4xx (an oversized journal entry is the realistic one) is SKIPPED, not thrown: aborting the run stopped every other table AND the pull, so one bad row took the whole account dark with nothing reported. The rows keep their dirty flag; the count comes back as `SyncOutcome.rejected`. NOT entitlement-gated — sync is how data survives a lost phone, so it is an auth boundary, not a paywall. Device-local settings (`theme`, `notificationsEnabled`) are refused at the merge boundary in `src/lib/sync/merge.ts`, not merely omitted upstream.
- **The sync cursor lives in IndexedDB** (`syncMeta` table, Dexie v2), NOT localStorage. Those are two stores with two eviction policies — Safari drops IndexedDB under storage pressure, a failed Dexie upgrade drops it — and a cursor that outlives its records is worse than none: the device asks for "everything above 5", is correctly told there is nothing, and shows an empty app the data can never return to. Wiped together, the next sync just pulls the account again. Verified in a real browser by deleting the database and reloading. Anything walking `idb.tables` must skip `syncMeta` (it has no `dirty` index) — see `pendingChanges`.
- **Sync gotcha:** after applying remote rows the engine re-hydrates and calls `setDb`. `lastPersisted.current` MUST be re-baselined to that same object first — the persist effect diffs by REFERENCE, so a fresh hydrate that skipped it reads as "every record changed", marks the whole database dirty, and pushes the entire account back on the next sync.
- **Invocation budget is the design constraint.** Supabase's free tier bills per FUNCTION INVOCATION (~500k/mo), not per query, and that — not storage or egress — is what runs out. So a steady-state app open is ONE request: `GET /v1/sync/pull`, whose last page also carries the entitlement (the app no longer calls `/subscriptions/me` on boot) and which sweeps stranded payments on the way. The idle re-sync timer is 15 min, not 5. Measured in a real browser: 1 invocation per open, ~20ms. Do not add a second boot request without deleting one — the arithmetic is roughly 2–2.5k daily users at one request per open and half that at two.
- **A payment nobody came back for still lands** (`settleOpenPayments` in `services/payment-flow.ts`, called from the sync pull). The gateway callback is a REDIRECT of the user's browser, and in Iran that browser is behind a VPN or a connection that drops — so "money moved, callback never arrived, user closed the tab" is ordinary. The sweep finishes those on the next app open: one indexed SELECT that normally returns nothing, a gateway round trip only when there IS something. It also repairs the one gap `applyPaid` cannot close alone — it claims the row and THEN grants, so a process killed between the two leaves a payment marked paid with no entitlement; those are found by asking which paid payments have no `grants` row (partial index `grants_payment`). Tests: `backend/test/payment-recovery.test.ts` (3 of its 6 fail without the sweep) and `payment-burst.test.ts`.
- **PSP calls are timed out** (`PSP_TIMEOUT_MS`, 12s, in `providers/psp/zibal.ts`; ZarinPal imports it). There was no timeout at all, and Deno's `fetch` has no default one — a gateway that accepted the connection then went quiet held a function instance until it was killed, which is exactly the filtered-connection failure mode and worst during a burst. A throw is the correct outcome: `router.ts` already parks an erroring gateway and fails over, and a timed-out VERIFY is safe because the callback and the poll both re-verify.
- **A lost gateway callback self-heals** (`settleOpenPayments`, called from the sync pull): the callback is a REDIRECT of the user's browser, and behind an Iranian VPN it is dropped often enough to be routine. If it never lands and the user never revisits the payment screen, the row sits in `redirected` forever — money moved, nothing granted, recoverable only by a support message. So the app's own boot request finishes it: one indexed SELECT that returns nothing on the normal path, bounded to 3 rows and 72h. It also repairs the one window `applyPaid` cannot close itself (claim, crash, no grant) by asking which paid payments have no `grants` row — hence the partial `grants_payment` index. Tests: `backend/test/payment-recovery.test.ts`, `payment-burst.test.ts`.
- **PSP calls have a 12s timeout** (`PSP_TIMEOUT_MS` in `providers/psp/zibal.ts`, used by ZarinPal too). There was none, and Deno's `fetch` has no default — a gateway that accepted the connection then went quiet held a function instance until it was killed, which is exactly what a filtered connection does and exactly the worst thing during a burst of checkouts. A throw is the right outcome: `router.ts` already parks an erroring gateway and fails over, and a timed-out VERIFY is safe because the callback and the poll both re-verify.
- **Payments:** client names planId+code only. checkout → psp.request → redirect; callback verifies server-to-server, asserts `v.amount === payment.amountRial`, grants via `applied_at IS NULL` claim; `GET /payments/:id` self-heals stuck `redirected`. Free (100% off) grants directly. Toman→Rial ×10 only in `pricing.ts`.
- **Callback caller must be `proven`** (`handlePaymentCallback`): the public callback only acts on — or discloses — a payment when the query string carries an *unguessable* id, i.e. `orderId` matching `payment.id` or ZarinPal's `Authority`. A bare `trackId` is not proof: it is a short sequential integer shown to every paying user. Unproven callers get `{outcome:"pending"}` with **no payment object** and no DB write. Do NOT relax this to a per-branch check: `canceled` is terminal (`pollPayment` never revives it), so an unproven cancel stranded a stranger's paid payment — money moved, nothing granted; and echoing the row back leaks `payment.id` (the proof token itself) plus the bank `refNumber` the result page prints. Every real gateway echoes `orderId`, so nothing legitimate is turned away — tests that hand-build a callback URL must include it.
- **Entitlement:** `grants` append-only ledger + `entitlements` materialized; `grantInterval` stacks with `make_interval` (real calendar months); import (`/subscriptions/import`) once-only, capped IMPORT_MAX_DAYS, `ensureExpiresAt` (max, no stacking). **Both writers are ONE statement** (`insert … on conflict do update set expires_at = greatest(entitlements.expires_at, now) + make_interval(…)`) — do NOT refactor back to SELECT-then-UPDATE: two grants landing together silently dropped one, so a user who paid for two months got one.
- **OTP:** hashed sha256+pepper, 120s TTL, 5 attempts, newest-unconsumed-only; rate limits in `services/otp.ts` LIMITS; otp_codes rows = rate-limit ledger, purged >24h. The attempt counter is claimed with a conditional `UPDATE … SET attempts = attempts + 1 WHERE attempts < max RETURNING` — a read-then-write let a concurrent burst spend the same slot repeatedly.
- **Discounts:** `max_uses` is enforced against `max(used_count, redemptions) + in-flight payments` (`slotsTaken` in `pricing.ts`, 30-min reservation window), because `used_count` is only written on success — checking it alone let everyone who reached the gateway before the first payment settled share a single-use code. `redeemDiscount`'s increment is capped in its WHERE clause.
- **Errors:** `registerErrorHandler` passes through any error carrying a 4xx `statusCode` (Fastify's own `FST_ERR_*`: body over the 64 KB cap, bad Content-Length, unsupported media type) with its real status and code. They used to fall into the catch-all 500, which told a client "server broken, retry" for what was really "fix your request" — worst for the sync client, whose push size is bounded by that same body limit. 5xx stays opaque.
- **Throttling:** there is no HTTP rate limiter in production (the edge app has none; Fastify registers `@fastify/rate-limit` for the Node deployment only). All real limits are Postgres ledgers: `otp_codes` (SMS spend), `login_attempts` (password sign-in AND admin-token guessing, via `adminAttemptKey`). Two-tier login limits: past the soft limit a WRONG password 429s but a CORRECT one still succeeds — a flat lockout let anyone freeze a known phone number out of their own account. The admin guard checks the token FIRST for the same reason.
- **Backend infra:** Fastify, deps-injection via `app.deps` (`buildApp`), DB = NodePg|PGlite union (`db/client.ts`, `rowsOf` for raw SQL). Tests use PGlite via `backend/test/helpers`.
- **Free-tier budget (re-measured with sync ON — `supabase/tests/quota.test.ts`):** turning sync on changed this by ~30x and it is now the binding constraint. A synced record costs **~347 B** (row + PK + `records_pull` index), so a user is ~57 KB after a quarter of use and ~222 KB after a year: **500 MB holds ~9k users at three months each, or ~2.3k at a year each.** Unlike invocations and egress this does NOT reset monthly — it fills and stays full. Egress is still a non-issue (~480 B/user/day → ~370k DAU). Invocations: an app open is now **1** request (`GET /v1/sync/pull`, which carries the entitlement) plus a token refresh when the access token has lapsed, down from 2–3; the idle poll is 15 min, not 5. The test measures a SLOPE (sizes at N/2 vs N) because an empty schema already costs ~250 KB in minimum pages. When the DB budget runs out the answer is Supabase Pro (8 GB, $25/mo), not a code change.
- **Tombstone GC is scheduled** (`routino-tombstone-purge`, weekly, in `scripts/gen-setup-sql.mjs` → `supabase/setup.sql`): deletes `records` tombstones older than 90 days and raises `users.gc_seq` to the highest seq removed IN THE SAME STATEMENT. The bump is what makes the delete safe — a device below that line gets `reset: true` and full-resyncs instead of silently resurrecting the record. `backend/test/tombstone-purge.test.ts` extracts the SQL out of `setup.sql` and runs it for real, which is how the `90 * 86400000` int4 overflow in it was caught; a cron job that fails only writes to a log nobody reads.
- **Worker (`cloudflare/api-worker.js`, tested by `supabase/tests/worker.test.ts`):** only `GET /v1/plans` is edge-cached (300s), keyed by the `Origin` header because the CORS layer echoes it back — one shared entry would serve routino.me's `Access-Control-Allow-Origin` to a `capacitor://` caller. `Vary` can't do this job: the response varies on Origin and Cloudflare treats anything beyond `Accept-Encoding` as uncacheable, hence the explicit Cache API. The body is read with `.text()` and `content-encoding` stripped before storing — forwarding the stream would cache a body whose declared encoding matches whoever happened to ask first. Non-200s are never cached (a cached 500 would pin the paywall to "no plans"). A price edited in the admin panel is up to 5 min late.
- **Dropped on purpose:** the `records_habit` index on `(data->>'habitId')` indexed a query nobody ever wrote — the habit-delete cascade matches the id prefix `habitId|dateKey` instead. An unused index is write cost on `logs`, the highest-volume table, so `ddl.ts` now carries `drop index if exists records_habit`. `logKeysForHabit` in `db/diff.ts` went the same way: it documented a local orphan-GC that did not exist and was never called (the cascade's tombstones come back on the next pull and clear them).
- **Charts:** `analyticsDayKeys` (rolling windows) + `buildChartBars` (`lib/chart.ts`) shared by analytics + habit detail; rendered by `MiniBars` (`components/ui.tsx`).
- **Timer:** ref-based interval tick (not setState updaters — StrictMode safety); commits focus minutes to linked time-habit/task via `applyLog` inside updater; sessions sorted by endedAt, capped 200.
- **Native:** CapacitorHttp for API (CORS-free), LocalNotifications for OS reminders (`native-notifications.ts`), StatusBar overlay in `native.ts`, deep link `routino://pay/result` handled in `client.tsx`. PWA SW disabled on mobile builds; `virtual:pwa-register` prompt-style updates on web.
- **i18n:** inline `t(fa, en)` everywhere; no translation files. Dates via `lib/dates.ts` (jalaali-js); week starts Sat (jalali) / Sun (gregorian); `faNum` for Persian digits.
- **Known test-only flags:** `TEST_GRANT_BUTTON` (subscribe.tsx), `SKIP_SMS` (auth.tsx), `SHOW_DEMO_SEED` (settings.tsx), fake PSP + console SMS via env. (`TEST_LOGIN_BUTTON` no longer exists.) All are `false` literals, so Rollup tree-shakes their bodies out of the bundle — verified, `seed-demo.ts` does not ship.
- **`BACKUP_UI` (settings.tsx) is NOT a test flag — it is a product decision, currently `false`.** It hides the whole Export/Import card so a user cannot export, sign up with a new phone for a fresh 7-day trial, and restore. Note the vector it targets was ALREADY closed (Import is gated on `paidActive = subscriptionActive && !trial`, and `loginAs` wipes content on an owner change), so what this actually costs is the only recovery a user has: data lives solely in IndexedDB, and there is now no path back from a cleared browser store, an iOS eviction, or a new phone — including for paying customers. Flip to `true` to restore; no code was deleted.
