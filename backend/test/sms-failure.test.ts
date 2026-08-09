/**
 * What happens to the user's rate-limit slot when the SMS does not go out.
 *
 * This is the "sometimes the code arrives, sometimes it doesn't" complaint from
 * the other side. A failed send used to keep the slot spent, so a user who
 * received nothing was still counted against the one-per-minute and five-per-
 * hour limits — they would tap "send again", be told to wait, and conclude the
 * app was broken. The distinction that matters is whether the provider is
 * CERTAIN nothing was sent (no cost, refund the slot) or merely unsure (may have
 * been billed, keep it).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SmsNotSentError } from "../src/providers/sms/index.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

const request = (phone: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });

const codeRows = async (phone: string) => {
  const rows = await h.query<{ n: number }>(
    `select count(*)::int as n from otp_codes where phone = '${phone}'`,
  );
  return Number(rows[0]!.n);
};

describe("when the SMS provider fails", () => {
  it("gives the slot back when the provider is certain nothing was sent", async () => {
    const phone = "989137770001";
    h.sms.sendOtp = async () => {
      throw new SmsNotSentError("kavenegar HTTP 400 status=418: invalid template");
    };

    const first = await request("09137770001");
    expect(first.statusCode).toBe(502);
    // No message went out, so nothing should be held against them.
    expect(await codeRows(phone)).toBe(0);

    // And therefore the very next attempt is not rate limited.
    h.sms.sendOtp = async (p, c) => {
      h.sms.sent.push({ phone: p, code: c });
    };
    const second = await request("09137770001");
    expect(second.statusCode).toBe(200);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("keeps the slot when the failure is ambiguous", async () => {
    const phone = "989137770002";
    // A timeout or a 5xx: the message may genuinely have been sent and billed.
    h.sms.sendOtp = async () => {
      throw new Error("kavenegar HTTP 502 status=?: bad gateway");
    };

    const first = await request("09137770002");
    expect(first.statusCode).toBe(502);
    // The row stays — refunding here is how a retry loop turns into a real bill.
    expect(await codeRows(phone)).toBe(1);

    // So an immediate retry is correctly throttled.
    const second = await request("09137770002");
    expect(second.statusCode).toBe(429);
  });
});
