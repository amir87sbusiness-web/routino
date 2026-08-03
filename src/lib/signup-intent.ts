/**
 * «قصد خرید» — چیزی که کاربر از صفحه‌ی معرفی (routino.me) با خودش می‌آورد.
 *
 * صفحه‌ی معرفی فرم ورود ندارد و نباید هم داشته باشد: کپی‌کردن منطق احراز هویت
 * در یک HTML ایستا یعنی یک جای دومِ مستقل برای اشتباه امنیتی، و آن‌جا نه
 * محدودیت تلاش هست نه مدیریت خطا. پس فقط شماره و پلن را در آدرس می‌فرستد:
 *
 *     routino.me/app/?start=09123334444&plan=m12
 *
 * و از آن‌جا به بعد همان مسیر همیشگیِ خود اپ اجرا می‌شود — ورود استاندارد با
 * رمز یا کد پیامکی، با همان صفحه و همان اعتبارسنجی.
 *
 * چرا sessionStorage و نه خودِ آدرس؟ چون گِیتِ `AppShell` کاربر تازه را به
 * `/onboarding` و بعد `/auth` و بعد `/subscribe` می‌فرستد و در هر پرش
 * پارامترهای آدرس را دور می‌ریزد. یک‌بار ذخیره می‌کنیم، هر صفحه هر وقت لازم شد
 * می‌خواند. sessionStorage (نه localStorage) چون این قصد فقط برای همین بازدید
 * است؛ اگر کاربر خرید نکرد و فردا برگشت، نباید دوباره به صفحه‌ی خرید پرت شود.
 */
import { normalizePhone, toLocalPhone } from "./phone";

const KEY = "routino:signup-intent:v1";

export interface SignupIntent {
  /** شماره‌ی محلی (۰۹…) آماده برای گذاشتن در فرم ورود. */
  phone?: string;
  /** شناسه‌ی پلن انتخاب‌شده در صفحه‌ی معرفی (m1 | m3 | m12). */
  plan?: string;
}

/** شناسه‌ی پلن‌ها کوتاه و از حروف و رقم است؛ هر چیز دیگری از آدرس نادیده گرفته
 * می‌شود تا یک لینکِ دست‌کاری‌شده چیزی به صفحه‌ی خرید تزریق نکند. */
const PLAN_RE = /^[a-z0-9]{1,12}$/i;

/**
 * قصد را از آدرس برمی‌دارد، ذخیره می‌کند و پارامترها را از نوار آدرس پاک
 * می‌کند. پاک‌کردن مهم است: شماره‌ی موبایل نباید در آدرس بماند، چون کاربر ممکن
 * است همان لینک را برای کسی بفرستد یا در تاریخچه‌ی مرورگر بنشیند.
 *
 * باید خیلی زود صدا زده شود — قبل از اینکه روتر شروع به جابه‌جایی کند.
 */
export function captureSignupIntent(): void {
  try {
    const url = new URL(window.location.href);
    const rawPhone = url.searchParams.get("start");
    const rawPlan = url.searchParams.get("plan");
    if (!rawPhone && !rawPlan) return;

    const intent: SignupIntent = {};
    // فقط شماره‌ای که واقعاً معتبر است؛ ورودی بی‌ربط بی‌صدا دور ریخته می‌شود.
    const canonical = rawPhone ? normalizePhone(rawPhone) : null;
    if (canonical) intent.phone = toLocalPhone(canonical);
    if (rawPlan && PLAN_RE.test(rawPlan)) intent.plan = rawPlan;

    if (intent.phone || intent.plan) sessionStorage.setItem(KEY, JSON.stringify(intent));

    url.searchParams.delete("start");
    url.searchParams.delete("plan");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* حالت ناشناس مرورگر می‌تواند throw کند — نبودِ این قابلیت نباید اپ را بخواباند */
  }
}

export function readSignupIntent(): SignupIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SignupIntent) : null;
  } catch {
    return null;
  }
}

/** بعد از اینکه قصد به سرانجام رسید (خرید انجام شد) صدا زده می‌شود. */
export function clearSignupIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
