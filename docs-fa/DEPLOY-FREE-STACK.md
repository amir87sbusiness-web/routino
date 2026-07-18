# انتشار رایگان روتینو روی routino.me

راهنمای قدم‌به‌قدم برای لانچ با سرویس‌های رایگان خارجی:
**Cloudflare Pages + Render + Supabase + GitHub**، با درگاه ایرانی (زیبال) و
پیامک داخلی (کاوه‌نگار).

> این راهنما جایگزین مسیر آروان‌کلاد در [`DEPLOY.md`](DEPLOY.md) است. آن فایل را
> فقط برای **چک‌لیست قبل از لانچ (بخش ۷)** نگه دار — آن نکات (تأیید قالب پیامک،
> مرچنت زیبال، تست بکاپ، اولین پرداخت واقعی) اینجا هم صادق‌اند.

---

## نقشه‌ی کلی

روتینو سه تکه‌ی جداست. هر کدام یک خانه‌ی جدا دارد:

```
                 ┌────────────────────────┐
   کاربر ──────► │  Cloudflare (لبه)       │
                 │  routino.me → وب‌اپ      │  ← Cloudflare Pages (فایل ثابت)
                 │  api.routino.me → سرور  │  ← پروکسی روی Render
                 └───────────┬────────────┘
                             │ /v1/...
                             ▼
                     ┌───────────────┐        ┌──────────────┐
                     │ سرور Fastify   │ ─────► │  Supabase     │
                     │ روی Render     │        │  (پستگرس)     │
                     └───────────────┘        └──────────────┘
```

| تکه | خانه | آدرس |
|---|---|---|
| وب‌اپ (`dist/`) | Cloudflare Pages | `https://routino.me` |
| سرور (`backend/`) | Render (Web Service رایگان) | `https://api.routino.me` |
| دیتابیس | Supabase (پستگرس رایگان) | فقط داخلی |

**چرا api.routino.me از پشت Cloudflare رد می‌شود؟** تا کاربر ایرانی به لبه‌ی
Cloudflare وصل شود (نه مستقیم به Render)، و هم سرعت بگیرد هم دسترسی پایدارتر باشد.

---

## پیش‌نیازها (یک‌بار)

- [ ] اکانت **GitHub** (کد اینجا می‌رود؛ هم Pages هم Render از آن می‌خوانند).
- [ ] دامنه‌ی **routino.me** از یک ثبت‌کننده (registrar) خریداری‌شده.
- [ ] اکانت **Cloudflare**، **Render**، **Supabase** (هر سه با ایمیل رایگان).

---

## قدم ۰ — همین امروز شروع کن (چون چند روز طول می‌کشند)

- [ ] **کاوه‌نگار**: ثبت‌نام کن، کلید API بگیر، و **قالب پیامک OTP** را ثبت کن.
      تأیید قالب دستی و انسانی است و **چند روز طول می‌کشد**؛ تا نگیری هیچ کاربری
      نمی‌تواند وارد شود.
- [ ] **زیبال**: درخواست **مرچنت واقعی** بده و کد مرچنت را یادداشت کن.

بقیه‌ی قدم‌ها را می‌توانی همین حالا جلو ببری؛ فقط برای «ورود واقعی» و «پرداخت
واقعی» منتظر این دو می‌مانی.

---

## قدم ۱ — کد را روی GitHub بگذار

پروژه هنوز گیت نیست. یک‌بار:

```bash
git init
git add -A
git commit -m "Initial commit"
# یک ریپوی خصوصی روی GitHub بساز، بعد:
git remote add origin https://github.com/<user>/routino.git
git branch -M main
git push -u origin main
```

> `.env` و `backend/.env` و `backend/.pglite-data` نباید پوش شوند — قبل از commit
> مطمئن شو در `.gitignore` هستند.

---

## قدم ۲ — دیتابیس روی Supabase

