/** Install prompt and update notice. Web-only; renders nothing under Capacitor. */
import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import {
  applyNewVersion,
  isInstalled,
  isIos,
  onNewVersion,
  promptInstall,
  watchInstallability,
} from "@/lib/pwa";
import { useAppMaybe } from "@/state/app";

const DISMISS_KEY = "routino:install-dismissed";

/**
 * Offers the new version rather than applying it.
 *
 * Swapping the worker automatically would replace JS chunks under a running app
 * — a user mid-way through logging a habit gets a chunk-load error. Their call,
 * their timing.
 */
export function UpdateWatcher() {
  const ctx = useAppMaybe();
  const t = ctx?.t ?? ((fa: string) => fa);

  useEffect(() => {
    onNewVersion(() => {
      toast(t("نسخه‌ی جدید نوینو آماده‌ست", "A new version of Novino is ready"), {
        duration: Infinity,
        action: {
          label: t("بروزرسانی", "Update"),
          onClick: () => void applyNewVersion(),
        },
      });
    });
  }, [t]);

  return null;
}

/**
 * A dismissible install banner.
 *
 * Two very different paths:
 *  - Chrome/Edge/Android fire `beforeinstallprompt`, so there is a real button.
 *  - iOS has no such event and no programmatic install at all. The only route is
 *    Share → Add to Home Screen, so all we can do is say so.
 */
export function InstallBanner() {
  const ctx = useAppMaybe();
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => watchInstallability(setAvailable), []);

  if (!ctx?.db) return null;
  const { t } = ctx;

  if (isInstalled() || dismissed) return null;
  // Nothing to offer: not installable here, and not an iOS device where manual
  // installation is possible.
  if (!available && !isIos()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const install = async () => {
    if (isIos()) {
      setIosHelp(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") setDismissed(true);
  };

  return (
    <>
      <div className="mx-4 mb-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Download className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-foreground">{t("نوینو رو نصب کن", "Install Novino")}</p>
          <p className="text-[10px] text-muted-foreground">
            {t("سریع‌تر باز می‌شه و بدون اینترنت هم کار می‌کنه", "Opens faster and works without internet")}
          </p>
        </div>
        <Button className="px-3 py-1.5 text-xs" onClick={() => void install()}>
          {t("نصب", "Install")}
        </Button>
        <button onClick={dismiss} aria-label="dismiss" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Modal open={iosHelp} onClose={() => setIosHelp(false)} title={t("نصب روی آیفون", "Install on iPhone")}>
        <div className="flex flex-col gap-3 text-sm text-foreground">
          <p className="text-xs text-muted-foreground">
            {t(
              "سافاری دکمه‌ی نصب خودکار نداره، ولی در دو قدم انجام می‌شه:",
              "Safari has no automatic install button, but it takes two steps:",
            )}
          </p>
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
            <Share className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-xs">
              {t("۱. دکمه‌ی «هم‌رسانی» پایین سافاری رو بزن", "1. Tap the Share button at the bottom of Safari")}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
            <span className="text-lg leading-none">➕</span>
            <p className="text-xs">
              {t("۲. «افزودن به صفحه اصلی» رو انتخاب کن", "2. Choose “Add to Home Screen”")}
            </p>
          </div>
          <Button onClick={() => setIosHelp(false)}>{t("متوجه شدم", "Got it")}</Button>
        </div>
      </Modal>
    </>
  );
}
