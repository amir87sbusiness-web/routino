import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { GoalDetailView } from "@/components/goals";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/goal/$goalId")({
  component: () => (
    <AppShell>
      <GoalDetailPage />
    </AppShell>
  ),
});

function GoalDetailPage() {
  const { goalId } = Route.useParams();
  const navigate = useNavigate();
  const ctx = useAppMaybe();
  if (!ctx?.db) return null;
  return (
    <GoalDetailView
      db={ctx.db}
      goalId={goalId}
      onDeleted={() => void navigate({ to: "/goals", replace: true })}
      onCompleted={() => void navigate({ to: "/goals", replace: true })}
      update={ctx.update}
      t={ctx.t}
      lang={ctx.lang}
      cal={ctx.cal}
    />
  );
}
