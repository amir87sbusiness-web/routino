import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Logo } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  clearTokens,
  passwordLogin,
  requestOtp,
  verifyOtp,
  type ServerEntitlement,
} from "@/lib/api/auth";
import { faNum } from "@/lib/dates";
import { normalizePhone, toAsciiDigits, toLocalPhone } from "@/lib/phone";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

// ورود واقعی با کد پیامکی. در توسعه، سرور کد را در ترمینال چاپ می‌کند
// (SMS_PROVIDER=console) پس بدون کاوه‌نگار هم قابل تست است.
// فقط برای دموی آفلاین این را true کن — با true هیچ حساب سروری ساخته نمی‌شود
// و خرید اشتراک کار نمی‌کند.
const SKIP_SMS = false;

type Method = "password" | "otp";
type OtpIntent = "signup" | "password_reset";

function AuthPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();

  const [method, setMethod] = useState<Method>("password");
  // password mode
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // otp mode
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [code, setCode] = useState("");
  const [otpIntent, setOtpIntent] = useState<OtpIntent>("signup");
  const [newPassword, setNewPassword] = useState("");
  // shared
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ctx?.db) return null;
  const { db, signInLocal, switchAccount, t, lang } = ctx;

  /** Turns an ApiError into something a Persian-speaking human can act on. */
  const explain = (err: unknown): string => {
    if (!(err instanceof ApiError)) {
      return t("یه مشکلی پیش اومد. دوباره تلاش کن.", "Something went wrong. Try again.");
    }
    if (err.offline) {
      return t(
        "برای ورود به اینترنت نیاز داری. اتصالت رو چک کن.",
        "Signing in needs an internet connection. Check your connection.",
      );
    }
    switch (err.code) {
      case "bad_credentials":
        return t("شماره/نام‌کاربری یا رمز عبور اشتباهه.", "Wrong phone/username or password.");
      case "invalid_phone":
        return t("شماره موبایل معتبر وارد کن (مثل ۰۹۱۲…)", "Enter a valid mobile number (09…)");
      case "rate_limited": {
        const mins = Math.ceil((err.retryAfter ?? 60) / 60);
        return err.retryAfter && err.retryAfter > 60
          ? t(
              `تلاش زیاد بود. ${faNum(mins, lang)} دقیقه دیگه دوباره تلاش کن.`,
              `Too many attempts. Try again in ${mins} min.`,
            )
          : t("یه لحظه صبر کن و دوباره بزن.", "Please wait a moment and try again.");
      }
      case "sms_failed":
        return t("ارسال پیامک ناموفق بود. دوباره تلاش کن.", "Could not send the code. Try again.");
      case "bad_code":
        return t("کد اشتباهه یا منقضی شده.", "The code is wrong or has expired.");
      case "weak_password":
        return t(
          "رمز باید حداقل ۸ کاراکتر و شامل حرف و عدد باشد.",
          "Password must be 8+ characters and include a letter and a number.",
        );
      case "blocked":
        return t("این حساب مسدود شده.", "This account is blocked.");
    }
    // A gateway failure returns no JSON body, so `err.message` falls back to the
    // bare status line and the user was shown the literal text "HTTP 502" — in
    // English, on a Persian sign-in screen, with no hint that waiting would fix
    // it. Production is Cloudflare Worker -> Supabase Edge Function, where a cold
    // start or a brief outage produces exactly that.
    if (err.status >= 500) {
      return t(
        "سرور موقتاً در دسترس نیست. چند لحظه دیگه دوباره تلاش کن.",
        "The server is temporarily unavailable. Try again in a moment.",
      );
    }
    // Any other unmapped status: the server's own message is English and written
    // for a developer, so prefer the generic line unless it is clearly absent.
    return (
      err.message || t("یه مشکلی پیش اومد. دوباره تلاش کن.", "Something went wrong. Try again.")
    );
  };

  /**
   * The post-login tail, shared by password and OTP sign-in.
   *
   * `canonical` is the SERVER's phone (`res.user.phone`), so signing in by
   * username still isolates data by the right account. `switchAccount` selects
   * and hydrates that account's vault before resolving its bounded legacy
   * entitlement migration, so a different active account can never hide the
   * target vault's local proof.
   */
  const completeLogin = async (
    user: { id: string; phone: string },
    serverEntitlement: ServerEntitlement,
  ) => {
    await switchAccount(user, serverEntitlement);
    navigate({ to: "/" });
  };

  const doPasswordLogin = async () => {
    if (!identifier.trim() || !password) {
      setError(
        t("شماره/نام‌کاربری و رمز عبور رو وارد کن.", "Enter your phone/username and password."),
      );
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await passwordLogin(identifier.trim(), password);
      await completeLogin(res.user, res.entitlement);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    const canonical = normalizePhone(phone);
    if (!canonical) {
      setError(t("شماره موبایل معتبر وارد کن (مثل ۰۹۱۲…)", "Enter a valid mobile number (09…)"));
      return;
    }
    setError("");
    if (SKIP_SMS) {
      if (db.meta.dataOwner && db.meta.dataOwner !== canonical) clearTokens();
      // Offline demo mode has no server answer. Preserve semantics are explicit
      // here instead of relying on an omitted production argument.
      signInLocal(canonical, db.subscription);
      navigate({ to: "/" });
      return;
    }
    setBusy(true);
    try {
      await requestOtp(canonical);
      setStep("otp");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const canonical = normalizePhone(phone);
    if (!canonical) {
      setError(t("شماره موبایل معتبر وارد کن (مثل ۰۹۱۲…)", "Enter a valid mobile number (09…)"));
      setStep("phone");
      return;
    }
    if (code.length !== 4) {
      setError(t("کد ۴ رقمی را کامل وارد کن.", "Enter the complete 4-digit code."));
      return;
    }
    if (!newPassword) {
      setError(t("رمز عبور جدید را وارد کن.", "Enter a new password."));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await verifyOtp(canonical, code, { intent: otpIntent, newPassword });
      await completeLogin(res.user, res.entitlement);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const switchToPassword = () => {
    setMethod("password");
    setError("");
    setStep("phone");
    setCode("");
    setNewPassword("");
  };

  const startOtpFlow = (intent: OtpIntent) => {
    setMethod("otp");
    setOtpIntent(intent);
    setError("");
    setStep("phone");
    setCode("");
    setNewPassword("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-screen-safe">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo className="h-16 w-16" />
          <h1 className="text-xl font-black text-foreground">
            {t("ورود به روتینو", "Sign in to Routino")}
          </h1>
          <p className="text-center text-xs text-muted-foreground">
            {method === "password"
              ? t(
                  "با شماره موبایل یا نام کاربری و رمز عبور وارد شو",
                  "Sign in with your phone or username and password",
                )
              : t(
                  otpIntent === "signup"
                    ? "با شماره موبایل و کد پیامکی ثبت‌نام کن"
                    : "با کد پیامکی، مالکیت شماره را تأیید و رمزت را تغییر بده",
                  otpIntent === "signup"
                    ? "Create an account with your phone number and SMS code"
                    : "Verify your phone number by SMS and reset your password",
                )}
          </p>
        </div>

        {method === "password" ? (
          <div className="flex flex-col gap-3">
            <Input
              dir="ltr"
              placeholder={t("شماره موبایل یا نام کاربری", "Phone or username")}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doPasswordLogin()}
              className="text-center text-base"
            />
            <Input
              dir="ltr"
              type="password"
              placeholder={t("رمز عبور", "Password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doPasswordLogin()}
              className="text-center text-base"
            />
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            <Button onClick={() => void doPasswordLogin()} disabled={busy}>
              {busy ? t("در حال ورود…", "Signing in…") : t("ورود", "Sign in")}
            </Button>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => startOtpFlow("signup")} disabled={busy}>
                {t("ثبت‌نام", "Sign up")}
              </Button>
              <Button
                variant="outline"
                onClick={() => startOtpFlow("password_reset")}
                disabled={busy}
              >
                {t("فراموشی رمز عبور", "Forgot password")}
              </Button>
            </div>
          </div>
        ) : step === "phone" ? (
          <div className="flex flex-col gap-3">
            <Input
              dir="ltr"
              inputMode="tel"
              placeholder="09xxxxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendCode()}
              className="text-center text-base tracking-widest"
            />
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            <Button onClick={() => void sendCode()} disabled={busy}>
              {busy
                ? t("در حال ارسال…", "Sending…")
                : SKIP_SMS
                  ? t("ورود", "Sign in")
                  : t("ارسال کد پیامکی", "Send SMS code")}
            </Button>
            <button
              type="button"
              onClick={switchToPassword}
              className="mt-1 text-center text-xs font-medium text-primary hover:underline"
            >
              {t("ورود با رمز عبور", "Sign in with a password")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs text-muted-foreground">
              {t(
                `کد ارسال‌شده به ${faNum(toLocalPhone(normalizePhone(phone) ?? phone), lang)} را وارد کن`,
                `Enter the code sent to ${toLocalPhone(normalizePhone(phone) ?? phone)}`,
              )}
            </p>
            <Input
              dir="ltr"
              inputMode="numeric"
              aria-label={t("کد پیامکی", "SMS code")}
              maxLength={4}
              placeholder="····"
              value={code}
              // Convert Persian digits rather than stripping them: `\d` matches
              // ASCII only, so a plain strip would delete a code typed on a
              // Persian keyboard and leave an empty field.
              onChange={(e) =>
                setCode(toAsciiDigits(e.target.value).replace(/\D/g, "").slice(0, 4))
              }
              onKeyDown={(e) => e.key === "Enter" && void verify()}
              className="text-center text-xl tracking-[0.5em]"
            />
            <Input
              dir="ltr"
              type="password"
              aria-label={t("رمز عبور جدید", "New password")}
              placeholder={t("رمز عبور جدید", "New password")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void verify()}
              className="text-center text-base"
            />
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            <Button
              onClick={() => void verify()}
              disabled={busy || code.length !== 4 || !newPassword}
            >
              {busy
                ? t("در حال بررسی…", "Checking…")
                : otpIntent === "signup"
                  ? t("تکمیل ثبت‌نام", "Complete sign up")
                  : t("تغییر رمز عبور", "Change password")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => (setStep("phone"), setError(""))}
              disabled={busy}
            >
              {t("تغییر شماره", "Change number")}
            </Button>
          </div>
        )}

        {db.auth && (
          <Button variant="ghost" className="mt-4 w-full" onClick={() => navigate({ to: "/" })}>
            {t("بازگشت به برنامه", "Back to app")}
          </Button>
        )}
      </div>
    </div>
  );
}
