# طراحی متن کوتاه و خودمانی قوانین روتینو

تاریخ: ۲۰۲۶-۰۹-۰۳

## هدف

متن «قوانین و مقررات» و «حریم خصوصی» داخل روتینو و صفحهٔ عمومی سایت کوتاه، ساده و هم‌لحن با خود برنامه شود؛ بدون حذف واقعیت‌های مهم دربارهٔ حساب، پرداخت، اطلاعات کاربر، حذف حساب و وابستگی بخش‌های آنلاین به اینترنت، Cloudflare و Supabase.

## محدوده

- منبع مشترک متن در `src/lib/legal-text.json` تغییر می‌کند تا اپ و `routino.me/legal/` دقیقاً یک نسخه نشان دهند.
- تاریخ آخرین به‌روزرسانی در `src/lib/legal-info.ts` به ۱۲ شهریور ۱۴۰۵ / September 3, 2026 تغییر می‌کند.
- توضیح مسیر متن در `docs-fa/01-FRONTEND.md` با نسخهٔ کوتاه جدید هماهنگ می‌شود.
- چیدمان، اطلاعات تماس، نشان اینماد، بک‌اند، دیتابیس، اشتراک، پرداخت و منطق همگام‌سازی تغییر نمی‌کنند.

## لحن

متن فارسی مستقیم و خودمانی است، اما عامیانه یا شوخی‌دار نیست. به‌جای عبارت‌های سنگین حقوقی، جمله‌های کوتاه و روشن استفاده می‌شود. متن انگلیسی همان معنی را با لحن ساده منتقل می‌کند. هیچ ادعای تضمین صددرصدی امنیت، دسترس‌پذیری یا برگشت وجه اضافه نمی‌شود.

## متن نهایی فارسی

### قوانین و مقررات

#### ۱. استفاده از روتینو

با نصب یا استفاده از روتینو، یعنی این قوانین را قبول داری. روتینو برای مدیریت عادت‌ها و کارهای شخصی ساخته شده و قول نتیجهٔ مشخصی نمی‌دهد.

#### ۲. حساب کاربری

رمز عبور و دسترسی به شماره‌ات را امن نگه دار. استفادهٔ غیرقانونی، ایجاد اختلال یا تلاش برای ورود غیرمجاز ممنوع است.

#### ۳. اشتراک و پرداخت

اگر شرایط تریال را داشته باشی، فقط یک‌بار ۷ روز استفادهٔ آزمایشی می‌گیری. قیمت‌ها داخل اپ نمایش داده می‌شوند، اشتراک فقط بعد از تأیید پرداخت فعال می‌شود و تمدید خودکار ندارد. اگر پرداختت مشکل داشت، به پشتیبانی پیام بده؛ برگشت وجه هم طبق روال بانک و درگاه پرداخت انجام می‌شود.

#### ۴. اینترنت و دسترسی به سرویس

روتینو برای سرویس‌های آنلاینش از Cloudflare و Supabase استفاده می‌کند. ورود، همگام‌سازی و پرداخت به اینترنت نیاز دارند؛ پس اگر اینترنت، اپراتور یا یکی از سرویس‌های بیرونی قطع یا مختل شود، ممکن است این بخش‌ها موقتاً کار نکنند. اتفاق‌هایی که خارج از کنترل معقول ما هستند به عهدهٔ روتینو نیستند، مگر جایی که قانون چیز دیگری بگوید. بخش‌های اصلی با اطلاعات روی دستگاه کار می‌کنند، اما اطلاعات همگام‌نشده ممکن است با حذف برنامه، پاک‌کردن داده‌های مرورگر یا خرابی دستگاه از بین بروند؛ بهتر است خروجی پشتیبان بگیری.

#### ۵. مالکیت و تغییر قوانین

نام، طراحی و کد روتینو متعلق به مالک آن است. اگر این قوانین تغییر کنند، نسخهٔ تازه از همین بخش در دسترس خواهد بود.

### حریم خصوصی

#### ۱. چه اطلاعاتی نگه می‌داریم؟

روتینو اطلاعات حساب، چیزهایی که داخل برنامه ثبت می‌کنی، وضعیت اشتراک، سوابق ضروری پرداخت و اطلاعات فنی لازم برای امنیت و پشتیبانی را نگه می‌دارد.

#### ۲. اطلاعات کجا می‌روند و چرا؟

بخشی از اطلاعات روی دستگاهت می‌ماند و اطلاعات قابل‌همگام‌سازی از راه زیرساخت Cloudflare و Supabase با سرور روتینو ردوبدل می‌شود. از این اطلاعات فقط برای ورود، همگام‌سازی و بازیابی، پرداخت، پشتیبانی و امنیت استفاده می‌کنیم. اطلاعاتت را نمی‌فروشیم و برای تبلیغات به کسی نمی‌دهیم.

#### ۳. سرویس‌های دیگر

