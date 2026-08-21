# ساخت نسخه اندروید روتینو

نسخهٔ اندروید یک اپ Capacitor با شناسهٔ ثابت `com.routino.app` است. فایل‌های رابط داخل APK قرار می‌گیرند؛ عادت‌ها، کارها و ژورنال در IndexedDB همان گوشی ذخیره می‌شوند و برای کار روزمره اینترنت لازم نیست. ارتباط حساب، دستگاه، اشتراک و پرداخت با `https://api.routino.me/v1` انجام می‌شود.

## ساخت Release امضاشده

پیش‌نیازها: Node، Android SDK و JBR همراه Android Studio. روی این سیستم مسیرهای فعال این‌ها هستند:

- JBR: `E:\softwears\android\jbr`
- SDK: `C:\Users\User\AppData\Local\Android\Sdk`

کلید امضا فقط یک‌بار ساخته می‌شود:

```powershell
$env:JAVA_HOME='E:\softwears\android\jbr'
$env:ANDROID_SDK_ROOT='C:\Users\User\AppData\Local\Android\Sdk'
npm run android:signing:init
```

کلید در `C:\Users\User\.routino-signing\` و تنظیم محرمانه در `android/keystore.properties` می‌ماند؛ هر دو خارج از Git هستند. پوشهٔ کلید و فایل properties باید با هم در یک محل امن پشتیبان‌گیری شوند. بدون همین کلید، نسخه‌های بعدی روی نصب فعلی کاربر آپدیت نمی‌شوند.

برای هر انتشار:

```powershell
$env:JAVA_HOME='E:\softwears\android\jbr'
$env:ANDROID_SDK_ROOT='C:\Users\User\AppData\Local\Android\Sdk'
npm run android:release
```

این دستور وب‌اپ موبایل را با API تولید می‌کند، Capacitor را sync می‌کند، Release بهینه و امضاشده می‌سازد، امضا و نام بسته را بررسی می‌کند و این سه فایل را در `output/android/` می‌گذارد:

- `routino-android-<version>.apk`
- فایل `.sha256` برای کنترل سلامت دانلود
- فایل `.json` شامل نسخه، اندازه، SHA-256 و اثرانگشت گواهی

اگر کلید امضا وجود نداشته باشد، Release عمداً متوقف می‌شود؛ APK بدون امضا یا با گواهی Debug تحویل داده نمی‌شود.

## تست نصب

با گوشی متصل و USB debugging روشن:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r output\android\routino-android-1.0.apk
```

حداقل این مسیرها تست شوند: بازشدن اپ، ساخت داده و بازکردن دوباره در حالت آفلاین، ورود، بازگشت از پس‌زمینه، مجوز نوتیفیکیشن و Share فایل Export. پاک‌کردن یا Logout حساب نباید عادت‌ها و ژورنال محلی را حذف کند؛ Uninstall سیستم‌عامل حافظهٔ اپ را پاک می‌کند، پس Export برای بکاپ ضروری است.

## انتشار مستقیم از سایت

APK و فایل SHA-256 را روی فضای ابری HTTPS آپلود کن. سپس متغیر `ANDROID_DOWNLOAD_URL` را هنگام ساخت سایت روی لینک HTTPS فایل APK بگذار. تا قبل از داشتن لینک واقعی، دکمهٔ سایت به‌صورت صادقانه غیرفعال می‌ماند.

برای هر نسخهٔ جدید، `versionCode` باید افزایش پیدا کند و APK حتماً با همان کلید قبلی ساخته شود.

## نوتیفیکیشن

یادآورهای عادت، کار، ژورنال و trial/اشتراک روی Android/iOS با Local Notifications زمان‌بندی می‌شوند و به اینترنت یا Supabase وابسته نیستند. نصب تازه با اعلان خاموش شروع می‌شود؛ Provider فقط permission را می‌خواند و dialog باز نمی‌کند. درخواست permission فقط بعد از اقدام صریح کاربر در Settings یا ساخت اولین reminder انجام می‌شود.

planner حداکثر ۶۰ درخواست pending می‌سازد: روزانه و روزهای هفته از recurrence واقعی API v7 استفاده می‌کنند؛ زوج/فرد شمسی یا میلادی occurrenceهای تک‌بار و نزدیک را با `isDueOn` می‌سازند. reconciler فقط موارد `extra.routino=true` را جایگزین می‌کند، پس اعلان نامرتبط پاک نمی‌شود.

در Android 12+ مجوز `SCHEDULE_EXACT_ALARM` در manifest ثبت است و برنامه با `checkExactNotificationSetting()` وضعیت را می‌خواند. اگر کاربر اجازه ندهد، خود plugin به alarm غیردقیق برمی‌گردد و Settings هشدار می‌دهد؛ `allowWhileIdle` برای reminderهای کاربر فعال است. receiver خود plugin مجوز boot و restore بعد از reboot را به merged manifest اضافه می‌کند.

تأیید واقعی drift یک‌دقیقه‌ای، battery saver، kill و reboot فقط روی گوشی فیزیکی معتبر است؛ چک‌لیست `docs-fa/REMINDER-NATIVE-CHECKLIST.md` باید قبل از انتشار روی حداقل یک Android 12+ و ترجیحاً یک iPhone اجرا شود.
