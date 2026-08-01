/**
 * قوانین و مقررات + حریم خصوصی — تایپ‌دار روی داده‌ی مشترک.
 *
 * خودِ متن در `legal-text.json` کنار همین فایل است، نه اینجا. چرا JSON؟ چون دو
 * مصرف‌کننده دارد:
 *   ۱) اپ (`components/LegalContent.tsx`) — از همین ماژول می‌خواند
 *   ۲) سایت اصلی routino.me (`scripts/build-landing.mjs`) — مستقیم خود JSON را
 *      می‌خواند، بدون هیچ ابزار تایپ‌اسکریپتی
 *
 * متن حقوقی که در دو نسخه نگهداری شود دیر یا زود دو چیز متفاوت می‌گوید — و برای
 * بررسی اینماد دقیقاً همین متن ملاک است. پس یک منبع، دو مصرف‌کننده، و بیلدِ
 * لندینگ بدون وابستگی اضافه.
 *
 * برای عوض کردن متن فقط `legal-text.json` را ویرایش کن.
 */
import data from "./legal-text.json";

/** هر عبارت یک جفت [فارسی, English] است. */
export type Bilingual = readonly [fa: string, en: string];

export interface LegalSection {
  readonly title: Bilingual;
  readonly paras: readonly Bilingual[];
}

/**
 * کد رسمی «نماد اعتماد الکترونیکی» (اینماد) برای دامنه‌ی routino.me.
 *
 * ⚠️ این رشته را دست نزن — نه آدرس‌ها، نه `id`، نه `Code`، نه تصویر. لوگوی
 * اینماد یک علامت دولتی است و هرگونه تغییر در آن طبق قانون جرم است.
 */
export const ENAMAD_SEAL: string = data.enamadSeal;

/**
 * JSON آرایه‌ها را `string[]` می‌بیند نه تاپلِ دوتایی، پس یک cast لازم است — و
 * cast خالی یعنی یک جفتِ ناقص در JSON بی‌صدا به `undefined` رندر می‌شود. اینجا
 * اول بررسی می‌شود تا اگر متن حقوقی خراب بود، همان لحظه با خطای صریح بایستد.
 */
function asSections(raw: { title: string[]; paras: string[][] }[]): readonly LegalSection[] {
  for (const s of raw) {
    if (s.title.length !== 2 || s.paras.some((p) => p.length !== 2)) {
      throw new Error(`legal-text.json: هر عبارت باید [فارسی, English] باشد — «${s.title[0]}»`);
    }
  }
  return raw as unknown as readonly LegalSection[];
}

export const TERMS = asSections(data.terms);
export const PRIVACY = asSections(data.privacy);
