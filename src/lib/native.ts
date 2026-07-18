// نوارهای سیستمِ نیتیو (اندروید/iOS) را با تمِ اپ هماهنگ می‌کند.
// روی وب no-op است.
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

/**
 * نوارهای سیستم را با تم هماهنگ می‌کند: نوار وضعیت شفاف (edge-to-edge) با
 * آیکون‌های هماهنگ با تم؛ فاصله‌گیری از نوارها با پدینگِ safe-area در CSS انجام می‌شود.
 * هر بار که تم عوض می‌شود صدا زده می‌شود؛ فراخوانی چندباره بی‌خطر است.
 */
export function syncNativeBars(isDark: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  // Edge-to-edge: WebView زیر نوارها کشیده می‌شود و env(safe-area-inset-*) در CSS
  // فعال می‌شود؛ پدینگِ safe-area در استایل‌ها محتوا را از نوارها دور نگه می‌دارد.
  // (روی اندروید ۱۵ که edge-to-edge اجباری است، overlay=false نوار بالا را درست نمی‌کند.)
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  // Style.Dark = آیکون روشن برای پس‌زمینه‌ی تیره؛ Style.Light = آیکون تیره برای روشن.
  StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
}
