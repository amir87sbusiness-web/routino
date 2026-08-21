/**
 * اطلاعات تماس نمایش‌داده‌شده در بخش «تماس با ما»ی صفحه‌ی تنظیمات
 * (کامپوننت `components/LegalContent.tsx`).
 *
 * 👈 امیر: اگر خواستی هر کدام را عوض کنی، فقط مقدار داخلِ گیومه را تغییر بده.
 *    آی‌دی‌های تلگرام/اینستاگرام را بدون @ بنویس.
 */
export const LEGAL_INFO = {
  /** آی‌دی تلگرام پشتیبانی — بدون @ (لینک: https://t.me/…) */
  telegram: "routino_support",
  /** آی‌دی اینستاگرام — بدون @ (لینک: https://instagram.com/…) */
  instagram: "routino.me",

  /** آخرین به‌روزرسانی این قوانین — هر بار متن را عوض کردی این دو را هم به‌روز کن */
  lastUpdatedFa: "۳۰ مرداد ۱۴۰۵",
  lastUpdatedEn: "August 21, 2026",
} as const;

/** آیا هنوز مقداری پرنشده (placeholder داخل [ ]) باقی مانده؟ (هشدار حالت توسعه) */
export const legalInfoIsPlaceholder = (): boolean =>
  Object.values(LEGAL_INFO).some((v) => typeof v === "string" && v.includes("["));
