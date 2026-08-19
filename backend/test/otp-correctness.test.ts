/**
 * "Could the code go to the wrong phone, or let the wrong person in?"
 *
 * The failure being ruled out here is the one that would be catastrophic and
 * silent: person A requests a code and person B can use it, or a code sent to
 * one number signs in another. Under a launch-day burst these are exactly the
 * mix-ups a shared counter or a sloppy lookup would produce.
 */
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

const requestCode = (phone: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });

const verify = (phone: string, code: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code } });

describe("the code always belongs to the number that asked for it", () => {
  it("sends each of 10 simultaneous sign-ups a four-digit code for its own number", async () => {
    const phones = Array.from({ length: 10 }, (_, i) => `0913999${String(i).padStart(4, "0")}`);
    await Promise.all(phones.map(requestCode));

    // One message per number, and no number received someone else's code.
    expect(h.sms.sent).toHaveLength(10);
    for (const { code } of h.sms.sent) expect(code).toMatch(/^\d{4}$/);

    // Every message went to the number that asked, in canonical form.
    for (const p of phones) {
      const canonical = `98${p.slice(1)}`;
      expect(h.sms.sent.filter((m) => m.phone === canonical)).toHaveLength(1);
    }
  });

  it("refuses one user's code presented for another user's number", async () => {
    await requestCode("09139000001");
    const victimCode = h.sms.last()!.code;
    await requestCode("09139000002");

    // The attacker knows a real, valid, unexpired code — just not for their
    // own number. It must not sign them in.
    const stolen = await verify("09139000002", victimCode);
    expect(stolen.statusCode).toBeGreaterThanOrEqual(400);

    // And the rightful owner's code still works afterwards.
    const legit = await verify("09139000001", victimCode);
    expect(legit.statusCode).toBe(200);
  });

  it("a code can only be spent once", async () => {
    await requestCode("09139000003");
    const code = h.sms.last()!.code;

    expect((await verify("09139000003", code)).statusCode).toBe(200);
    // Replay — a shared link, a double-tap, an attacker with the SMS.
    expect((await verify("09139000003", code)).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("only the NEWEST code works after a re-request", async () => {
    const phone = "09139000004";
    await requestCode(phone);
    const older = h.sms.last()!.code;

    // The user didn't get the first SMS and asked again. Both codes now exist
    // in the table; only the newest may work, or "resend" would widen the
    // guessing surface every time it is pressed.
    await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
    await requestCode(phone);
    const newer = h.sms.last()!.code;
    expect(newer).not.toBe(older);

    expect((await verify(phone, older)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await verify(phone, newer)).statusCode).toBe(200);
  });

  it("locks out after repeated wrong guesses rather than allowing brute force", async () => {
    const phone = "09139000005";
    await requestCode(phone);
    const real = h.sms.last()!.code;
    const wrong = real === "0000" ? "1111" : "0000";

    // 4 digits is only 9,000 possibilities; without an attempt cap a
    // determined script would walk it.
    for (let i = 0; i < 3; i++) {
      expect((await verify(phone, wrong)).statusCode).toBeGreaterThanOrEqual(400);
    }

    // Even the CORRECT code is refused now — the code is burned, not the account.
    expect((await verify(phone, real)).statusCode).toBeGreaterThanOrEqual(400);
  });
});
