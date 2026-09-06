import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { renderResultPage } from "../src/lib/pay-result-page.js";

it("retries the original callback at most three times and preserves manual recovery", () => {
  const env = { PUBLIC_WEB_URL: "https://app.example", APP_DEEP_LINK: "routino://pay/result" };
  const html = renderResultPage(env, { outcome: "pending", retryCallbackAfterSeconds: 10 });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  for (const attempt of [0, 2, 3]) {
    const original = `https://api.example/v1/payments/callback?paymentId=fixture&Authority=untrusted&Status=OK&verificationRetry=${attempt}`;
    const button = { href: "" };
    const scheduled: { fn: () => void; ms: number }[] = [];
    let replacement = "";
    const location = {
      href: original,
      replace: (url: string) => {
        replacement = url;
      },
    };
    runInNewContext(script, {
      URL,
      window: { location },
      document: { getElementById: () => button },
      setTimeout: (fn: () => void, ms: number) => scheduled.push({ fn, ms }),
    });
    expect(button.href).toBe(original);
    expect(location.href).toBe(original);
    expect(scheduled).toHaveLength(attempt < 3 ? 1 : 0);
    if (attempt < 3) {
      expect(scheduled[0]!.ms).toBe(10000);
      scheduled[0]!.fn();
      const next = new URL(replacement);
      expect(next.searchParams.get("Authority")).toBe("untrusted");
      expect(next.searchParams.get("verificationRetry")).toBe(String(attempt + 1));
      expect(next.origin).toBe("https://api.example");
    }
  }
});
