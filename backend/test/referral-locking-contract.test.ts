import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const paymentFlowSource = readFileSync(
  fileURLToPath(new URL("../src/services/payment-flow.ts", import.meta.url)),
  "utf8",
);
const referralSource = readFileSync(
  fileURLToPath(new URL("../src/services/referral.ts", import.meta.url)),
  "utf8",
);

describe("referral locking contracts", () => {
  it("does not lock an inviter after the referral has already succeeded", () => {
    expect(paymentFlowSource).toMatch(
      /select r\.inviter_id\s+from referrals r[\s\S]*?r\.invitee_id = \$\{userId\}[\s\S]*?r\.successful_at is null/,
    );
  });

  it("maps an inviter deleted between lookup and locking to a domain error", () => {
    expect(referralSource).toMatch(
      /accounts\.some\(\(account\) => account\.id === inviter\.id\)[\s\S]*?invalid_referral_code/,
    );
  });
});
