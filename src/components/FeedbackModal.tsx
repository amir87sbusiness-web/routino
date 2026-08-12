/**
 * فرم «نظرت درباره روتینو؟» — یک جا، دو مصرف‌کننده.
 *
 * دو راه به این فرم می‌رسد و باید دقیقاً یک چیز باشند:
 *  ۱) پاپ‌آپ خودکار در `AppShell` (حداکثر روزی یک‌بار)
 *  ۲) دکمه‌ی «نظرت رو بگو» در تنظیمات، هر وقت کاربر خودش خواست
 *
 * چرا کامپوننت مشترک و نه کپی؟ چون این فرم منطق دارد (امتیاز ۳ و پایین‌تر بخشِ
 * مشکل‌دار را می‌پرسد) و دو نسخه‌ی جدا یعنی بالاخره یکی‌شان عقب می‌ماند.
 *
 * `onDone` همیشه صدا زده می‌شود — چه ثبت بشود چه «بعداً» — چون فراخوان باید در
 * هر دو حالت زمانِ آخرین پرسش را جلو ببرد، وگرنه بستنِ پاپ‌آپ آن را دوباره
 * برمی‌گرداند.
 */
import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { uid } from "@/lib/store";
import { useApp } from "@/state/app";

export function FeedbackModal({
  open,
  onDone,
}: {
  open: boolean;
  /** بعد از ثبت یا رد شدن. `submitted` می‌گوید نظری واقعاً ذخیره شد یا نه. */
  onDone: (submitted: boolean) => void;
}) {
  const { t, update } = useApp();
  const [rating, setRating] = useState(0);
  const [section, setSection] = useState("");
  const [comment, setComment] = useState("");

  const finish = (submitted: boolean) => {
    if (submitted) {
      update((d) => ({
        ...d,
        feedback: [
          {
            id: uid(),
            rating,
            section: rating <= 3 ? section || undefined : undefined,
            comment: comment.trim() || undefined,
            at: Date.now(),
            phone: d.auth?.phone,
          },
          ...d.feedback,
        ],
      }));
    }
    setRating(0);
    setSection("");
    setComment("");
    onDone(submitted);
  };

  return (
    <Modal open={open} onClose={() => finish(false)} title={t("نظرت درباره نوینو؟", "How is Novino?")}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-center gap-2" dir="ltr">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => setRating(s)}
              aria-label={t(`${s} ستاره`, `${s} stars`)}
              aria-pressed={s <= rating}
              className={`text-3xl transition-transform hover:scale-110 ${s <= rating ? "" : "opacity-30 grayscale"}`}
            >
              ⭐
            </button>
          ))}
        </div>
        {rating > 0 && rating <= 3 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("کدوم بخش نیاز به بهبود داره؟", "Which part needs improvement?")}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ["habits", t("عادت‌ها", "Habits")],
                ["tasks", t("کارها", "Tasks")],
                ["journal", t("ژورنال", "Journal")],
                ["analytics", t("آنالیز", "Analytics")],
                ["design", t("ظاهر برنامه", "Design")],
                ["other", t("سایر", "Other")],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    section === key
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("توضیح بیشتر (اختیاری)", "More details (optional)")}
              className="min-h-16 w-full rounded-xl border border-input bg-card p-3 text-sm outline-none focus:border-ring"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={rating === 0} onClick={() => finish(true)}>
            {t("ثبت نظر", "Submit")}
          </Button>
          <Button variant="ghost" onClick={() => finish(false)}>
            {t("بعداً", "Later")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
