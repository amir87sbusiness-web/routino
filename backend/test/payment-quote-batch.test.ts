import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

async function signIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string };
}

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

describe("POST /v1/payments/quote-batch", () => {
  it("requires authentication", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote-batch",
      payload: { planIds: ["m1", "m3"], code: "OFF20" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns multiple authoritative quotes in one request and de-duplicates plan ids", async () => {
    await h.raw(`insert into discounts (code, percent) values ('OFF20', 20)`);
    const { access } = await signIn();
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote-batch",
      headers: auth(access),
      payload: { planIds: ["m1", "m1", "m3", "m6"], code: "off20" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      quotes: Array<{
        quote: { planId: string; basePriceToman: number; finalToman: number };
        discount: { valid: boolean; code: string | null };
      }>;
    };
    expect(body.quotes.map((item) => item.quote.planId)).toEqual(["m1", "m3", "m6"]);
    for (const item of body.quotes) {
      expect(item.discount).toMatchObject({ valid: true, code: "OFF20" });
      expect(item.quote.finalToman).toBe(Math.round(item.quote.basePriceToman * 0.8));
    }
  });
});
