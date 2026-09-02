import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import { accountDeletionAt } from "@/lib/api/auth";
import { copyBackupToClipboard, downloadBackup } from "@/lib/backup";
import { isNative, shareBackupNative } from "@/lib/backup-native";
import { useAppMaybe } from "@/state/app";

const THREE_DAYS_MS = 3 * 86_400_000;

export function AccountDeletionWarning() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const db = ctx?.db ?? null;
  const deadline = accountDeletionAt();
  const remaining = deadline === null ? null : deadline - Date.now();
  const open =
    !dismissed && !!db?.auth && remaining !== null && remaining > 0 && remaining <= THREE_DAYS_MS;

  if (!ctx || !db) return null;

  const exportData = async () => {
    if (isNative()) {
      try {
        await shareBackupNative(db);
        return;
      } catch {
        // Fall through to the web/clipboard paths if the native share fails.
      }
    } else if (downloadBackup(db)) {
      toast.success(ctx.t("فایل پشتیبان دانلود شد", "Backup file downloaded"));
      return;
    }
    if (await copyBackupToClipboard(db)) {
      toast.success(ctx.t("نسخهٔ پشتیبان در کلیپ‌بورد کپی شد", "Backup copied to clipboard"));
    } else {
      toast.error(ctx.t("تهیهٔ پشتیبان ناموفق بود", "Backup failed"));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setDismissed(true)}
      title={ctx.t("هشدار حذف اطلاعات", "Data deletion warning")}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-7 text-muted-foreground">
          {ctx.t(
            "کمتر از سه روز تا حذف کامل حساب و اطلاعات ابری باقی مانده است. برای نگه‌داشتن اطلاعات، خروجی بگیر یا اشتراک تهیه کن.",
            "Less than three days remain before this account and its cloud data are permanently deleted. Export your data or purchase a subscription to keep it.",
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void exportData()}>
            {ctx.t("گرفتن خروجی", "Export data")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              setDismissed(true);
              navigate({ to: "/subscribe" });
            }}
          >
            {ctx.t("خرید اشتراک", "Buy subscription")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
