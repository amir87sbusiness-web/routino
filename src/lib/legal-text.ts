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
 * JSON آرایه‌ها را `string[]` می‌بیند نه تاپلِ دوتایی، پس یک cast لازم است.
 *
 * اینجا عمداً هیچ throwی نیست. قبلاً بود، و نتیجه‌اش این شد: یک جفتِ ناقص در
 * JSON — مثلاً افتادنِ نیمه‌ی انگلیسی یک عبارت — کلِ صفحه‌ی تنظیمات را با
 * «این صفحه بارگذاری نشد» از کار می‌انداخت. یعنی یک غلطِ تایپی در متن حقوقی،
 * دکمه‌ی «گرفتن پشتیبان» و «خروج از حساب» را از دسترس کاربر خارج می‌کرد —
 * دقیقاً همان دو چیزی که موقع مشکل لازم می‌شوند.
 *
 * اعتبارسنجی به `scripts/build-landing.mjs` منتقل شد: آنجا بیلد را با خطای
 * صریح می‌شکند، یعنی قبل از انتشار. در زمان اجرا حداکثر یک عبارت ناقص نمایش
 * داده می‌شود، نه یک صفحه‌ی سوخته.
 */
export const TERMS = data.terms as unknown as readonly LegalSection[];
export const PRIVACY = data.privacy as unknown as readonly LegalSection[];
