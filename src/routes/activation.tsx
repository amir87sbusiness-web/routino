import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { draftToHabit, emptyDraft, HabitFormModal, type HabitDraft } from "@/components/habits";
import { Button, CatIcon } from "@/components/ui";
import {
  clearActivationSelection,
  loadActivationSelection,
  saveActivationSelection,
  type ActivationSelection,
} from "@/lib/activation-selection";
import { entitlementToSubscription, startTrial } from "@/lib/api/auth";
import { ensurePresetCategory, presetToHabitDraft } from "@/lib/habit-starters";
import {
  checkNativeExactAlarmSetting,
  isNativeRuntime,
  requestNativeExactAlarmSetting,
  requestNotificationPermission,
} from "@/lib/native-notifications";
import { PRESET_HABITS, type PresetHabit } from "@/lib/presets";
import type { Habit } from "@/lib/store";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/activation")({
  component: ActivationPage,
});

const STARTERS: Array<{ categoryId: string; preset: PresetHabit }> = [
  { categoryId: "study", preset: PRESET_HABITS.study[0]! },
  { categoryId: "sport", preset: PRESET_HABITS.sport[0]! },
  { categoryId: "sleep", preset: PRESET_HABITS.sleep[0]! },
  { categoryId: "growth", preset: PRESET_HABITS.growth[0]! },
  { categoryId: "health", preset: PRESET_HABITS.health[0]! },
  { categoryId: "morning", preset: PRESET_HABITS.morning[0]! },
];

function validDraft(draft: HabitDraft): boolean {
  return (
    !!draft.name.trim() &&
    draft.weekdays.length > 0 &&
    (draft.type === "binary" || (Number.isFinite(draft.target) && draft.target > 0))
  );
}

function activeHabit(habits: Habit[], selection: ActivationSelection): Habit | null {
  if (selection?.kind !== "existing") return null;
  return habits.find((habit) => habit.id === selection.habitId && !habit.archived) ?? null;
}

function selectionIsReady(habits: Habit[], selection: ActivationSelection): boolean {
  return (
    !!activeHabit(habits, selection) || (selection?.kind === "draft" && validDraft(selection.draft))
  );
}

function ActivationPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<ActivationSelection>(() => loadActivationSelection());
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const db = ctx?.db ?? null;
  const existingHabits = useMemo(
    () => (db ? db.habits.filter((habit) => !habit.archived) : []),
    [db],
  );
  const ready = selectionIsReady(existingHabits, selection);

  useEffect(() => {
    if (selection?.kind === "existing" && !activeHabit(existingHabits, selection))
      setSelection(null);
    if (!selection && existingHabits[0])
      setSelection({ kind: "existing", habitId: existingHabits[0].id });
  }, [existingHabits, selection]);

  useEffect(() => {
    if (selection) saveActivationSelection(selection);
  }, [selection]);

  if (!ctx || !db) return null;
  const { updatePreferences, commitTrialActivation, t, lang } = ctx;

  const choosePreset = (categoryId: string, preset: PresetHabit) => {
    setSelection({ kind: "draft", draft: presetToHabitDraft(preset, categoryId, lang) });
    setError("");
  };

  const openCustom = () => {
    setSelection((current) =>
      current?.kind === "draft" ? current : { kind: "draft", draft: emptyDraft("morning") },
    );
    setFormOpen(true);
    setError("");
  };

  const preparedDraft = selection?.kind === "draft" ? selection.draft : emptyDraft("morning");
  const setPreparedDraft = (draft: HabitDraft) => setSelection({ kind: "draft", draft });

  const requestReminderPermission = async (habit: Habit) => {
    if (!habit.reminderTime) return;
    try {
      const granted = await requestNotificationPermission();
      updatePreferences({ notificationsEnabled: true });
      if (!granted) {
        toast.warning(
          t(
            "عادت و دورهٔ آزمایشی شروع شد؛ یادآوری‌ها تا فعال‌کردن مجوز اعلان خاموش‌اند.",
            "Your habit and trial started; reminders stay off until notification permission is enabled.",
          ),
        );
        return;
      }
      if (isNativeRuntime()) {
        const exact = await checkNativeExactAlarmSetting();
        if (exact !== "granted" && exact !== "not-android") await requestNativeExactAlarmSetting();
      }
    } catch {
      toast.warning(
        t(
          "عادت و دورهٔ آزمایشی شروع شد؛ تنظیم یادآوری روی این دستگاه انجام نشد.",
          "Your habit and trial started, but reminders could not be configured on this device.",
        ),
      );
    }
  };

  const start = async () => {
    const existing = activeHabit(existingHabits, selection);
    const draft = selection?.kind === "draft" ? selection.draft : null;
    if (!existing && (!draft || !validDraft(draft))) {
      setError(t("اول یک عادت آماده کن.", "Prepare one habit first."));
      return;
    }

    // Persist before transport: a failed or interrupted online activation never
    // removes the work the person just prepared.
    if (selection) saveActivationSelection(selection);
    setBusy(true);
    setError("");
    try {
      const result = await startTrial();
      const subscription = entitlementToSubscription(result.entitlement);
      if (
        result.entitlement.status !== "active" ||
        result.entitlement.planId !== "trial" ||
        !subscription?.trial ||
        subscription.expiresAt <= Date.now()
      ) {
        throw new Error("trial_not_active");
      }

      const newHabit = draft ? draftToHabit(draft) : null;
      const newCategory = newHabit
        ? ensurePresetCategory(db.categories, newHabit.categoryId).find(
            (category) =>
              !db.categories.some((existingCategory) => existingCategory.id === category.id),
          )
        : undefined;
      commitTrialActivation(subscription, newHabit, newCategory);
      clearActivationSelection();
      await requestReminderPermission(newHabit ?? existing!);
      navigate({ to: "/" });
    } catch {
      setError(
        t(
          "برای شروع دورهٔ آزمایشی به اتصال اینترنت نیاز داری. عادتت محفوظ است؛ دوباره تلاش کن.",
          "A connection is needed to start your trial. Your habit is saved here; try again.",
        ),
      );
      toast.error(
        t("شروع دورهٔ آزمایشی انجام نشد؛ دوباره تلاش کن.", "Trial did not start. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const selectedExisting = activeHabit(existingHabits, selection);
  return (
    <main className="flex min-h-screen bg-background px-5 py-screen-safe">
      <section className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 py-8">
        <div className="text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-black text-foreground">
            {t("با یک عادت شروع کنیم", "Start with one habit")}
          </h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {t(
              "یک شروع کوچک انتخاب کن تا ۷ روز آینده از همان امروز قابل استفاده باشد.",
              "Choose one small start so your next 7 days are useful from today.",
            )}
          </p>
        </div>

        {existingHabits.length > 0 && (
          <section className="card-surface p-4">
            <p className="text-sm font-bold text-foreground">
              {t("از عادت آماده‌ات استفاده کن", "Use a habit already prepared")}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {existingHabits.map((habit) => (
                <button
                  key={habit.id}
                  type="button"
                  onClick={() => setSelection({ kind: "existing", habitId: habit.id })}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-start text-sm font-bold transition-colors ${
                    selectedExisting?.id === habit.id
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-foreground hover:bg-secondary"
                  }`}
                >
                  {habit.name}
                  {selectedExisting?.id === habit.id && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <p className="mb-2 text-sm font-bold text-foreground">
            {t("یا یک شروع ساده انتخاب کن", "Or pick a simple starter")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STARTERS.map(({ categoryId, preset }) => {
              const selected =
                selection?.kind === "draft" &&
                selection.draft.name === (lang === "fa" ? preset.nameFa : preset.nameEn);
              const category = db.categories.find((item) => item.id === categoryId);
              return (
                <button
                  key={`${categoryId}-${preset.nameEn}`}
                  type="button"
                  onClick={() => choosePreset(categoryId, preset)}
                  className={`rounded-2xl border p-3 text-start transition-colors ${
                    selected
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-card hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {category && <CatIcon icon={category.icon} className="h-3.5 w-3.5" />}
                    {category ? (lang === "fa" ? category.nameFa : category.nameEn) : categoryId}
                  </div>
                  <p className="mt-1 text-sm font-bold text-foreground">
                    {lang === "fa" ? preset.nameFa : preset.nameEn}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <Button variant="secondary" onClick={openCustom}>
          <Plus className="h-4 w-4" />
          {t("ساخت عادت دلخواه", "Create a custom habit")}
        </Button>

        {selection?.kind === "draft" && validDraft(selection.draft) && (
          <p className="rounded-xl bg-secondary px-3 py-2 text-center text-xs font-medium text-muted-foreground">
            {t("آماده برای شروع:", "Ready to start:")} {selection.draft.name}
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <Button className="w-full" disabled={!ready || busy} onClick={() => void start()}>
          {busy ? t("در حال شروع…", "Starting…") : t("شروع ۷ روز رایگان", "Start my 7-day trial")}
        </Button>
      </section>

      <HabitFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        draft={preparedDraft}
        setDraft={setPreparedDraft}
        categories={db.categories}
        onSave={() => {
          if (!validDraft(preparedDraft)) return;
          setFormOpen(false);
        }}
        t={t}
        lang={lang}
      />
    </main>
  );
}
