import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  authedRequest,
  importSubscription,
  logout,
  passwordLogin,
  saveTokens,
  startTrial,
} from "./auth";

const tokenWith = (payload: object) => {
  const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
};

describe("owner-bound authenticated requests", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    saveTokens({
      access: tokenWith({ sub: "user-a", exp: 4_000_000_000 }),
      accessExpiresAt: 4_000_000_000_000,
      lastServerConfirmedAt: Date.now(),
    });
  });

  it("aborts before transport when the JWT belongs to another vault owner", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ records: [] }), { status: 200 }));

    const request = authedRequest("/sync/pull?cursor=0", { expectedUserId: "user-b" });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ApiError>>({ status: 401, code: "session_changed" }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send a legacy claim after the active account changes", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    const request = importSubscription(
      { planId: "legacy", expiresAt: Date.now() + 86_400_000 },
      "user-b",
    );

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ApiError>>({ status: 401, code: "session_changed" }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts a trial only through the authenticated server endpoint", async () => {
    const entitlement = {
      status: "active",
      planId: "trial",
      expiresAt: "2026-08-28T00:00:00.000Z",
      issuedAt: "2026-08-21T00:00:00.000Z",
    };
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ entitlement, started: true }), { status: 200 }),
      );

    await expect(startTrial()).resolves.toEqual({ entitlement, started: true });
    expect(fetch).toHaveBeenCalledWith(
      "/v1/subscriptions/trial/start",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) }),
      }),
    );
  });

  it("sends password credentials without device metadata", async () => {
    const response = {
      access: tokenWith({ sub: "user-a", exp: 4_000_000_000 }),
      user: { id: "user-a", phone: "989123334444" },
      entitlement: {
        status: "none",
        planId: null,
        expiresAt: null,
        issuedAt: "2026-08-30T00:00:00.000Z",
      },
      isNew: false,
    } as const;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    await passwordLogin("amir", "Password1");

    const body = JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ identifier: "amir", password: "Password1" });
    expect(body).not.toHaveProperty("device");
  });

  it("clears a rejected token without attempting a refresh request", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }));

    await expect(authedRequest("/sync/pull?cursor=0")).rejects.toMatchObject({ status: 401 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("routino:auth:v1")).toBeNull();
  });

  it("logs out locally without making an HTTP request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    await logout();

    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("routino:auth:v1")).toBeNull();
  });
});