1. در Supabase یک **New project** بساز (نزدیک‌ترین ریجن را انتخاب کن).
2. یک **Database password** قوی بگذار و جایی امن ذخیره کن.
3. بعد از ساخت: **Project Settings → Database → Connection string → قسمت
   «Session pooler»** را باز کن. رشته‌ای شبیه این می‌بینی:

   ```
   postgres://postgres.xxxx:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

4. `[PASSWORD]` را با رمز مرحله‌ی ۲ جایگزین کن و **`?sslmode=require`** به آخرش
   اضافه کن. این می‌شود `DATABASE_URL` سرور:

   ```
   postgres://postgres.xxxx:رمز@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
   ```

> **چرا Session pooler و نه اتصال مستقیم؟** سرور Fastify یک استخر اتصال دائم
> می‌سازد؛ pooler برای همین است و گواهی SSL معتبر دارد. اگر به هر دلیل خطای SSL
> گرفتی، `sslmode=require` را به `sslmode=no-verify` تغییر بده.

**جداول را خودش می‌سازد:** لازم نیست مایگریشن دستی بزنی. سرور در اولین بوت،
schema و پلن‌های اشتراک را خودش روی این دیتابیس می‌سازد (`backend/src/index.ts`).

---

## قدم ۳ — سرور روی Render

1. در Render: **New → Web Service** و ریپوی GitHub را وصل کن.
2. تنظیمات بیلد:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
   - **Instance Type:** Free
3. **Environment variables** را بگذار (جدول کامل پایین صفحه). حواست به این‌ها باشد:
   - رمزها را با این دستور بساز (سه‌بار اجرا کن، برای هر کدام یکی):
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
     ```
   - `PORT` را **دستی نگذار** — Render خودش تزریق می‌کند و سرور از آن می‌خواند.
4. Deploy کن. در لاگ باید ببینی: `[api] listening on :... (sms=kavenegar, psp=zibal)`.
5. **Custom Domain:** در Render → Settings → Custom Domains آدرس
   `api.routino.me` را اضافه کن. Render یک مقدار CNAME می‌دهد (شبیه
   `xxxx.onrender.com`) — آن را برای قدم ۵ نگه دار.

> اگر سرور بالا نیامد و خطای «must be set in production» دیدی، یعنی یکی از رمزها
> هنوز مقدار پیش‌فرض `dev-only` دارد. `env.ts` عمداً جلوی بوت را می‌گیرد.

---

## قدم ۴ — دامنه را به Cloudflare بیاور

1. در Cloudflare: **Add a site → routino.me** و پلن **Free**.
2. Cloudflare دو **nameserver** می‌دهد. در پنل ثبت‌کننده‌ی دامنه، nameserverها را
   با این‌ها **جایگزین** کن. (انتشار DNS ممکن است تا چند ساعت طول بکشد.)

---

## قدم ۵ — وب‌اپ روی Cloudflare Pages

1. در Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** و ریپو
   را انتخاب کن.
2. تنظیمات بیلد:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (زیر Settings → Variables، برای Production):
   - `VITE_API_URL = https://api.routino.me/v1`

     > این آدرس **حین بیلد** داخل فایل‌ها می‌رود. اگر بعداً آدرس سرور عوض شد،
     > باید دوباره Deploy بزنی. فایل‌های `_headers` و `_redirects` (که ساخته‌ایم)
     > خودکار اعمال می‌شوند.
4. Deploy کن.
5. **Custom Domain:** در Pages → Custom domains آدرس `routino.me` (و اگر خواستی
   `www`) را اضافه کن. Cloudflare چون خودش صاحب DNS است، رکوردش را خودکار می‌زند.

---

## قدم ۶ — رکورد DNS سرور را وصل کن

در Cloudflare → DNS، یک رکورد برای زیردامنه‌ی API بساز:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `api` | `<xxxx>.onrender.com` (از قدم ۳) | 🟠 **Proxied (روشن)** |

پروکسی نارنجی یعنی ترافیک از لبه‌ی Cloudflare رد می‌شود. در **SSL/TLS → Overview**
حالت را روی **Full** بگذار (نه Flexible) تا با گواهی Render سازگار باشد.

