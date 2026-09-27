import { Link } from "@tanstack/react-router";
import { ChevronLeft, Gift } from "lucide-react";

export function ReferralSettingsCard({ t }: { t: (fa: string, en: string) => string }) {
  return (
    <Link to="/referrals" className="card-surface flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Gift className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-bold text-foreground">
        {t("دعوت دوستان", "Invite friends")}
      </span>
      <ChevronLeft
        className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-0 ltr:rotate-180"
        aria-hidden="true"
      />
    </Link>
  );
}
