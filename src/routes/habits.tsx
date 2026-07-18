import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { draftToHabit, emptyDraft, habitToDraft, HabitFormModal, type HabitDraft } from "@/components/habits";
import { Button, CatIcon, CATEGORY_ICONS, Chip, EmptyState, Input, Modal, Progress, SectionTitle } from "@/components/ui";
import { faNum, monthTitle, todayKey, type Lang } from "@/lib/dates";
import { earnedBadges, getLog, isCompleted, monthProgress, streak } from "@/lib/logic";
import { CATEGORY_COLOR_CHOICES, DEFAULT_CATEGORIES, PRESET_HABITS, type PresetHabit } from "@/lib/presets";
import { uid, type Category, type Habit, type UnitKind } from "@/lib/store";

const TIME_UNIT_WORDS = ["دقیقه", "ساعت", "min", "hour", "hours", "hr"];
function inferUnitKind(unit: string | undefined): UnitKind {
  if (!unit) return "count";
  return TIME_UNIT_WORDS.some((w) => unit.includes(w)) ? "time" : "count";
}

const HOUR_WORDS = ["ساعت", "hours", "hour"];

/** Seeds the habit form from a preset. Presets carry no id, so the form
 * correctly reads as "new habit" and `saveHabit` creates rather than updates. */
function presetToDraft(p: PresetHabit, categoryId: string, lang: Lang): HabitDraft {
  const unit = lang === "fa" ? p.unitFa : p.unitEn;
  const kind = inferUnitKind(unit);
  return {
    ...emptyDraft(categoryId),
    name: lang === "fa" ? p.nameFa : p.nameEn,
    type: p.type,
    // A draft's target is always MINUTES for time units, but presets state the
    // number in whatever reads naturally ("8 hours", "30 minutes").
    target: kind === "time" && HOUR_WORDS.includes(unit ?? "") ? p.target * 60 : p.target,
    unit: kind === "count" ? (unit ?? "") : "",
    unitKind: kind,
  };
}
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/habits")({
  component: () => (
    <AppShell>
      <HabitsPage />
    </AppShell>
  ),
});

