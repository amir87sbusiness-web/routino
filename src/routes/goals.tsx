import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { GoalsListView } from "@/components/goals";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/goals")({
  component: () => (
    <AppShell>
      <GoalsPage />
    </AppShell>
  ),
});

function GoalsPage() {
  const ctx = useAppMaybe();
  if (!ctx?.db) return null;
  return <GoalsListView db={ctx.db} update={ctx.update} t={ctx.t} lang={ctx.lang} cal={ctx.cal} />;
}
