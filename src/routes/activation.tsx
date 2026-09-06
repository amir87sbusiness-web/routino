import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BarChart3, CalendarDays, Check, ChevronDown, Clock3, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Logo } from "@/components/ui";
import { entitlementToSubscription, startTrial } from "@/lib/api/auth";
import { fetchPlans, type ServerPlan } from "@/lib/api/payments";
import { faNum } from "@/lib/dates";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/activation")({
  component: ActivationPage,
});

type PlansState = "idle" | "loading" | "ready" | "error";

function ActivationPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<ServerPlan[]>([]);
  const [plansState, setPlansState] = useState<PlansState>("idle");
  const startInFlight = useRef(false);
  const plansInFlight = useRef(false);

  if (!ctx?.db) return null;
  const { applyEntitlement, t, lang } = ctx;

  const loadPlans = async () => {
    if (plansState === "ready" || plansInFlight.current) return;
    plansInFlight.current = true;
    setPlansState("loading");
    try {
      const result = await fetchPlans();
      if (!result.plans.length) throw new Error("plans_empty");
      setPlans(result.plans);
      setPlansState("ready");
    } catch {
      setPlansState("error");
    } finally {
      plansInFlight.current = false;
    }
  };

  const start = async () => {
    if (startInFlight.current) return;
    startInFlight.current = true;
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

      applyEntitlement(subscription);
      navigate({ to: "/" });
    } catch {
      setError(t("فعلاً شروع نشد؛ دوباره تلاش کن.", "Could not start yet. Please try again."));
      toast.error(t("شروع دوره انجام نشد.", "The trial could not be started."));
    } finally {
      startInFlight.current = false;
      setBusy(false);
    }
  };

  const features = [
    {
      icon: CalendarDays,
      text: t("کارها و عادت‌ها، یک‌جا", "Tasks and habits together"),
    },
    {
      icon: BarChart3,
      text: t("پیشرفتت را واضح ببین", "See your progress clearly"),
    },
    {
      icon: Clock3,
      text: t("تمرکز و ژورنال روزانه", "Daily focus and journal"),
    },
  ];

  return (
    <main className="min-h-screen bg-background px-5 py-screen-safe">
      <section className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col">
        <header className="flex items-center gap-2 py-1 text-sm font-black text-foreground">
          <Logo className="h-8 w-8" />
          <span>{t("روتینو", "Routino")}</span>
        </header>

        <div className="flex flex-1 flex-col justify-center py-6">
          <div className="mx-auto mb-6 grid h-32 w-32 place-items-center rounded-full bg-primary-soft/55">
            <div className="grid h-24 w-24 place-items-center rounded-full border border-primary/20 bg-card shadow-sm">
              <Logo className="h-16 w-16 shadow-md" />
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-black leading-10 text-foreground">
              {t("هفت روز با روتینو پیش برو", "Try a week with Routino")}
            </h1>
            <p className="mt-1.5 text-sm leading-7 text-muted-foreground">
              {t(
                "همه‌ی امکانات را با برنامه‌ی واقعی خودت امتحان کن.",
                "Use every feature with your real routines.",
              )}
            </p>
          </div>

          <ul
            className="mt-6 overflow-hidden border-y border-border"
            aria-label={t("امکانات روتینو", "Routino features")}
          >
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex min-h-14 items-center gap-3 border-b border-border py-2.5 last:border-b-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="flex-1 text-sm font-bold text-foreground">{text}</span>
                <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-7">
            {error && (
              <p role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                {error}
              </p>
            )}

            <Button className="min-h-14 w-full rounded-2xl text-[15px] font-black shadow-lg shadow-primary/20" disabled={busy} onClick={() => void start()}>
              {busy
                ? t("در حال فعال‌سازی…", "Activating…")
                : error
                  ? t("تلاش دوباره", "Try again")
                  : t("شروع رایگان", "Start free")}
            </Button>
            <p className="mt-2 text-center text-xs leading-6 text-muted-foreground">
              {t("تمام امکانات برای هفت روز فعال می‌شود", "Every feature unlocks for seven days")}
            </p>

            <details
              className="group mt-1"
              onToggle={(event) => {
                if (event.currentTarget.open) void loadPlans();
              }}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 text-xs font-bold text-muted-foreground">
                {t("شرایط ادامه و پلن‌ها", "Plans and what happens next")}
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>

              <div className="rounded-2xl border border-border bg-secondary/45 p-3.5">
                <p className="text-xs leading-6 text-muted-foreground">
                  {t(
                    "بعد از هفت روز، فقط اگر خودت خواستی یکی از پلن‌ها را انتخاب می‌کنی.",
                    "After seven days, you only choose a plan if you want to continue.",
                  )}
                </p>

                {plansState === "loading" && (
                  <p role="status" className="mt-3 text-center text-xs text-muted-foreground">
                    {t("در حال دریافت قیمت‌های به‌روز…", "Loading current prices…")}
                  </p>
                )}

                {plansState === "error" && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-card px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("قیمت‌های به‌روز دریافت نشد.", "Current prices could not be loaded.")}
                    </p>
                    <button type="button" onClick={() => void loadPlans()} className="flex shrink-0 items-center gap-1 text-xs font-bold text-primary">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("تلاش دوباره", "Retry")}
                    </button>
                  </div>
                )}

                {plansState === "ready" && (
                  <div className="mt-3 grid grid-cols-1 gap-2 min-[351px]:grid-cols-3" aria-label={t("پلن‌های روتینو", "Routino plans")}>
                    {plans.map((plan) => (
                      <div key={plan.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 min-[351px]:block min-[351px]:px-1.5 min-[351px]:text-center">
                        <p className="text-[11px] font-bold text-muted-foreground">
                          {lang === "fa" ? plan.nameFa : plan.nameEn}
                        </p>
                        <p className="mt-0 min-[351px]:mt-1 text-xs font-black text-foreground">
                          {faNum(plan.price.toLocaleString("en-US"), lang)} {t("تومان", "Toman")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>
      </section>
    </main>
  );
}
