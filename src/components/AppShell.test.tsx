import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, type Db } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const navigate = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ ctx: null as Record<string, unknown> | null }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouterState: () => "/",
}));
vi.mock("@/components/FeedbackModal", () => ({ FeedbackModal: () => null }));
vi.mock("@/components/pwa", () => ({ InstallBanner: () => null }));
vi.mock("@/lib/pwa", () => ({ requestPersistentStorage: vi.fn() }));
vi.mock("@/state/app", () => ({ useAppMaybe: () => app.ctx }));

import { AppShell } from "./AppShell";

function expiredDb(): Db {
  const db = defaultDb([]);
  db.settings.onboarded = true;
  db.auth = { userId: "user-1", phone: "989123334444", verifiedAt: 1 };
  db.subscription = { planId: "trial", startedAt: 1, expiresAt: 999, trial: true };
  db.meta.legacyEntitlementMigrationResolved = true;
  return db;
}

describe("AppShell read-only access", () => {
  let host: HTMLDivElement;
  let root: Root;
  const clearWriteBlocked = vi.fn();

  beforeEach(async () => {
    navigate.mockReset();
    clearWriteBlocked.mockReset();
    app.ctx = {
      db: expiredDb(),
      sessionGate: "ready",
      retrySession: vi.fn(),
      t: (fa: string) => fa,
      lang: "fa",
      cal: "jalali",
      update: vi.fn(),
      recordFeedbackPrompt: vi.fn(),
      markNotificationsRead: vi.fn(),
      writeBlocked: false,
      clearWriteBlocked,
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AppShell>تاریخچهٔ محفوظ</AppShell>));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps expired history visible with a persistent non-blocking notice", () => {
    expect(host.textContent).toContain("تاریخچهٔ محفوظ");
    expect(host.textContent).toContain("اشتراکت تموم شده؛ اطلاعاتت محفوظ است");
    expect(navigate).not.toHaveBeenCalledWith({ to: "/subscribe" });
  });

  it("offers subscribe once after a blocked product action", async () => {
    app.ctx = { ...app.ctx, writeBlocked: true };
    await act(async () => root.render(<AppShell>تاریخچهٔ محفوظ</AppShell>));

    const subscribe = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("فعال کردن اشتراک"),
    )!;
    expect(subscribe).toBeTruthy();
    await act(async () => subscribe.click());

    expect(clearWriteBlocked).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/subscribe" });
  });
});
