import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, CalendarDays, ChevronDown, Globe, LogOut, Moon, Palette, Plus, Sun, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, CatIcon, CATEGORY_ICONS, Card, ColorWheel, Input, Modal, TimePicker24 } from "@/components/ui";
import { logout } from "@/lib/api/auth";
import { dateKey, faNum, formatDate } from "@/lib/dates";
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
const BRAND_COLORS = ["", "#EF4444", "#EAB308", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899"];

function SettingsPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [journalTimeOpen, setJournalTimeOpen] = useState(false);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [catExpanded, setCatExpanded] = useState(false);
  const [catName, setCatName] = useState("");
  const [catIcon, setCatIcon] = useState("star");
  const [catColor, setCatColor] = useState(CATEGORY_COLOR_CHOICES[0]);
  const [deleteCat, setDeleteCat] = useState<{ id: string; name: string } | null>(null);

  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;
  const s = db.settings;
  // رنگ دلخواه = رنگی که در لیست پیش‌فرض‌ها نیست.
  const isCustomBrand = !!s.brandColor && !BRAND_COLORS.includes(s.brandColor);

  const requestNotifs = () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    update((d) => ({
      ...d,
      settings: { ...d.settings, notificationsEnabled: !d.settings.notificationsEnabled },
    }));
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
      {/* account */}
      <Card className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">
          {db.auth?.phone.slice(-2)}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground" dir="ltr">
            {faNum(db.auth?.phone ? toLocalPhone(db.auth.phone) : "", lang)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {db.subscription
              ? t(
                  `اشتراک تا ${formatDate(dateKey(new Date(db.subscription.expiresAt)), cal, lang)}`,
                  `Subscribed until ${formatDate(dateKey(new Date(db.subscription.expiresAt)), cal, lang)}`,
                ) + (db.subscription.trial ? t(" (آزمایشی)", " (trial)") : "")
              : t("بدون اشتراک", "No subscription")}
          </p>
        </div>
        <Link to="/subscribe" className="rounded-xl bg-primary-soft px-3 py-2 text-xs font-bold text-primary">
          {t("تمدید", "Renew")}
        </Link>
      </Card>

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
                onClick={() => update((d) => ({ ...d, settings: { ...d.settings, lang: l } }))}
                className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.lang === l ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
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
                onClick={() => update((d) => ({ ...d, settings: { ...d.settings, calendar: c } }))}
                className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.calendar === c ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
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
                onClick={() => update((d) => ({ ...d, settings: { ...d.settings, theme: th } }))}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${
                  s.theme === th ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {th === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
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
                onClick={() => update((d) => ({ ...d, settings: { ...d.settings, brandColor: c } }))}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[7px] font-bold text-white transition-transform ${
                  s.brandColor === c ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""
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
                isCustomBrand ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""
              }`}
              style={{
                background: isCustomBrand
                  ? s.brandColor
                  : "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
              }}
            >
              {!isCustomBrand && <Plus className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
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
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${catExpanded ? "rotate-180" : ""}`} />
        </button>
        {catExpanded && (
          <div className="border-t border-border p-4 pt-3">
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {db.categories.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border p-2">
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
                    onClick={() => setDeleteCat({ id: c.id, name: lang === "fa" ? c.nameFa : c.nameEn })}
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
            onClick={requestNotifs}
            className={`relative h-6 w-11 rounded-full transition-colors ${s.notificationsEnabled ? "bg-primary" : "bg-secondary"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                s.notificationsEnabled ? "start-5.5" : "start-0.5"
              }`}
            />
          </button>
        </div>
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
      </Card>

      {/* journal reminder time modal */}
      <Modal open={journalTimeOpen} onClose={() => setJournalTimeOpen(false)} title={t("ساعت یادآوری ژورنال", "Journal reminder time")}>
        <div className="flex flex-col gap-4">
          <TimePicker24
            value={s.journalReminder ?? "21:00"}
            onChange={(v) => update((d) => ({ ...d, settings: { ...d.settings, journalReminder: v } }))}
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
      <Modal open={colorWheelOpen} onClose={() => setColorWheelOpen(false)} title={t("رنگ دلخواه برند", "Custom brand color")}>
        <div className="flex flex-col items-center gap-5">
          <ColorWheel
            value={s.brandColor || "#F97316"}
            onChange={(hex) => update((d) => ({ ...d, settings: { ...d.settings, brandColor: hex } }))}
          />
          <div className="flex w-full gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => update((d) => ({ ...d, settings: { ...d.settings, brandColor: "" } }))}
            >
              {t("پیش‌فرض", "Default")}
            </Button>
            <Button className="flex-1" onClick={() => setColorWheelOpen(false)}>
              {t("تمام", "Done")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* account */}
      <Card className="flex flex-col gap-1">
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive"
          onClick={() => {
            // Clears tokens locally first, then revokes the device server-side
            // on a best-effort basis — signing out must work offline too.
            void logout();
            update((d) => ({ ...d, auth: null }));
            navigate({ to: "/auth" });
          }}
        >
          <LogOut className="h-4 w-4" /> {t("خروج از حساب", "Sign out")}
        </Button>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        {t("روتینو نسخه ۱٫۰ — آفلاین‌فرست با سینک پس‌زمینه", "Routino v1.0 — offline-first with background sync")}
      </p>

      {/* new category modal */}
      <Modal open={catFormOpen} onClose={() => setCatFormOpen(false)} title={t("دسته‌بندی جدید", "New category")}>
        <div className="flex flex-col gap-4">
          <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={t("نام دسته", "Category name")} />

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
                    catColor === c ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""
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
      <Modal open={!!deleteCat} onClose={() => setDeleteCat(null)} title={t("حذف دسته‌بندی", "Delete category")}>
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
