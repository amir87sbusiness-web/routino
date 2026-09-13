import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import {
  checkAndroidUpdateOnBoot,
  openAndroidUpdatePage,
  type AndroidUpdate,
} from "@/lib/android-update";
import { Button } from "@/components/ui";
import { useAppMaybe } from "@/state/app";

/** A release notice rendered only inside the Android app while it is open. */
export function AndroidUpdateBanner() {
  const ctx = useAppMaybe();
  const [release, setRelease] = useState<AndroidUpdate | null>(null);

  useEffect(() => {
    let active = true;
    void checkAndroidUpdateOnBoot().then((next) => {
      if (active && next) setRelease(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!release) return null;
  const t = ctx?.t ?? ((fa: string) => fa);

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Download className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-bold text-foreground">
          {t("نسخهٔ جدید روتینو آماده است", "A new Routino version is ready")}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {t("برای دریافت نسخهٔ جدید، بروزرسانی را بزن.", "Tap update to get the latest version.")}
        </p>
      </div>
      <Button className="px-3 py-1.5 text-xs" onClick={() => void openAndroidUpdatePage()}>
        {t("بروزرسانی", "Update")}
      </Button>
    </div>
  );
}
