import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  FileText,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  MessageSquare,
  Moon,
  Palette,
  Plus,
  Sun,
  Tags,
  Trash2,
  Upload,
  Vibrate,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { FeedbackModal } from "@/components/FeedbackModal";
import { LegalContent } from "@/components/LegalContent";
import {
  Button,
  CatIcon,
  CATEGORY_ICONS,
  Card,
  ColorWheel,
  Input,
  Modal,
  TimePicker24,
} from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { fetchAccount, logout, setPassword, setUsername, type AccountInfo } from "@/lib/api/auth";
import {
  backupSummary,
  copyBackupToClipboard,
  downloadBackup,
  parseBackup,
  restoreDb,
  type Backup,
} from "@/lib/backup";
import { isNative, shareBackupNative } from "@/lib/backup-native";
import { dateKey, faNum, formatDate } from "@/lib/dates";
import { canImportBackup } from "@/lib/import-policy";
import {
  checkNativeExactAlarmSetting,
  checkNativeNotificationPermission,
  isNativeRuntime,
  notificationDeliveryActive,
  requestNativeExactAlarmSetting,
  requestNotificationPermission,
  type NativeExactAlarmState,
} from "@/lib/native-notifications";
import { toLocalPhone } from "@/lib/phone";
import { CATEGORY_COLOR_CHOICES } from "@/lib/presets";
import { uid } from "@/lib/store";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/settings")({
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

// ۹ خانه در شبکهٔ ۳×۳: «پیش‌فرض» (نارنجی برند) + ۷ رنگ + چرخ رنگ دلخواه که
// دقیقاً وسط شبکه می‌نشیند (بین ۴ رنگ اول و ۴ خانهٔ بعدی رندر می‌شود).
const BRAND_COLORS = [
  "",
  "#EF4444",
  "#EAB308",
  "#22C55E",
  "#06B6D4",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
];

type DisplayPermission =
  "checking" | "unsupported" | "granted" | "denied" | "prompt" | "prompt-with-rationale";

function SettingsPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [journalTimeOpen, setJournalTimeOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [catExpanded, setCatExpanded] = useState(false);
  const [legalExpanded, setLegalExpanded] = useState(false);
  const [catName, setCatName] = useState("");
  const [catIcon, setCatIcon] = useState("star");
  const [catColor, setCatColor] = useState(CATEGORY_COLOR_CHOICES[0]);
  const [deleteCat, setDeleteCat] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [displayPermission, setDisplayPermission] = useState<DisplayPermission>("checking");
  const [exactAlarm, setExactAlarm] = useState<NativeExactAlarmState>("not-android");
  const refreshNotificationStatus = useCallback(async () => {
    const nativePermission = await checkNativeNotificationPermission();
    if (nativePermission === "web") {
      setDisplayPermission(
        typeof Notification === "undefined"
          ? "unsupported"
          : Notification.permission === "default"
            ? "prompt"
            : Notification.permission,
      );
      setExactAlarm("not-android");
      return;
    }
    setDisplayPermission(nativePermission);
    setExactAlarm(await checkNativeExactAlarmSetting());
  }, []);

  useEffect(() => {
    void refreshNotificationStatus();
    const onForeground = () => {
      if (document.visibilityState === "visible") void refreshNotificationStatus();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [refreshNotificationStatus]);

  if (!ctx?.db) return null;
  const { db, update, updatePreferences, resetSyncedContent, signOutLocal, t, lang, cal } = ctx;

  // Export the whole local DB to a file the user keeps.
  // Native: Android's WebView silently drops blob downloads (the click
  // "succeeds", no file appears), so use the share sheet instead — the user
  // picks where the file goes. Web: normal download. Last resort: clipboard.
  const exportData = async () => {
    if (isNative()) {
      try {
        await shareBackupNative(db);
        return; // the share sheet is its own confirmation
      } catch {
        /* plugin unavailable or user storage issue — try the paths below */
      }
    } else if (downloadBackup(db)) {
      toast.success(t("فایل پشتیبان دانلود شد", "Backup file downloaded"));
      return;
    }
    const copied = await copyBackupToClipboard(db);
    if (copied) toast.success(t("نسخهٔ پشتیبان در کلیپ‌بورد کپی شد", "Backup copied to clipboard"));
    else toast.error(t("تهیهٔ پشتیبان ناموفق بود", "Backup failed"));
  };

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!canImportBackup(db)) {
      e.target.value = "";
      toast.error(t("بازیابی فقط با اشتراک پولی فعال است", "Import requires an active paid plan"));
      return;
    }
    const file = e.target.files?.[0];
    e.target.value = ""; // let the user re-pick the same file after a cancel
    if (!file) return;
    try {
      setPendingImport(parseBackup(await file.text()));
    } catch {
      toast.error(t("این فایل یک پشتیبان معتبر روتینو نیست", "This isn't a valid Routino backup"));
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    if (!canImportBackup(db)) {
      setPendingImport(null);
      toast.error(
        t(
          "اشتراک پولی فعال نیست؛ بازیابی انجام نشد",
          "Import was blocked because there is no active paid plan",
        ),
      );
      return;
    }
    const accepted = update((d) => restoreDb(d, pendingImport));
    setPendingImport(null);
    if (!accepted) return;
    toast.success(t("اطلاعاتت بازگردانی شد", "Your data was restored"));
  };

  const confirmWipe = () => {
    resetSyncedContent();
    setWipeOpen(false);
    toast.success(t("همهٔ داده‌ها پاک شد", "All data was erased"));
  };

  const s = db.settings;
  // «اشتراک پولی» = اشتراک فعالِ غیرآزمایشی. بازیابی اطلاعات فقط برای این‌ها باز است؛
  // در اشتراک رایگان/آزمایشی قفل می‌ماند تا کاربر ارتقا بدهد.
  const paidActive = canImportBackup(db);
  // رنگ دلخواه = رنگی که در لیست پیش‌فرض‌ها نیست.
  const isCustomBrand = !!s.brandColor && !BRAND_COLORS.includes(s.brandColor);
  const notificationsActive = notificationDeliveryActive(s.notificationsEnabled, displayPermission);

  const requestNotifs = async () => {
    if (notificationsActive) {
      updatePreferences({ notificationsEnabled: false });
      return;
    }
    // Preserve user intent even if the OS currently denies delivery. The
    // visible switch remains off until permission is actually available.
    updatePreferences({ notificationsEnabled: true });
    const granted = await requestNotificationPermission();
    setDisplayPermission(granted ? "granted" : "denied");
    if (isNativeRuntime()) {
      if (granted) {
        let exact = await checkNativeExactAlarmSetting();
        if (exact !== "granted" && exact !== "not-android") {
          exact = await requestNativeExactAlarmSetting();
        }
        setExactAlarm(exact);
        if (exact !== "granted" && exact !== "not-android") {
          toast.warning(
            t(
              "اعلان‌ها فعال‌اند، اما دقت دقیقه‌ای در تنظیمات گوشی بسته است.",
              "Notifications are enabled, but minute-precise alarms are disabled in device settings.",
            ),
          );
        }
      }
    }
    if (!granted) {
      toast.error(
        t(
          "مجوز اعلان بسته است؛ از تنظیمات مرورگر یا گوشی فعالش کن.",
          "Notification permission is blocked. Enable it in browser or device settings.",
        ),
      );
      return;
    }
    updatePreferences({ notificationsEnabled: true });
  };

  const addCategory = () => {
    if (!catName.trim()) return;
    update((d) => ({
      ...d,
      categories: [
        ...d.categories,
        {
          id: uid(),
          nameFa: catName.trim(),
          nameEn: catName.trim(),
          color: catColor,
          icon: catIcon,
          isDefault: false,
        },
      ],
    }));
    setCatName("");
    setCatIcon("star");
    setCatColor(CATEGORY_COLOR_CHOICES[0]);
    setCatFormOpen(false);
  };

  const confirmDeleteCategory = () => {
    if (!deleteCat) return;
    const id = deleteCat.id;
    update((d) => ({
      ...d,
      categories: d.categories.filter((c) => c.id !== id),
      // habits keep their categoryId even if the category is gone; they'll
      // show with a neutral fallback icon/color until re-assigned or the
      // category is re-added (e.g. via presets), matching prior behavior.
    }));
    setDeleteCat(null);
  };

  return (
    <div className="page-stagger flex flex-col gap-4">
      {/* account: profile + username/password together, at the very top */}
      <AccountCard />

      {/* language + calendar */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Globe className="h-3.5 w-3.5 text-primary" /> {t("زبان", "Language")}
          </div>
          <div className="flex flex-col gap-1.5">
            {(["fa", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => updatePreferences({ lang: l })}
                className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.lang === l
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {l === "fa" ? "فارسی" : "English"}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-primary" /> {t("تقویم", "Calendar")}
          </div>
          <div className="flex flex-col gap-1.5">
            {(["jalali", "gregorian"] as const).map((c) => (
              <button
                key={c}
                onClick={() => updatePreferences({ calendar: c })}
                className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.calendar === c
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {c === "jalali" ? t("شمسی", "Jalali") : t("میلادی", "Gregorian")}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* theme + brand color */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Sun className="h-3.5 w-3.5 text-primary" /> {t("تم", "Theme")}
          </div>
          <div className="flex flex-col gap-1.5">
            {(["light", "dark"] as const).map((th) => (
              <button
                key={th}
                onClick={() => updatePreferences({ theme: th })}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.theme === th
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {th === "light" ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
                {th === "light" ? t("روشن", "Light") : t("تاریک", "Dark")}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Palette className="h-3.5 w-3.5 text-primary" /> {t("رنگ برند", "Brand")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_COLORS.map((c) => (
              <button
                key={c || "default"}
                onClick={() => updatePreferences({ brandColor: c })}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[7px] font-bold text-white transition-transform ${
                  s.brandColor === c
                    ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : ""
                }`}
                style={{ backgroundColor: c || "#F97316" }}
              >
                {c === "" ? t("پیش‌فرض", "def") : ""}
              </button>
            ))}
            {/* رنگ دلخواه: با زدن، چرخ رنگ داخل اپ باز می‌شود (نه انتخابگر سیستم). */}
            <button
              type="button"
              onClick={() => setColorWheelOpen(true)}
              title={t("رنگ دلخواه", "Custom color")}
              className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full transition-transform ${
                isCustomBrand
                  ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card"
                  : ""
              }`}
              style={{
                background: isCustomBrand
                  ? s.brandColor
                  : "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
              }}
            >
              {!isCustomBrand && (
                <Plus className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />
              )}
            </button>
          </div>
        </Card>
      </div>

      {/* categories */}
      <Card className="!p-0 overflow-hidden">
        <button
          onClick={() => setCatExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Tags className="h-4 w-4 text-primary" /> {t("دسته‌بندی‌های عادت", "Habit categories")}
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {faNum(db.categories.length, lang)}
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${catExpanded ? "rotate-180" : ""}`}
          />
        </button>
        {catExpanded && (
          <div className="border-t border-border p-4 pt-3">
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {db.categories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl border border-border p-2"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: c.color }}
                  >
                    <CatIcon icon={c.icon} className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    {lang === "fa" ? c.nameFa : c.nameEn}
                  </span>
                  <button
                    onClick={() =>
                      setDeleteCat({ id: c.id, name: lang === "fa" ? c.nameFa : c.nameEn })
                    }
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setCatFormOpen(true)}
              className="mb-2 w-full rounded-xl border border-dashed border-border py-2 text-xs font-bold text-primary hover:bg-secondary"
            >
              + {t("دسته جدید", "New category")}
            </button>
            <p className="text-[10px] text-muted-foreground">
              {t(
                "دسته‌بندی‌های پیش‌فرض حذف‌شده، با اضافه‌کردن یک عادت آماده از همون دسته دوباره برمی‌گردن.",
                "Deleted default categories come back automatically when you add a preset habit from that category again.",
              )}
            </p>
          </div>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Bell className="h-4 w-4 text-primary" /> {t("نوتیفیکیشن‌ها", "Notifications")}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notificationsActive}
            aria-label={t("فعال‌سازی اعلان‌ها", "Enable notifications")}
            onClick={requestNotifs}
            className={`relative h-6 w-11 rounded-full transition-colors ${notificationsActive ? "bg-primary" : "bg-secondary"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                notificationsActive ? "start-5.5" : "start-0.5"
              }`}
            />
          </button>
        </div>
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Volume2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-foreground">
                  {t("صدای تکمیل", "Completion sound")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {t(
                    "صدای کوتاه فقط بعد از انجام موفق",
                    "A short cue after a successful completion",
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.completionSoundEnabled}
              aria-label={t("فعال‌سازی صدای تکمیل", "Enable completion sound")}
              onClick={() =>
                updatePreferences({ completionSoundEnabled: !s.completionSoundEnabled })
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.completionSoundEnabled ? "bg-primary" : "bg-secondary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.completionSoundEnabled ? "start-5.5" : "start-0.5"}`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Vibrate className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-foreground">
                  {t("بازخورد لمسی", "Haptic feedback")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {t("روی گوشی‌های سازگار", "On supported phones")}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.hapticsEnabled}
              aria-label={t("فعال‌سازی بازخورد لمسی", "Enable haptic feedback")}
              onClick={() => updatePreferences({ hapticsEnabled: !s.hapticsEnabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${s.hapticsEnabled ? "bg-primary" : "bg-secondary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.hapticsEnabled ? "start-5.5" : "start-0.5"}`}
              />
            </button>
          </div>
        </div>
        {notificationsActive && exactAlarm !== "not-android" && exactAlarm !== "granted" && (
          <button
            type="button"
            className="mt-2 text-xs font-bold text-primary"
            onClick={async () => {
              const status = await requestNativeExactAlarmSetting();
              setExactAlarm(status);
            }}
          >
            {t(
              "فعال‌کردن دقت دقیقه‌ای در تنظیمات گوشی",
              "Enable minute-precise alarms in device settings",
            )}
          </button>
        )}
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("ساعت یادآوری ژورنال", "Journal reminder time")}
          </p>
          <button
            onClick={() => setJournalTimeOpen(true)}
            className="w-full rounded-xl border border-border px-3 py-2.5 text-center text-sm font-bold text-foreground hover:bg-secondary"
            dir="ltr"
          >
            {s.journalReminder || t("تنظیم نشده", "Not set")}
          </button>
        </div>

        {/* نظر دادن، هر وقت خودِ کاربر خواست. پاپ‌آپ خودکار حالا حداکثر روزی
            یک‌بار می‌آید (`FEEDBACK_INTERVAL` در AppShell)، پس بدون این دکمه کسی
            که همان لحظه حرفی دارد باید منتظر بماند تا برنامه از او بپرسد. */}
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground">
                {t("نظرت درباره روتینو", "Your feedback on Routino")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t(
                  "هر وقت حرفی داشتی، همین‌جا بگو.",
                  "Tell us any time you have something to say.",
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 px-3 py-2 text-xs"
              onClick={() => setFeedbackOpen(true)}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {t("نظر بده", "Send")}
            </Button>
          </div>
        </div>
      </Card>

      <FeedbackModal open={feedbackOpen} onDone={() => setFeedbackOpen(false)} />

      {/* journal reminder time modal */}
      <Modal
        open={journalTimeOpen}
        onClose={() => setJournalTimeOpen(false)}
        title={t("ساعت یادآوری ژورنال", "Journal reminder time")}
      >
        <div className="flex flex-col gap-4">
          <TimePicker24
            value={s.journalReminder ?? "21:00"}
            onChange={(v) => {
              if (
                !update((d) => ({
                  ...d,
                  settings: { ...d.settings, journalReminder: v },
                }))
              )
                setJournalTimeOpen(false);
            }}
            lang={lang}
            t={t}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                update((d) => ({ ...d, settings: { ...d.settings, journalReminder: null } }));
                setJournalTimeOpen(false);
              }}
            >
              {t("حذف یادآوری", "Remove reminder")}
            </Button>
            <Button className="flex-1" onClick={() => setJournalTimeOpen(false)}>
              {t("تایید", "Done")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* custom brand colour wheel */}
      <Modal
        open={colorWheelOpen}
        onClose={() => setColorWheelOpen(false)}
        title={t("رنگ دلخواه برند", "Custom brand color")}
      >
        <div className="flex flex-col items-center gap-5">
          <ColorWheel
            value={s.brandColor || "#F97316"}
            onChange={(hex) => updatePreferences({ brandColor: hex })}
          />
          <div className="flex w-full gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => updatePreferences({ brandColor: "" })}
            >
              {t("پیش‌فرض", "Default")}
            </Button>
            <Button className="flex-1" onClick={() => setColorWheelOpen(false)}>
              {t("تمام", "Done")}
            </Button>
          </div>
        </div>
      </Modal>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Archive className="h-4 w-4 text-primary" />{" "}
          {t("پشتیبان‌گیری و بازیابی", "Backup & restore")}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t(
            "اطلاعاتت روی دستگاه و فضای ابری حسابت همگام می‌شود. برای داشتن یک نسخهٔ مستقل، فایل پشتیبان را هم در جای امن نگه دار.",
            "Your data syncs between this device and your account cloud. Keep an exported backup as an independent copy too.",
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={exportData}>
            <Download className="h-4 w-4" /> {t("گرفتن پشتیبان", "Export")}
          </Button>
          <Button
            variant="secondary"
            disabled={!paidActive}
            onClick={() => fileRef.current?.click()}
          >
            {paidActive ? <Upload className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{" "}
            {t("بازیابی", "Import")}
          </Button>
        </div>
        {/* بازیابی داده‌ها فقط برای اشتراک پولی — در اشتراک رایگان قفل است */}
        {!paidActive && (
          <Link
            to="/subscribe"
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-[11px] font-bold text-primary"
          >
            <Lock className="h-3.5 w-3.5" />
            {t(
              "بازیابی اطلاعات فقط برای اشتراک پولی فعال است",
              "Restoring data is available on paid plans only",
            )}
          </Link>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onFilePicked}
        />
      </Card>

      {/* danger zone: sign out + erase everything, together in one red box */}
      <Card className="flex flex-col gap-3 border-destructive/40 bg-destructive/5">
        <div className="flex items-center gap-2 text-sm font-bold text-destructive">
          <AlertTriangle className="h-4 w-4" /> {t("منطقهٔ خطر", "Danger zone")}
        </div>

        {/* sign out */}
        <Button
          variant="secondary"
          className="w-full justify-center text-destructive"
          onClick={() => setSignOutOpen(true)}
        >
          <LogOut className="h-4 w-4" /> {t("خروج از حساب", "Sign out")}
        </Button>

        <div className="h-px bg-destructive/20" />

        {/* Explicit synced-account content reset; account and entitlement survive. */}
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t(
            "همهٔ عادت‌ها، ثبت‌ها، کارها، ژورنال و تاریخچهٔ تایمر از حساب همگام‌شده پاک می‌شود و این حذف به دستگاه‌های دیگرت هم می‌رسد. خود حساب و اشتراک باقی می‌ماند.",
            "Erases habits, logs, tasks, journal entries and timer history from your synced account and propagates the deletion to your other devices. Your account and subscription remain.",
          )}
        </p>
        <Button variant="destructive" onClick={() => setWipeOpen(true)}>
          <Trash2 className="h-4 w-4" /> {t("پاک کردن همهٔ داده‌ها", "Erase all data")}
        </Button>
      </Card>

      {/* sign-out confirm — one stray tap used to sign the user straight out */}
      <Modal
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title={t("خروج از حساب", "Sign out")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t(
              "اطلاعاتت روی این دستگاه می‌مونه و با ورود دوباره‌ی همین حساب برمی‌گرده. ورود با حساب دیگر، فضای جداگانه‌ای باز می‌کند و چیزی را پاک نمی‌کند.",
              "Your data stays on this device and returns when this account signs in again. Another account opens a separate local space and deletes nothing.",
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                setSignOutOpen(false);
                // Stateless sign-out is local-only and always works offline.
                void logout();
                signOutLocal();
                navigate({ to: "/auth" });
              }}
            >
              {t("آره، خارج شو", "Yes, sign out")}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setSignOutOpen(false)}>
              {t("انصراف", "Cancel")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* wipe confirm */}
      <Modal
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title={t("پاک کردن همهٔ داده‌ها", "Erase all data")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t(
              `${faNum(db.habits.length, lang)} عادت، ${faNum(Object.keys(db.logs).length, lang)} ثبت و ${faNum(Object.keys(db.journal).length, lang)} روز ژورنال از حساب همگام‌شده و همهٔ دستگاه‌ها برای همیشه پاک می‌شوند. این حذف، حذف حساب نیست. مطمئنی؟`,
              `${db.habits.length} habits, ${Object.keys(db.logs).length} logs and ${Object.keys(db.journal).length} journal days will be erased permanently from the synced account and all devices. This does not delete the account. Continue?`,
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={confirmWipe}>
              {t("آره، همه رو پاک کن", "Yes, erase everything")}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setWipeOpen(false)}>
              {t("انصراف", "Cancel")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* restore confirm — restoring REPLACES current data, so ask first */}
      <Modal
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        title={t("بازیابی اطلاعات", "Restore data")}
      >
        {pendingImport && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t(
                "این فایل جایگزین محتوای فعلی حساب همگام‌شده می‌شود و تغییر به دستگاه‌های دیگرت هم می‌رسد. ادامه می‌دهی؟",
                "This file replaces the current synced-account content and the change reaches your other devices. Continue?",
              )}
            </p>
            <div className="rounded-xl border border-border p-3 text-[11px] leading-6 text-foreground">
              <p>
                {t("تاریخ پشتیبان", "Backup date")}:{" "}
                <span dir="ltr">
                  {formatDate(dateKey(new Date(pendingImport.exportedAt)), cal, lang)}
                </span>
              </p>
              <p>
                {faNum(backupSummary(pendingImport.db).habits, lang)} {t("عادت", "habits")} ·{" "}
                {faNum(backupSummary(pendingImport.db).logs, lang)} {t("ثبت", "logs")} ·{" "}
                {faNum(backupSummary(pendingImport.db).journal, lang)} {t("ژورنال", "journal")}
              </p>
            </div>
            {pendingImport.db.auth?.phone &&
              db.auth?.phone &&
              pendingImport.db.auth.phone !== db.auth.phone && (
                <p className="rounded-xl bg-destructive/10 p-3 text-[11px] leading-5 text-destructive">
                  {t(
                    `⚠️ این پشتیبان مال شمارهٔ ${faNum(toLocalPhone(pendingImport.db.auth.phone), lang)} است، نه حساب فعلی.`,
                    `⚠️ This backup belongs to ${toLocalPhone(pendingImport.db.auth.phone)}, not the current account.`,
                  )}
                </p>
              )}
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={confirmImport}>
                {t("بازیابی و جایگزینی", "Restore")}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => setPendingImport(null)}>
                {t("انصراف", "Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* قوانین، حریم خصوصی و تماس — یک بخش بازشو */}
      <Card className="!p-0 overflow-hidden">
        <button
          onClick={() => setLegalExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <FileText className="h-4 w-4 text-primary" />{" "}
            {t("قوانین، حریم خصوصی و تماس", "Terms, Privacy & Contact")}
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${legalExpanded ? "rotate-180" : ""}`}
          />
        </button>
        {legalExpanded && (
          <div className="border-t border-border p-4">
            <LegalContent />
          </div>
        )}
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        {t("روتینو نسخه 1.0 - آفلاین فرست", "Routino v1.0 · offline-first")}
      </p>

      {/* new category modal */}
      <Modal
        open={catFormOpen}
        onClose={() => setCatFormOpen(false)}
        title={t("دسته‌بندی جدید", "New category")}
      >
        <div className="flex flex-col gap-4">
          <Input
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder={t("نام دسته", "Category name")}
          />

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("آیکون", "Icon")}</p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(CATEGORY_ICONS).map((iconKey) => (
                <button
                  key={iconKey}
                  onClick={() => setCatIcon(iconKey)}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                    catIcon === iconKey
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <CatIcon icon={iconKey} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("رنگ", "Color")}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCatColor(c)}
                  className={`h-8 w-8 rounded-full transition-transform ${
                    catColor === c
                      ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <Button onClick={addCategory} disabled={!catName.trim()}>
            {t("ساخت دسته", "Create category")}
          </Button>
        </div>
      </Modal>

      {/* delete category confirm */}
      <Modal
        open={!!deleteCat}
        onClose={() => setDeleteCat(null)}
        title={t("حذف دسته‌بندی", "Delete category")}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {t(
            `«${deleteCat?.name}» حذف بشه؟ عادت‌های داخلش می‌مونن ولی بدون دسته می‌شن.`,
            `Delete "${deleteCat?.name}"? Habits in it will remain but become uncategorized.`,
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="destructive" className="flex-1" onClick={confirmDeleteCategory}>
            {t("حذف", "Delete")}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeleteCat(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Password input with a show/hide eye toggle — one of the biggest usability
 * wins for a non-technical user setting a password they can't otherwise see.
 */
function PwInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        dir="ltr"
        type={show ? "text" : "password"}
        className="pe-10"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        className="absolute inset-y-0 end-2 flex items-center text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * Account card: the profile (phone, plan) AND username/password management,
 * together at the very top of settings.
 *
 * Credential state is read from the server on mount (offline just disables the
 * manage button). Setting the first password needs no current password — the
 * session token is proof; changing an existing one requires it. This is what
 * lets a user who signed in by SMS switch to password-only sign-in afterwards.
 */
function AccountCard() {
  const ctx = useAppMaybe();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [uname, setUname] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busyU, setBusyU] = useState(false);
  const [busyP, setBusyP] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetchAccount()
      .then((a) => {
        if (!alive) return;
        setAccount(a);
        setUname(a.username ?? "");
      })
      .catch(() => alive && setOffline(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!ctx?.db) return null;
  const { db, t, lang, cal } = ctx;

  const explain = (e: unknown): string => {
    if (!(e instanceof ApiError))
      return t("یه مشکلی پیش اومد. دوباره تلاش کن.", "Something went wrong. Try again.");
    if (e.offline)
      return t("برای این کار به اینترنت نیاز داری.", "This needs an internet connection.");
    switch (e.code) {
      case "invalid_username":
        return t(
          "نام کاربری باید ۳ تا ۲۴ حرف باشه، با حرف شروع شه (a–z، ۰–۹، _ .)",
          "Username must be 3–24 chars, start with a letter (a–z, 0–9, _ .)",
        );
      case "username_taken":
        return t("این نام کاربری قبلاً گرفته شده.", "That username is already taken.");
      case "username_reserved":
        return t("این نام کاربری رزرو شده و قابل انتخاب نیست.", "That username is reserved.");
      case "wrong_password":
        return t("رمز عبور فعلی اشتباهه.", "Current password is wrong.");
      case "weak_password":
        return t(
          "رمز باید حداقل ۸ کاراکتر و شامل حرف و عدد باشه.",
          "Password must be 8+ chars with a letter and a digit.",
        );
      case "rate_limited":
        return t(
          "تلاش زیاد بود. کمی بعد دوباره امتحان کن.",
          "Too many attempts. Try again shortly.",
        );
      default:
        return e.message;
    }
  };

  const saveUsername = async () => {
    if (!uname.trim()) return;
    setErr("");
    setBusyU(true);
    try {
      const res = await setUsername(uname.trim());
      setAccount((a) => (a ? { ...a, username: res.username } : a));
      setUname(res.username);
      toast.success(t("نام کاربری ذخیره شد", "Username saved"));
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusyU(false);
    }
  };

  const savePassword = async () => {
    if (!newPw) return;
    setErr("");
    setBusyP(true);
    try {
      await setPassword(newPw, account?.hasPassword ? curPw : undefined);
      setAccount((a) => (a ? { ...a, hasPassword: true } : a));
      setCurPw("");
      setNewPw("");
      toast.success(t("رمز عبور ذخیره شد", "Password saved"));
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusyP(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      {/* profile: avatar + phone + username chip + plan */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">
          {db.auth?.phone.slice(-2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-foreground" dir="ltr">
              {faNum(db.auth?.phone ? toLocalPhone(db.auth.phone) : "", lang)}
            </p>
            {account?.username && (
              <span
                dir="ltr"
                className="max-w-[45%] truncate rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
              >
                @{account.username}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {db.subscription
              ? t(
                  `اشتراک تا ${formatDate(dateKey(new Date(db.subscription.expiresAt)), cal, lang)}`,
                  `Subscribed until ${formatDate(dateKey(new Date(db.subscription.expiresAt)), cal, lang)}`,
                ) + (db.subscription.trial ? t(" (آزمایشی)", " (trial)") : "")
              : t("بدون اشتراک", "No subscription")}
          </p>
        </div>
        <Link
          to="/subscribe"
          className="shrink-0 rounded-xl bg-primary-soft px-3 py-2 text-xs font-bold text-primary"
        >
          {t("تمدید", "Renew")}
        </Link>
      </div>

      {/* username + password — right here in the profile card */}
      <button
        type="button"
        onClick={() => (setErr(""), setOpen(true))}
        disabled={!account}
        className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-start transition-colors hover:bg-secondary disabled:opacity-60"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" />{" "}
          {t("نام کاربری و رمز عبور", "Username & password")}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {offline
            ? t("آفلاین", "offline")
            : account
              ? account.hasPassword
                ? t("رمز فعال ✓", "password ✓")
                : t("رمز تنظیم نشده", "no password")
              : "…"}
          <ChevronLeft className="h-4 w-4" />
        </span>
      </button>

      {account && !account.hasPassword && !offline && (
        <p className="rounded-xl bg-primary-soft p-2.5 text-[11px] leading-5 text-primary">
          {t(
            "یک رمز عبور بذار تا دفعه‌ی بعد بدون پیامک و فقط با رمز وارد شی.",
            "Set a password to sign in next time with just your password, no SMS needed.",
          )}
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("نام کاربری و رمز عبور", "Username & password")}
      >
        <div className="flex flex-col gap-6">
          {/* ── نام کاربری ── */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-foreground">{t("نام کاربری", "Username")}</p>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t(
                "یک نام کاربری بذار تا بتونی به‌جای شماره موبایل با اون وارد شی.",
                "Pick a username so you can sign in with it instead of your phone number.",
              )}
            </p>
            <Input
              dir="ltr"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("مثلاً amir", "e.g. amir")}
              value={uname}
              onChange={(e) => setUname(e.target.value)}
            />
            <Button
              onClick={() => void saveUsername()}
              disabled={busyU || !uname.trim() || uname.trim() === (account?.username ?? "")}
            >
              {busyU ? (
                t("در حال ذخیره…", "Saving…")
              ) : (
                <>
                  <Check className="h-4 w-4" /> {t("ذخیره نام کاربری", "Save username")}
                </>
              )}
            </Button>
          </div>

          <div className="h-px bg-border" />

          {/* ── رمز عبور ── */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-foreground">
              {account?.hasPassword
                ? t("تغییر رمز عبور", "Change password")
                : t("تنظیم رمز عبور", "Set a password")}
            </p>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t(
                "رمز باید حداقل ۸ کاراکتر و شامل حرف و عدد باشه. برای دیدن رمز روی آیکون چشم بزن.",
                "Password must be 8+ characters with a letter and a digit. Tap the eye to reveal it.",
              )}
            </p>
            {account?.hasPassword && (
              <PwInput
                value={curPw}
                onChange={setCurPw}
                placeholder={t("رمز عبور فعلی", "Current password")}
              />
            )}
            <PwInput
              value={newPw}
              onChange={setNewPw}
              placeholder={t("رمز عبور جدید", "New password")}
            />
            <Button
              onClick={() => void savePassword()}
              disabled={busyP || newPw.length < 8 || (!!account?.hasPassword && !curPw)}
            >
              {busyP ? (
                t("در حال ذخیره…", "Saving…")
              ) : (
                <>
                  <Check className="h-4 w-4" /> {t("ذخیره رمز عبور", "Save password")}
                </>
              )}
            </Button>
          </div>

          {err && (
            <p className="rounded-xl bg-destructive/10 p-2.5 text-center text-xs leading-5 text-destructive">
              {err}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
}
