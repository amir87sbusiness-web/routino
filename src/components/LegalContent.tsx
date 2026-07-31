/**
 * متن کامل «قوانین و مقررات» + «حریم خصوصی» + «تماس با ما» در یک قطعه.
 * داخل یک بخشِ بازشو در صفحه‌ی تنظیمات (`routes/settings.tsx`) نمایش داده می‌شود.
 * اطلاعات تماس (ایمیل/تلگرام/اینستاگرام) از `lib/legal-info.ts` می‌آید.
 */
import { LEGAL_INFO } from "@/lib/legal-info";
import { useAppMaybe } from "@/state/app";

type Section = { title: string; paras: string[] };

/**
 * کد رسمی «نماد اعتماد الکترونیکی» (اینماد) برای دامنه‌ی routino.me.
 *
 * ⚠️ این رشته را دست نزن — نه آدرس‌ها، نه `id`، نه `Code`، نه تصویر. لوگوی
 * اینماد یک علامت دولتی است و هرگونه تغییر در آن طبق قانون جرم است.
 *
 * چرا با `dangerouslySetInnerHTML` و نه JSX معمولی؟ چون باید دقیقاً همان HTML
 * که اینماد صادر کرده در صفحه بنشیند. اگر به JSX ترجمه‌اش کنیم، ری‌اکت ممکن است
 * ویژگی‌های غیراستانداردش (مثل `code`) را حذف کند. متن ثابت است و از کاربر
 * نمی‌آید، پس اینجا خطر تزریق کد ندارد.
 */
const ENAMAD_SEAL =
  "<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=7120907&Code=c94FiiaLDfaEUSRS1kltZQdAz8yRaQGr'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=7120907&Code=c94FiiaLDfaEUSRS1kltZQdAz8yRaQGr' alt='' style='cursor:pointer' code='c94FiiaLDfaEUSRS1kltZQdAz8yRaQGr'></a>";

