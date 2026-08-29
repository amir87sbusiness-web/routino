import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let access: string;

const auth = () => ({ authorization: `Bearer ${access}` });

beforeAll(async () => {
  h = await makeHarness();
  await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone: "09127770000" },
  });
  const login = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone: "09127770000", code: h.sms.last()!.code },
  });
  access = (login.json() as { access: string }).access;
});

afterAll(async () => h?.close());

describe("bounded launch load", () => {
  it("serves public and authenticated bursts without a 5xx", async () => {
    const requests = [
      ...Array.from({ length: 50 }, () => h.app.inject({ method: "GET", url: "/health" })),
      ...Array.from({ length: 50 }, () => h.app.inject({ method: "GET", url: "/v1/plans" })),
      ...Array.from({ length: 50 }, () =>
        h.app.inject({ method: "GET", url: "/v1/subscriptions/me", headers: auth() }),
      ),
      ...Array.from({ length: 20 }, () =>
        h.app.inject({ method: "GET", url: "/v1/subscriptions/me", headers: auth() }),
      ),
      ...Array.from({ length: 30 }, () =>
        h.app.inject({
          method: "GET",
          url: "/v1/subscriptions/me",
          headers: { authorization: "Bearer invalid" },
        }),
      ),
    ];
    const responses = await Promise.all(requests);
    expect(responses.some((response) => response.statusCode >= 500)).toBe(false);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(170);
    expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(30);
  });

  it("keeps OTP throttling controlled during a burst", async () => {
    const responses = await Promise.all(
      Array.from({ length: 16 }, () =>
        h.app.inject({
          method: "POST",
          url: "/v1/auth/otp/request",
          payload: { phone: "09127770001" },
        }),
      ),
    );
    expect(responses.some((response) => response.statusCode >= 500)).toBe(false);
    expect(responses.every((response) => [200, 429].includes(response.statusCode))).toBe(true);
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
  });
});
