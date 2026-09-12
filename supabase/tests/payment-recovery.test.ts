import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

const RECONCILE_SECRET = "r".repeat(48);
let h: Harness;

beforeAll(async () => {
  h = await makeHarness({ PAYMENT_RECONCILE_SECRET: RECONCILE_SECRET });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await h.close();
});

test("Edge does not start a second Verify while an authoritative recovery lease is active", async () => {
  const { access } = await signIn(h, "09121110013");
  const checkout = await h.call("POST", "/v1/payments/checkout", {
    headers: auth(access),
    body: { planId: "m1", attemptId: crypto.randomUUID() },
  });
  expect(checkout.status).toBe(200);
  const { paymentId, authority } = (await checkout.json()) as {
    paymentId: string;
    authority: string;
  };
  h.psp._settle(authority, "paid");
  const [stored] = await h.query<{ amount_rial: number }>(
    `select amount_rial from payments where id='${paymentId}'`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { code: 100, authorities: [{ authority, amount: stored!.amount_rial }] },
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );

  const originalVerify = h.psp.verify.bind(h.psp);
  let verifyCalls = 0;
  let releaseFirst!: () => void;
  const firstVerifyStarted = new Promise<void>((resolve) => {
    h.psp.verify = async (...args) => {
      verifyCalls += 1;
      if (verifyCalls === 1) {
        resolve();
        await new Promise<void>((release) => {
          releaseFirst = release;
        });
      }
      return originalVerify(...args);
    };
  });

  const request = () =>
    h.call("POST", "/internal/payments/reconcile-unverified", {
      headers: { "x-payment-reconcile-secret": RECONCILE_SECRET },
    });
  const first = request();
  await firstVerifyStarted;
  const second = request();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const callsWhileFirstWasActive = verifyCalls;
  releaseFirst();
  await Promise.all([first, second]);

  expect(callsWhileFirstWasActive).toBe(1);
  expect(verifyCalls).toBe(1);
});