---

## قدم ۷ — به‌هم‌وصل‌کردن و تست نهایی

- [ ] `https://routino.me` باز می‌شود و اپ بالا می‌آید.
- [ ] `https://routino.me/habits` را مستقیم باز کن — نباید ۴۰۴ بدهد (کار
      `_redirects`).
- [ ] **ورود:** شماره بزن و منتظر پیامک بمان. اگر «CORS» خطا دیدی، یعنی
      `CORS_ORIGINS` در Render شامل `https://routino.me` نیست — درستش کن و
      دوباره Deploy بزن.
- [ ] **پرداخت:** یک اشتراک بخر. باید به درگاه زیبال برود و بعد از پرداخت به
      `https://routino.me` برگردد و اشتراک فعال شود. اولین تراکنش را **با کارت
      خودت** بزن و در پنل ادمین چک کن.
- [ ] **پنل ادمین:** `https://api.routino.me/admin` با `ADMIN_TOKEN` وارد شو.

> **نکته‌ی Render رایگان:** سرور بعد از ۱۵ دقیقه بی‌کاری می‌خوابد و اولین درخواست
> بعدی ~۳۰ ثانیه کند است. برای شروع اوکی است. اگر آزاردهنده شد، یک ping دوره‌ای
> (مثلاً هر ۱۰ دقیقه به `https://api.routino.me/` از cron-job.org) بیدار نگهش
> می‌دارد، یا پلن ارزان Render مشکل را کامل حل می‌کند.

---

## جدول کامل Environment Variables سرور (Render)

| کلید | مقدار | توضیح |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DB_DRIVER` | `postgres` | pglite فقط توسعه است |
| `DATABASE_URL` | رشته‌ی Supabase از قدم ۲ | با `?sslmode=require` |
| `TRUST_PROXY` | `true` | چون پشت Cloudflare/Render است |
| `JWT_SECRET` | رشته‌ی تصادفی بلند | با دستور بالا بساز |
| `OTP_PEPPER` | رشته‌ی تصادفی بلند دیگر | با دستور بالا بساز |
| `ADMIN_TOKEN` | رشته‌ی تصادفی بلند سوم | ورود به /admin |
| `SMS_PROVIDER` | `kavenegar` | |
| `KAVENEGAR_API_KEY` | کلید تو | |
| `KAVENEGAR_TEMPLATE` | `routino-otp` | یا اسم قالب تأییدشده‌ات |
| `PSP_PROVIDER` | `zibal` | |
| `ZIBAL_MERCHANT` | کد مرچنت واقعی | |
| `PUBLIC_API_URL` | `https://api.routino.me` | زیبال مرورگر را به همین برمی‌گرداند |
| `PUBLIC_WEB_URL` | `https://routino.me` | |
| `CORS_ORIGINS` | `https://routino.me,https://localhost,capacitor://localhost` | اگر اپ موبایل هم داری، دو تای آخر لازم است |
| `APP_DEEP_LINK` | `routino://pay/result` | برای برگشت به اپ موبایل بعد از پرداخت |

---

## آپدیت‌های بعدی

هر تغییری که به `main` پوش کنی، **هم Cloudflare Pages هم Render خودکار دوباره
Deploy می‌کنند**. کاربرهایی که وب‌اپ را باز دارند اعلان «نسخه‌ی جدید آماده‌ست»
می‌بینند و با یک کلیک آپدیت می‌گیرند.

---

## درباره‌ی «چند درگاه / تعویض درگاه»

از قبل توی کد آماده است — لازم نیست چیزی بسازی:

- **پرداخت:** `backend/src/providers/psp/` (الان `zibal` و `fake`). تعویض =
  فقط عوض‌کردن `PSP_PROVIDER`. درگاه جدید = یک فایل تازه کنار همین‌ها + یک خط در
  `backend/src/providers/psp/index.ts` و `backend/src/index.ts`.
- **پیامک:** `backend/src/providers/sms/` (الان `kavenegar` و `console`). همان
  الگو.
