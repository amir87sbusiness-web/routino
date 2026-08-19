import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settings = readFileSync(resolve(process.cwd(), "src/routes/settings.tsx"), "utf8");

describe("settings surface", () => {
  it("does not show the removed device-security or account-device panels", () => {
    expect(settings).not.toContain("امنیت نگهداری روی این دستگاه");
    expect(settings).not.toContain("دستگاه‌های حساب");
    expect(settings).not.toContain("On-device storage safety");
    expect(settings).not.toContain("Account devices");
  });
});
