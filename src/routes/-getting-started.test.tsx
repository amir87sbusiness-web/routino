import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { defaultDb, type Db } from "@/lib/store";
import { defaultOnboardingDraft, saveOnboardingDraft, loadOnboardingDraft } from "@/lib/onboarding";
import { prepareGuide, readGuide } from "@/lib/product-guide";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const navigate = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({ db: app.db, update, lang: "fa", t: (fa: string) => fa }),
}));
vi.mock("@/components/OnboardingFlow", () => ({
  PersonalizationFlow: ({
    onComplete,
  }: {
    onComplete: (draft: ReturnType<typeof defaultOnboardingDraft>) => void;
  }) => <button onClick={() => onComplete(defaultOnboardingDraft("new-user"))}>Complete</button>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { Route } from "./getting-started";
const Page = (Route as unknown as { component: () => React.ReactNode }).component;
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  localStorage.clear();
  navigate.mockReset();
  update.mockReset();
  update.mockReturnValue(true);
  app.db = defaultDb([]);
  app.db.auth = { userId: "new-user", phone: "989120000000", verifiedAt: Date.now() };
  app.db.subscription = {
    planId: "trial",
    trial: true,
    startedAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  };
  app.db.meta.legacyEntitlementMigrationResolved = true;
  saveOnboardingDraft({ ...defaultOnboardingDraft("new-user"), referralPromptCompleted: true });
  prepareGuide("new-user");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Page />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("activates the guide after personalization is accepted", async () => {
  expect(readGuide("new-user").enabled).toBe(false);
  await act(async () => host.querySelector("button")!.click());
  expect(update).toHaveBeenCalled();
  expect(readGuide("new-user").enabled).toBe(true);
  expect(loadOnboardingDraft("new-user")).toBeNull();
  expect(navigate).toHaveBeenCalledWith({ to: "/" });
});
it("keeps the guide pending when saving personalized habits is rejected", async () => {
  update.mockReturnValue(false);
  await act(async () => host.querySelector("button")!.click());
  expect(readGuide("new-user")).toMatchObject({ pending: true, enabled: false });
  expect(loadOnboardingDraft("new-user")).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});