برای زیرساخت آنلاین، پیامک ورود و پرداخت از سرویس‌دهنده‌های دیگر کمک می‌گیریم و فقط اطلاعات لازم برای همان کار را در اختیارشان می‌گذاریم. اطلاعات کامل کارت و رمز بانکی فقط در درگاه پرداخت وارد می‌شود و به روتینو نمی‌رسد.

#### ۴. امنیت و نگهداری اطلاعات

برای محافظت از اطلاعات از روش‌های امنیتی متعارف استفاده می‌کنیم، اما هیچ سیستم آنلاینی امنیت یا دسترسی صددرصدی ندارد. حساب‌هایی که سابقهٔ خرید یا دسترسی غیرآزمایشی ندارند ممکن است بعد از حداقل ۳۰ روز و در تاریخی که اپ نشان می‌دهد، همراه اطلاعات قابل‌حذفشان پاک شوند. حساب‌های دارای سابقهٔ پرداخت یا دسترسی غیرآزمایشی شامل این حذف خودکار نمی‌شوند.

#### ۵. انتخاب‌های تو

گرفتن خروجی از اطلاعات همیشه در دسترس است. «پاک‌کردن همهٔ داده‌ها» محتوای برنامه را پاک می‌کند، ولی حساب را حذف نمی‌کند. برای حذف حساب و اطلاعات سروری قابل‌حذف به پشتیبانی پیام بده. سوابقی که برای پرداخت، امنیت یا تکالیف قانونی لازم‌اند ممکن است باقی بمانند.

## متن نهایی انگلیسی

### Terms & Conditions

#### 1. Using Routino

By installing or using Routino, you agree to these terms. Routino is made for managing personal habits and tasks and does not promise any specific result.

#### 2. Your account

Keep your password and access to your mobile number safe. Unlawful use, disruption of the service, and attempts to gain unauthorized access are not allowed.

#### 3. Subscription & payment

If you are eligible for a trial, you can receive one seven-day trial. Prices are shown in the app, subscriptions activate only after payment is confirmed, and they do not renew automatically. If something goes wrong with a payment, contact support; refunds follow the bank and payment gateway process.

#### 4. Internet & service availability

Routino uses Cloudflare and Supabase for its online services. Sign-in, sync, and payment need an internet connection, so those features may be temporarily unavailable if your internet provider or an external service is interrupted. Routino is not responsible for events outside our reasonable control, except where the law requires otherwise. Core features use data stored on your device, but unsynced data may be lost if you uninstall the app, clear browser data, or lose the device; keeping an export backup is recommended.

#### 5. Ownership & changes

Routino's name, design, and code belong to its owner. If these terms change, the latest version will be available here.

### Privacy Policy

#### 1. What we keep

Routino keeps account details, content you add to the app, subscription status, necessary payment records, and technical information needed for security and support.

#### 2. Where information goes and why

Some information stays on your device. Syncable information is exchanged with Routino's server through Cloudflare and Supabase infrastructure. We use it only for sign-in, sync and recovery, payment, support, and security. We do not sell your information or share it for advertising.

#### 3. Other services

We use other providers for online infrastructure, sign-in messages, and payments, and share only what is needed for that task. Full card details and banking PINs are entered only at the payment gateway and are not received by Routino.

#### 4. Security & retention

We use reasonable security measures, but no online system can guarantee perfect security or availability. Accounts with no purchase or non-trial access history may be deleted with their deletable data after at least 30 days and on the date shown in the app. Accounts with payment or non-trial access history are not included in this automatic deletion.

#### 5. Your choices

You can always export your information. “Erase all data” removes app content but does not delete the account. Contact support to request deletion of the account and deletable server data. Records needed for payments, security, or legal duties may be retained.

## اعتبارسنجی و انتشار

1. ساختار دوزبانهٔ JSON و وجود متن Cloudflare، Supabase و محدودیت قطعی اینترنت بررسی می‌شود.
2. تست ساخت لندینگ اجرا می‌شود تا صفحهٔ عمومی قوانین از همان منبع ساخته شود و تماس/اینماد سالم بمانند.
3. بیلد production ریشه اجرا می‌شود؛ این بیلد هم `/app/` و هم صفحهٔ معرفی و `/legal/` را داخل `dist/` می‌سازد.
4. قبل از انتشار، اختلاف `main` با `origin/main` مرور می‌شود چون هر commit قبلیِ منتشرنشده نیز با push وارد نسخهٔ زنده خواهد شد.
5. انتشار فقط برای Cloudflare Pages انجام می‌شود؛ Supabase Edge، دیتابیس، migration، secret، پیامک و پرداخت deploy نمی‌شوند.
6. بعد از انتشار، `routino.me/legal/` و بخش قوانین داخل `routino.me/app/` از نظر متن و تاریخ به‌صورت زنده بررسی می‌شوند.

