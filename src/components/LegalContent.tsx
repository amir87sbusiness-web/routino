/**
 * متن «قوانین و مقررات» + «حریم خصوصی» + «تماس با ما» داخل اپ.
 * در یک بخشِ بازشو در صفحه‌ی تنظیمات (`routes/settings.tsx`) نمایش داده می‌شود.
 *
 * خودِ متن اینجا نیست — از `lib/legal-text.ts` می‌آید، چون سایت اصلی
 * (routino.me) هم دقیقاً همان متن را نشان می‌دهد و دو نسخه‌ی جدا دیر یا زود دو
 * چیز متفاوت می‌گویند. اطلاعات تماس از `lib/legal-info.ts` می‌آید.
 */
import { LEGAL_INFO } from "@/lib/legal-info";
import { ENAMAD_SEAL, PRIVACY, TERMS, type LegalSection } from "@/lib/legal-text";
import { useAppMaybe } from "@/state/app";

export function LegalContent() {
  const ctx = useAppMaybe();
  const t = ctx?.t ?? ((fa: string) => fa);

  const renderSections = (list: readonly LegalSection[]) =>
    list.map((sec) => (
      <section key={sec.title[0]}>
        <h4 className="mb-1 text-[13px] font-bold text-foreground">{t(...sec.title)}</h4>
        {sec.paras.map((p, i) => (
          <p key={i} className="mb-1.5 text-[12px] leading-6 text-muted-foreground">
            {t(...p)}
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
        <div className="flex flex-col gap-3">{renderSections(TERMS)}</div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-black text-foreground">
          {t("حریم خصوصی", "Privacy Policy")}
        </h3>
        <div className="flex flex-col gap-3">{renderSections(PRIVACY)}</div>
      </div>

      {/* راه‌های تماس عمومی */}
      <div className="rounded-2xl border border-border p-3">
        <h3 className="mb-2 text-sm font-black text-foreground">
          {t("تماس با ما و پشتیبانی", "Contact & support")}
        </h3>
        <div className="flex flex-col gap-1.5 text-[12px] leading-6 text-muted-foreground">
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
