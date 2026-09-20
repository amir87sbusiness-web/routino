import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkDiscount, quote, tomanToRial } from "../src/services/pricing.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const NOW = new Date("2026-07-15T00:00:00Z");
const USER = "33333333-3333-3333-3333-333333333333";
const PHONE = "989123334444";

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  await h.raw(`insert into users (id, phone) values ('${USER}', '${PHONE}')`);
});
afterAll(async () => {
  await h?.close();
});

describe("tomanToRial", () => {
  it("multiplies by ten and only here", () => {
    // ZarinPal bills in Rial; the app prices in Toman. 59,000 T = 590,000 R.
    expect(tomanToRial(59000)).toBe(590000);
  });
});

describe("quote", () => {
  it("prices from the database, not the client", async () => {
    const q = await quote(h.db, "m3", null, USER, PHONE, NOW);
    expect(q).toMatchObject({
      planId: "m3",
      months: 3,
      finalToman: 149000,
      finalRial: 1490000,
      discountPercent: 0,
    });
  });

  it("applies a valid discount", async () => {
    await h.raw(`insert into discounts (code, percent) values ('ROUTINO20', 20)`);
    const q = await quote(h.db, "m3", "routino20", USER, PHONE, NOW); // case-insensitive
    expect(q.discountPercent).toBe(20);
    expect(q.finalToman).toBe(119200);
    expect(q.finalRial).toBe(1192000);
  });

  it("does not stack an unrelated caller-supplied offer percentage", async () => {
    await h.raw(`insert into discounts (code, percent) values ('ROUTINO20', 20)`);
    const q = await quote(h.db, "m3", "ROUTINO20", USER, PHONE, NOW, 10);
    expect(q.finalToman).toBe(119200);
  });

  it("starts at the first trial grant, switches stages, and ends after a paid payment", async () => {
    await h.raw(`update plans set offer_enabled = true, offer_first_kind = 'percent', offer_first_value = 30,
      offer_second_kind = 'fixed', offer_second_value = 10000 where id = 'm3'`);
    expect((await quote(h.db, "m3", null, USER, PHONE, NOW)).offerStage).toBeNull();
    await h.raw(
      `insert into grants (user_id, source, created_at) values ('${USER}', 'trial', '2026-07-14T00:00:00Z')`,
    );
    const first = await quote(h.db, "m3", null, USER, PHONE, NOW);
    expect(first).toMatchObject({ offerStage: 1, finalToman: 104300, offerAmountToman: 44700 });
    const second = await quote(h.db, "m3", null, USER, PHONE, new Date("2026-07-18T00:00:00Z"));
    expect(second).toMatchObject({ offerStage: 2, finalToman: 139000, offerAmountToman: 10000 });
    await h.raw(`insert into payments (user_id, plan_id, months, amount_toman, amount_rial, status)
      values ('${USER}', 'm1', 1, 59000, 590000, 'paid')`);
    expect((await quote(h.db, "m3", null, USER, PHONE, NOW)).offerStage).toBeNull();
  });

  it("does not restore the Offer when a successful payment survives in the grant ledger", async () => {
    await h.raw(`update plans set offer_enabled = true, offer_first_value = 30 where id = 'm3'`);
    await h.raw(`insert into grants (user_id, source, created_at) values
      ('${USER}', 'trial', '2026-07-14T00:00:00Z'), ('${USER}', 'payment', '2026-07-14T12:00:00Z')`);
    expect((await quote(h.db, "m3", null, USER, PHONE, NOW)).offerStage).toBeNull();
  });

  it("chooses the better code or offer without stacking or redeeming a losing code", async () => {
    await h.raw(`update plans set offer_enabled = true, offer_first_value = 30 where id = 'm3'`);
    await h.raw(
      `insert into grants (user_id, source, created_at) values ('${USER}', 'trial', '2026-07-14T00:00:00Z')`,
    );
    await h.raw(`insert into discounts (code, percent) values ('LESS20', 20), ('MORE40', 40)`);
    const offer = await quote(h.db, "m3", "LESS20", USER, PHONE, NOW);
    expect(offer).toMatchObject({ finalToman: 104300, discountCode: null, offerStage: 1 });
    const code = await quote(h.db, "m3", "MORE40", USER, PHONE, NOW);
    expect(code).toMatchObject({ finalToman: 89400, discountCode: "MORE40", offerStage: null });
  });

  it("ignores an invalid code rather than failing checkout", async () => {
    const q = await quote(h.db, "m1", "NOPE", USER, PHONE, NOW);
    expect(q.finalToman).toBe(59000);
    expect(q.discountCode).toBeNull();
  });

  it("rejects an unknown plan", async () => {
    await expect(quote(h.db, "m99", null, USER, PHONE, NOW)).rejects.toThrow();
  });

  it("refuses to charge zero", async () => {
    await h.raw(`insert into discounts (code, percent) values ('FREE100', 100)`);
    await expect(quote(h.db, "m1", "FREE100", USER, PHONE, NOW)).rejects.toThrow();
  });
});