function HabitsPage() {
  const ctx = useAppMaybe();
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<HabitDraft>(emptyDraft("health"));
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetCat, setPresetCat] = useState<string>("morning");
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState(CATEGORY_COLOR_CHOICES[0]);
  const [catIcon, setCatIcon] = useState("star");
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);

  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;

  // فیلترهای ویژه علاوه بر دسته‌ها: انجام‌شده / انجام‌نشدهٔ امروز.
  const TODAY = todayKey();
  const doneToday = (h: Habit) => isCompleted(h, getLog(db, h.id, TODAY));
  const nonArchived = db.habits.filter((h) => !h.archived);
  const habits = nonArchived.filter((h) => {
    if (filterCat === "__done__") return doneToday(h);
    if (filterCat === "__notdone__") return !doneToday(h);
    return !filterCat || h.categoryId === filterCat;
  });
  // فقط دسته‌هایی که حداقل یک عادت دارند در نوار فیلتر نشان داده می‌شوند.
  const usedCatIds = new Set(nonArchived.map((h) => h.categoryId));
  const visibleCats = db.categories.filter((c) => usedCatIds.has(c.id));
  const badges = earnedBadges(db, cal);

  /** Recreate a default category (e.g. "study") if the user deleted it, so
   * presets and habits under it work again. Returns the up-to-date category list. */
  const ensureCategory = (d: typeof db, categoryId: string): Category[] => {
    if (d.categories.some((c) => c.id === categoryId)) return d.categories;
    const fallback = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
    if (!fallback) return d.categories;
    return [...d.categories, fallback];
  };

  const saveHabit = () => {
    const existing = draft.id ? db.habits.find((h) => h.id === draft.id) : undefined;
    const habit = draftToHabit(draft, existing);
    update((d) => ({
      ...d,
      categories: ensureCategory(d, habit.categoryId),
      habits: existing ? d.habits.map((h) => (h.id === habit.id ? habit : h)) : [...d.habits, habit],
    }));
    setFormOpen(false);
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
    setCatFormOpen(false);
  };

  return (
    <div className="page-stagger flex flex-col gap-5">
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setPresetsOpen(true)}>
          <Plus className="h-4 w-4" /> {t("عادت‌های آماده", "Preset habits")}
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            const cat = filterCat && !filterCat.startsWith("__") ? filterCat : "health";
            setDraft(emptyDraft(cat));
            setFormOpen(true);
          }}
        >
          {t("عادت دلخواه", "Custom habit")}
        </Button>
      </div>

      {/* category + status filter — only categories that actually have habits show */}
      <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
        <Chip active={!filterCat} onClick={() => setFilterCat(null)}>
          {t("همه", "All")}
        </Chip>
        <Chip active={filterCat === "__notdone__"} onClick={() => setFilterCat("__notdone__")}>
          {t("انجام‌نشده", "Not done")}
        </Chip>
        <Chip active={filterCat === "__done__"} onClick={() => setFilterCat("__done__")}>
          {t("انجام‌شده", "Done")}
        </Chip>
        {visibleCats.map((c) => (
          <Chip key={c.id} active={filterCat === c.id} color={c.color} onClick={() => setFilterCat(c.id)}>
            <CatIcon icon={c.icon} className="h-3 w-3" />
            {lang === "fa" ? c.nameFa : c.nameEn}
          </Chip>
        ))}
        <Chip onClick={() => setCatFormOpen(true)}>+ {t("دسته جدید", "New category")}</Chip>
      </div>

      {/* achievements summary, grouped by category */}
      <SectionTitle>{t("عادت‌ها و دستاوردها", "Habits & achievements")}</SectionTitle>
      {habits.length === 0 ? (
        <EmptyState emoji="🪴" text={t("عادتی در این دسته نیست.", "No habits in this category.")} />
      ) : (
        <div className="flex flex-col gap-5">
          {db.categories
            .filter((c) => habits.some((h) => h.categoryId === c.id))
            .map((cat) => {
              const catHabits = habits.filter((h) => h.categoryId === cat.id);
              return (
                <section key={cat.id}>
                  <div className="mb-2 flex items-center gap-1.5">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: cat.color }}
                    >
                      <CatIcon icon={cat.icon} className="h-3 w-3" />
                    </span>
                    <p className="text-xs font-bold text-foreground">
                      {lang === "fa" ? cat.nameFa : cat.nameEn}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {catHabits.map((h) => {
                      const mp = monthProgress(db, h, cal);
                      const st = streak(db, h, cal);
                      // hitting the monthly goal recolors the whole card green
                      const reached = mp.percent >= 100;
                      return (
                        <div
                          key={h.id}
                          className={`card-surface p-3 ${reached ? "border-success/60 bg-success/10" : ""}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
                              style={{ backgroundColor: reached ? "var(--success)" : cat.color }}
                            >
                              <CatIcon icon={cat.icon} className="h-3.5 w-3.5" />
                            </span>
                            <Link to="/habit/$habitId" params={{ habitId: h.id }} className="min-w-0 flex-1">
                              <p className={`truncate text-sm font-bold ${reached ? "text-success" : "text-foreground"}`}>
                                {reached && "🏆 "}
                                {h.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {faNum(mp.doneDays, lang)}/{faNum(mp.goalDays, lang)} {t("روز", "days")}
                                {st > 0 && ` · 🔥 ${faNum(st, lang)}`}
                              </p>
                            </Link>
                            <button
                              onClick={() => {
                                setDraft(habitToDraft(h));
                                setFormOpen(true);
                              }}
                              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(h)}
                              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="mt-2.5 flex items-center gap-2">
                            <Progress
                              value={mp.percent}
                              color={reached ? "var(--success)" : cat.color}
                              className="flex-1"
                            />
                            <span
                              className={`shrink-0 text-[10px] font-bold ${reached ? "text-success" : "text-muted-foreground"}`}
                            >
                              {faNum(mp.percent, lang)}٪
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
        </div>
      )}

      {/* badges — one per habit that hit its monthly goal, derived from the logs */}
      <section>
        <SectionTitle>{t("نشان‌ها 🏅", "Badges 🏅")}</SectionTitle>
        {badges.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "وقتی به هدف ماهانه یک عادت برسی، نشانش اینجا اضافه می‌شه.",
              "Reach a habit's monthly goal and its badge shows up here.",
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => {
              const habit = db.habits.find((h) => h.id === b.habitId);
              const badgeCat = db.categories.find((c) => c.id === habit?.categoryId);
              return (
                <div key={b.id} className="card-surface flex items-center gap-2 px-3 py-2">
                  <span className="text-lg">🏆</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-foreground">{b.habitName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {monthTitle(b.monthId, cal, lang)}
                    </span>
                  </span>
                  {badgeCat && (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: badgeCat.color }}
                    >
                      <CatIcon icon={badgeCat.icon} className="h-3 w-3" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* preset picker */}
      <Modal open={presetsOpen} onClose={() => setPresetsOpen(false)} title={t("عادت‌های آماده", "Preset habits")} wide>
        <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {DEFAULT_CATEGORIES.filter((c) => PRESET_HABITS[c.id]).map((c) => {
            // prefer the user's live category (in case they recolored/renamed it) but
            // fall back to the default definition if they deleted it — keeps the
            // preset entry point available so re-adding recreates the category.
            const live = db.categories.find((x) => x.id === c.id) ?? c;
            return (
              <Chip key={c.id} active={presetCat === c.id} color={live.color} onClick={() => setPresetCat(c.id)}>
                <CatIcon icon={live.icon} className="h-3 w-3" />
                {lang === "fa" ? live.nameFa : live.nameEn}
              </Chip>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          {(PRESET_HABITS[presetCat] ?? []).map((p, i) => {
            const name = lang === "fa" ? p.nameFa : p.nameEn;
            const unit = lang === "fa" ? p.unitFa : p.unitEn;
            const alreadyAdded = db.habits.some((h) => !h.archived && h.name === name);
            return (
              // The whole row opens the pre-filled form — same `setDraft` +
              // `setFormOpen` path the pencil button on a habit card uses.
              // Stays clickable when already added: the user may well want a
              // second copy with a different goal.
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDraft(presetToDraft(p, presetCat, lang));
                  setPresetsOpen(false);
                  setFormOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-border p-3 text-start transition-colors hover:bg-secondary active:scale-[0.99]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-foreground">{name}</p>
                    {/* A badge, not a button: without it there is no sign the
                        habit already exists, and duplicates get created. */}
                    {alreadyAdded && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label={t("اضافه شده", "Added")} />
                    )}
                  </div>
                  {p.type === "quantity" && (
                    <p className="text-[10px] text-muted-foreground">
                      {t("هدف:", "Goal:")} {faNum(p.target, lang)} {unit}
                    </p>
                  )}
                </div>
                <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-0 ltr:rotate-180" />
              </button>
            );
          })}
        </div>
      </Modal>

      {/* custom category */}
      <Modal open={catFormOpen} onClose={() => setCatFormOpen(false)} title={t("دسته‌بندی جدید", "New category")}>
        <div className="flex flex-col gap-3">
          <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={t("نام دسته", "Category name")} />

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("آیکون", "Icon")}</p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(CATEGORY_ICONS).map((iconKey) => (
                <button
                  key={iconKey}
                  onClick={() => setCatIcon(iconKey)}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                    catIcon === iconKey ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
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
                  className={`h-8 w-8 rounded-full transition-transform ${catColor === c ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""}`}
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

      {/* delete confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t("حذف عادت", "Delete habit")}>
        <p className="mb-4 text-sm text-muted-foreground">
          {t(`«${deleteTarget?.name}» حذف بشه؟ تاریخچه‌اش هم پاک می‌شه.`, `Delete "${deleteTarget?.name}"? Its history will be removed too.`)}
        </p>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              const id = deleteTarget!.id;
              update((d) => ({
                ...d,
                habits: d.habits.filter((h) => h.id !== id),
                logs: Object.fromEntries(Object.entries(d.logs).filter(([k]) => !k.startsWith(`${id}|`))),
              }));
              setDeleteTarget(null);
            }}
          >
            {t("حذف", "Delete")}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeleteTarget(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>

      <HabitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        draft={draft}
        setDraft={setDraft}
        categories={db.categories}
        onSave={saveHabit}
        t={t}
        lang={lang}
      />
    </div>
  );
}
