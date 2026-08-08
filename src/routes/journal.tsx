import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, Card, SectionTitle } from "@/components/ui";
import { WeekStrip } from "@/components/WeekStrip";
import { faNum, formatDate, todayKey } from "@/lib/dates";
import { MOOD_EMOJIS } from "@/lib/presets";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/journal")({
  component: () => (
    <AppShell>
      <JournalPage />
    </AppShell>
  ),
});

function JournalPage() {
  const ctx = useAppMaybe();
  const [dk, setDk] = useState(todayKey());
  const [text, setText] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const entry = ctx?.db?.journal[dk];

  useEffect(() => {
    setText(entry?.text ?? "");
    setScore(entry?.score ?? null);
    setMood(entry?.mood ?? null);
    setSaved(false);
  }, [dk, entry?.text, entry?.score, entry?.mood]);

  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;

  const save = () => {
    update((d) => ({
      ...d,
      journal: {
        ...d.journal,
        [dk]: { dateKey: dk, text, score, mood, updatedAt: Date.now() },
      },
    }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const journalPercent = (k: string) => {
    const entry = db.journal[k];
    if (!entry || entry.score == null) return null;
    return Math.round((entry.score / 10) * 100);
  };
  const journalEmoji = (k: string) => db.journal[k]?.mood ?? null;
  const journalSubLabel = (k: string) => {
    const entry = db.journal[k];
    if (!entry || entry.score == null) return null;
    return `${faNum(entry.score, lang)}/${faNum(10, lang)}`;
  };

  return (
    <div className="page-stagger flex flex-col gap-5">
      <WeekStrip
        selected={dk}
        onSelect={setDk}
        cal={cal}
        lang={lang}
        percentFor={journalPercent}
        emojiFor={journalEmoji}
        subLabelFor={journalSubLabel}
        disableFuture
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{formatDate(dk, cal, lang)}</p>
        {dk !== todayKey() && (
          <button
            onClick={() => setDk(todayKey())}
            className="text-[10px] font-medium text-primary"
          >
            {t("برو به امروز", "Go to today")}
          </button>
        )}
      </div>

      <Card>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t("حال و احساس امروز", "Today's mood")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_EMOJIS.map((m) => (
            <button
              key={m}
              onClick={() => setMood(mood === m ? null : m)}
              className={`rounded-xl border p-2 text-xl transition-all ${
                mood === m ? "border-primary bg-primary-soft" : "border-border"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t("به امروزت چه نمره‌ای می‌دی؟", "How would you rate your day?")}
        </p>
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setScore(score === n ? null : n)}
              className={`h-9 w-9 rounded-xl border text-sm font-bold transition-all ${
                score === n
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {faNum(n, lang)}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {t("ژورنال امروز", "Today's journal")}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          // Sync refuses a record whose JSON exceeds 8 KB, and a rejected row is
          // one the server never stores — so an unbounded box here is a way to
          // write a journal entry that silently never leaves the device. 4000 is
          // far past any real entry and leaves room for the rest of the record.
          maxLength={4000}
          placeholder={t(
            "امروز چطور گذشت؟ چی یاد گرفتی؟ چی حس کردی؟…",
            "How was your day? What did you learn or feel?…",
          )}
          className="min-h-40 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />
      </Card>

      <Button onClick={save}>{saved ? t("ذخیره شد ✓", "Saved ✓") : t("ذخیره", "Save")}</Button>

      {/* history */}
      <section>
        <SectionTitle>{t("روزهای اخیر", "Recent days")}</SectionTitle>
        <div className="flex flex-col gap-2">
          {Object.values(db.journal)
            .filter((e) => e.text || e.score || e.mood)
            .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
            .slice(0, 14)
            .map((e) => (
              <button
                key={e.dateKey}
                onClick={() => setDk(e.dateKey)}
                className="card-surface flex items-center gap-3 p-3 text-start"
              >
                <span className="text-xl">{e.mood ?? "📓"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(e.dateKey, cal, lang)}
                  </p>
                  <p className="truncate text-xs text-foreground">
                    {e.text || t("بدون یادداشت", "No note")}
                  </p>
                </div>
                {e.score !== null && (
                  <span className="rounded-lg bg-primary-soft px-2 py-1 text-xs font-black text-primary">
                    {faNum(e.score, lang)}/۱۰
                  </span>
                )}
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