describe("checkDiscount", () => {
  it("rejects expired, inactive and exhausted codes", async () => {
    await h.raw(`insert into discounts (code, percent, active) values ('OFF', 20, false)`);
    await h.raw(
      `insert into discounts (code, percent, expires_at) values ('OLD', 20, '2026-01-01')`,
    );
    await h.raw(
      `insert into discounts (code, percent, max_uses, used_count) values ('GONE', 20, 5, 5)`,
    );

    expect((await checkDiscount(h.db, "OFF", USER, PHONE, NOW)).reason).toBe("inactive");
    expect((await checkDiscount(h.db, "OLD", USER, PHONE, NOW)).reason).toBe("expired");
    expect((await checkDiscount(h.db, "GONE", USER, PHONE, NOW)).reason).toBe("exhausted");
    expect((await checkDiscount(h.db, "WAT", USER, PHONE, NOW)).reason).toBe("unknown");
  });

  it("counts an in-flight checkout against max_uses", async () => {
    // Regression: max_uses was checked against `used_count`, which is only
    // written when a payment SUCCEEDS. Every user who reached the gateway before
    // the first one paid therefore also got the discount — a single-use code
    // posted publicly could be redeemed by everyone in that window.
    await h.raw(`insert into discounts (code, percent, max_uses) values ('ONCE', 50, 1)`);
    const other = "55555555-5555-5555-5555-555555555555";
    await h.raw(`insert into users (id, phone) values ('${other}', '989350001122')`);
    await h.raw(
      `insert into payments (user_id, plan_id, months, amount_toman, amount_rial, discount_code, status)
       values ('${other}', 'm1', 1, 29500, 295000, 'ONCE', 'redirected')`,
    );

    expect((await checkDiscount(h.db, "ONCE", USER, PHONE, NOW)).reason).toBe("exhausted");
  });

  it("counts multiple open attempts from one customer as one reserved discount slot", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('TWO', 50, 2)`);
    const other = "77777777-7777-4777-8777-777777777777";
    await h.raw(`insert into users (id, phone) values ('${other}', '989350005566')`);
    await h.raw(`
      insert into payments
        (user_id, plan_id, months, amount_toman, amount_rial, discount_code, status)
      values
        ('${other}', 'm1', 1, 29500, 295000, 'TWO', 'redirected'),
        ('${other}', 'm1', 1, 29500, 295000, 'TWO', 'redirected')
    `);

    expect((await checkDiscount(h.db, "TWO", USER, PHONE, NOW)).valid).toBe(true);
  });

  it("does not let a user's own pending checkout block their retry", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('MINE', 50, 1)`);
    await h.raw(
      `insert into payments (user_id, plan_id, months, amount_toman, amount_rial, discount_code, status)
       values ('${USER}', 'm1', 1, 29500, 295000, 'MINE', 'redirected')`,
    );

    expect((await checkDiscount(h.db, "MINE", USER, PHONE, NOW)).valid).toBe(true);
  });

  it("frees a slot again once an abandoned checkout goes stale", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('STALE', 50, 1)`);
    const other = "66666666-6666-6666-6666-666666666666";
    await h.raw(`insert into users (id, phone) values ('${other}', '989350003344')`);
    // created_at is two hours before the test's fixed NOW — not before the wall
    // clock, which is what `now()` in SQL would have given.
    await h.raw(
      `insert into payments (user_id, plan_id, months, amount_toman, amount_rial, discount_code, status, created_at)
       values ('${other}', 'm1', 1, 29500, 295000, 'STALE', 'redirected', '2026-07-14T22:00:00Z')`,
    );

    expect((await checkDiscount(h.db, "STALE", USER, PHONE, NOW)).valid).toBe(true);
  });

  it("honours a phone-restricted code", async () => {
    await h.raw(`insert into discounts (code, percent, phone) values ('MINE', 50, '989121111111')`);
    expect((await checkDiscount(h.db, "MINE", USER, PHONE, NOW)).reason).toBe("other_user");
    expect((await checkDiscount(h.db, "MINE", USER, "989121111111", NOW)).valid).toBe(true);
  });

  it("refuses a second use by the same user", async () => {
    await h.raw(`insert into discounts (code, percent) values ('ONCE', 20)`);
    await h.raw(`insert into redemptions (code, user_id) values ('ONCE', '${USER}')`);
    expect((await checkDiscount(h.db, "ONCE", USER, PHONE, NOW)).reason).toBe("already_used");
  });

  it("treats an empty code as no code", async () => {
    expect(await checkDiscount(h.db, "  ", USER, PHONE, NOW)).toMatchObject({
      valid: false,
      code: null,
    });
  });
});