export function LegalContent() {
  const ctx = useAppMaybe();
  const t = ctx?.t ?? ((fa: string) => fa);

  const terms: Section[] = [
    {
      title: t("۱. پذیرش قوانین", "1. Acceptance of terms"),
      paras: [
        t(
          "با نصب یا استفاده از اپلیکیشن روتینو، شما این قوانین و مقررات را به‌طور کامل می‌پذیرید. اگر با بخشی از این قوانین موافق نیستید، لطفاً از سرویس استفاده نکنید.",
          "By installing or using the Routino app, you fully accept these terms. If you disagree with any part, please do not use the service.",
        ),
      ],
    },
    {
      title: t("۲. معرفی سرویس", "2. The service"),
      paras: [
        t(
          "روتینو یک اپلیکیشن عادت‌ساز و مدیریت کارهای روزانه است که امکاناتی مانند ثبت عادت‌ها، کارها، ژورنال، تایمر و آنالیز پیشرفت را ارائه می‌دهد.",
          "Routino is a habit-tracking and daily task app offering habits, tasks, journaling, a timer, and progress analytics.",
        ),
      ],
    },
    {
      title: t("۳. حساب کاربری", "3. Your account"),
      paras: [
        t(
          "ورود به حساب از طریق شماره موبایل یا نام کاربری و رمز عبور، یا کد یک‌بارمصرفِ پیامکی انجام می‌شود. مسئولیت حفظ رمز عبور و دسترسی به شماره موبایل و جلوگیری از استفاده‌ی دیگران از حساب، بر عهده‌ی شماست.",
          "Sign-in is via your mobile number or username with a password, or a one-time SMS code. You are responsible for keeping your password, keeping access to your number, and preventing others from using your account.",
        ),
      ],
    },
    {
      title: t("۴. اشتراک و پرداخت", "4. Subscription & payment"),
      paras: [
        t(
          "بخشی از امکانات روتینو نیازمند اشتراک پولی است. قیمت پلن‌ها در خودِ اپ نمایش داده می‌شود و پرداخت از طریق درگاه بانکی معتبر انجام می‌گیرد. اشتراک پس از پرداخت موفق فعال می‌شود.",
          "Some features require a paid subscription. Plan prices are shown in the app and payment is made through a licensed bank gateway. The subscription activates after a successful payment.",
        ),
        t(
          "کاربران جدید یک دوره‌ی آزمایشی رایگان دریافت می‌کنند. اشتراک به‌صورت خودکار تمدید نمی‌شود؛ برای ادامه‌ی استفاده باید آن را دستی تمدید کنید.",
          "New users get a free trial period. Subscriptions do not auto-renew; to continue, you must renew manually.",
        ),
      ],
    },
    {
      title: t("۵. استرداد وجه", "5. Refunds"),
      paras: [
        t(
          "اگر در فرایند پرداخت مبلغی از حساب شما کسر شود اما اشتراک فعال نگردد، مبلغ طبق روال درگاه بانکی به‌صورت خودکار بازمی‌گردد؛ در غیر این صورت با پشتیبانی تماس بگیرید تا موضوع پیگیری شود.",
          "If an amount is deducted but your subscription is not activated, it is refunded automatically per the bank gateway's process; otherwise, contact support to resolve it.",
        ),
      ],
    },
    {
      title: t("۶. مسئولیت‌های کاربر", "6. User responsibilities"),
      paras: [
        t(
          "استفاده از روتینو باید قانونی و مطابق مقررات باشد. سوءاستفاده، تلاش برای اخلال در سرویس، یا دسترسی غیرمجاز مجاز نیست.",
          "Use of Routino must be lawful. Abuse, attempts to disrupt the service, or unauthorized access are not permitted.",
        ),
      ],
    },
    {
      title: t("۷. محدودیت مسئولیت", "7. Limitation of liability"),
      paras: [
        t(
          "سرویس «همان‌گونه که هست» ارائه می‌شود. تلاش ما بر ارائه‌ی سرویسی پایدار است، اما مسئولیتی در قبال از دست رفتن اطلاعاتی که فقط روی دستگاه شما ذخیره شده نداریم — توصیه می‌کنیم به‌صورت دوره‌ای از بخش تنظیمات «پشتیبان» بگیرید.",
          'The service is provided "as is." We aim for a reliable service but are not liable for loss of data stored only on your device — we recommend exporting a backup periodically from Settings.',
        ),
      ],
    },
    {
      title: t("۸. مالکیت فکری", "8. Intellectual property"),
      paras: [
        t(
          "کلیه‌ی حقوق مربوط به نام، طراحی و کدِ روتینو متعلق به مالک آن است و بدون اجازه‌ی کتبی قابل کپی یا استفاده‌ی تجاری نیست.",
          "All rights to Routino's name, design, and code belong to its owner and may not be copied or used commercially without written permission.",
        ),
      ],
    },
    {
      title: t("۹. تغییر قوانین", "9. Changes to these terms"),
      paras: [
        t(
          "این قوانین ممکن است در آینده به‌روزرسانی شوند. نسخه‌ی جدید از همین بخش در دسترس خواهد بود و تاریخ آخرین به‌روزرسانی بالای همین بخش درج می‌شود.",
          "These terms may be updated. The latest version will be available in this section, with the last-updated date shown above.",
        ),
      ],
    },
  ];

  const privacy: Section[] = [
    {
      title: t("۱. کلیات", "1. Overview"),
      paras: [
        t(
          "حفظ حریم خصوصی شما برای ما مهم است. این بخش توضیح می‌دهد چه اطلاعاتی جمع‌آوری می‌شود، چگونه استفاده می‌شود و چه چیزهایی اصلاً از دستگاه شما خارج نمی‌شود.",
          "Your privacy matters to us. This section explains what we collect, how it is used, and what never leaves your device.",
        ),
      ],
    },
    {
      title: t("۲. اطلاعاتی که جمع‌آوری می‌کنیم", "2. Information we collect"),
      paras: [
        t(
          "شماره موبایل: تنها برای ورود و احراز هویت (ارسال کد یک‌بارمصرف) استفاده می‌شود.",
          "Mobile number: used only for sign-in and authentication (sending the one-time code).",
        ),
        t(
          "اطلاعات پرداخت: پرداخت‌ها از طریق درگاه بانکی انجام می‌شود. ما اطلاعات کارت بانکی شما (شماره کارت، رمز و…) را دریافت، مشاهده یا ذخیره نمی‌کنیم؛ این اطلاعات مستقیماً توسط درگاه بانکی مدیریت می‌شود.",
          "Payment details: payments go through the bank gateway. We never receive, see, or store your card details (card number, PIN, etc.); these are handled directly by the gateway.",
        ),
      ],
    },
    {
      title: t("۳. اطلاعاتی که روی دستگاه شما می‌ماند", "3. Data that stays on your device"),
      paras: [
        t(
          "عادت‌ها، کارها، ژورنال و تنظیمات شما فقط روی حافظه‌ی همان دستگاه (مرورگر یا اپ) ذخیره می‌شوند و به سرورهای ما ارسال نمی‌شوند. این یعنی اپ آفلاین کار می‌کند، اما اگر اپ را پاک کنید بدون گرفتن پشتیبان، این اطلاعات از بین می‌رود.",
          "Your habits, tasks, journal, and settings are stored only on that device (browser or app) and are not sent to our servers. The app works offline, but uninstalling without a backup loses this data.",
        ),
      ],
    },
    {
      title: t("۴. نحوه‌ی استفاده از اطلاعات", "4. How we use information"),
      paras: [
        t(
          "از شماره موبایل فقط برای احراز هویت، فعال‌سازی اشتراک و پشتیبانی استفاده می‌شود. ما اطلاعات شما را نمی‌فروشیم و برای تبلیغات در اختیار دیگران قرار نمی‌دهیم.",
          "Your mobile number is used only for authentication, activating your subscription, and support. We do not sell your data or share it for advertising.",
        ),
      ],
    },
    {
      title: t("۵. اشتراک‌گذاری با سرویس‌های شخص ثالث", "5. Third-party services"),
      paras: [
        t(
          "برای ارسال کد ورود از یک سرویس پیامکی، و برای دریافت پرداخت از یک درگاه بانکی معتبر استفاده می‌کنیم. فقط اطلاعات لازم برای همان کار (مثل شماره موبایل برای ارسال پیامک) در اختیارشان قرار می‌گیرد.",
          "We use an SMS provider to send the login code and a licensed bank gateway to process payments. Only the data needed for that specific task (e.g., your number to send the SMS) is shared.",
        ),
      ],
    },
    {
      title: t("۶. امنیت", "6. Security"),
      paras: [
        t(
          "کدهای ورود به‌صورت رمزنگاری‌شده نگهداری می‌شوند و پس از مدت کوتاهی منقضی می‌شوند. با این حال، هیچ سیستمی صددرصد ایمن نیست و ما در حد توان معقول از اطلاعات محافظت می‌کنیم.",
          "Login codes are stored encrypted and expire after a short time. However, no system is 100% secure; we protect your information with reasonable care.",
        ),
      ],
    },
    {
      title: t("۷. حقوق شما", "7. Your rights"),
      paras: [
        t(
          "شما می‌توانید حذف حساب و اطلاعات مرتبط با شماره‌ی خود را از طریق تماس با پشتیبانی درخواست کنید. اطلاعاتِ روی دستگاه را هم هر زمان می‌توانید از بخش تنظیمات پاک کنید.",
          "You can request deletion of your account and number-related data by contacting support. You can also erase on-device data anytime from Settings.",
        ),
      ],
    },
  ];

  const renderSections = (list: Section[]) =>
    list.map((sec) => (
      <section key={sec.title}>
        <h4 className="mb-1 text-[13px] font-bold text-foreground">{sec.title}</h4>
        {sec.paras.map((p, i) => (
          <p key={i} className="mb-1.5 text-[12px] leading-6 text-muted-foreground">
            {p}
          </p>
        ))}
      </section>
    ));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11px] text-muted-foreground">
        {t(
          `آخرین به‌روزرسانی: ${LEGAL_INFO.lastUpdatedFa}`,
          `Last updated: ${LEGAL_INFO.lastUpdatedEn}`,
        )}
      </p>

      <div>
        <h3 className="mb-2 text-sm font-black text-foreground">
          {t("قوانین و مقررات", "Terms & Conditions")}
        </h3>
        <div className="flex flex-col gap-3">{renderSections(terms)}</div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-black text-foreground">
          {t("حریم خصوصی", "Privacy Policy")}
        </h3>
        <div className="flex flex-col gap-3">{renderSections(privacy)}</div>
      </div>

      {/* اطلاعات تماس — لازمِ اینماد */}
      <div className="rounded-2xl border border-border p-3">
        <h3 className="mb-2 text-sm font-black text-foreground">
          {t("تماس با ما و پشتیبانی", "Contact & support")}
        </h3>
        <div className="flex flex-col gap-1.5 text-[12px] leading-6 text-muted-foreground">
          <p dir="ltr" className="text-start">
            {t("ایمیل: ", "Email: ")}
            <a href={`mailto:${LEGAL_INFO.email}`} className="font-medium text-primary">
              {LEGAL_INFO.email}
            </a>
          </p>
          <p dir="ltr" className="text-start">
            {t("تلگرام: ", "Telegram: ")}
            <a
              href={`https://t.me/${LEGAL_INFO.telegram}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary"
            >
              @{LEGAL_INFO.telegram}
            </a>
          </p>
          <p dir="ltr" className="text-start">
            {t("اینستاگرام: ", "Instagram: ")}
            <a
              href={`https://instagram.com/${LEGAL_INFO.instagram}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary"
            >
              @{LEGAL_INFO.instagram}
            </a>
          </p>
        </div>
      </div>

      {/* نماد اعتماد الکترونیکی (اینماد) */}
      <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: ENAMAD_SEAL }} />
    </div>
  );
}
