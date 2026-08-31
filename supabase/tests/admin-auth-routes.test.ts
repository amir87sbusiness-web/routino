import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/harness.ts";

let h: Harness;
beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => h?.close());

const ownerPhone = "09120000123";
const splitCookies = (res: Response) => {
  const lines = res.headers.getSetCookie();
  const values = lines.map((line) => line.split(";", 1)[0]!);
  return {
    header: values.join("; "),
    csrf: values.find((value) => value.startsWith("routino_admin_csrf="))?.split("=")[1] ?? "",
    lines,
  };
};

async function adminLogin() {
  await h.call("POST", "/v1/admin/auth/otp/request", { body: { phone: ownerPhone } });
  const response = await h.call("POST", "/v1/admin/auth/otp/verify", {
    body: { phone: ownerPhone, code: h.sms.last()!.code },
  });
  return { response, ...splitCookies(response) };
}

describe("edge admin OTP contract", () => {
  it("matches generic request, cookie session, CSRF, and legacy-header rejection", async () => {
    const wrong = await h.call("POST", "/v1/admin/auth/otp/request", {
      body: { phone: "09120000456" },
    });
    expect(h.sms.sent).toHaveLength(0);
    const right = await h.call("POST", "/v1/admin/auth/otp/request", {
      body: { phone: ownerPhone },
    });
    expect(h.sms.sent).toHaveLength(1);
    expect(wrong.status).toBe(202);
    expect(await wrong.text()).toBe(await right.text());

    await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
    const login = await adminLogin();
    expect(login.response.status).toBe(200);
    expect(login.lines.join("\n")).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(
      (
        await h.call("GET", "/v1/admin/overview", {
          headers: { "x-admin-token": "retired-shared-secret" },
        })
      ).status,
    ).toBe(401);
    expect(
      (await h.call("GET", "/v1/admin/auth/session", { headers: { cookie: login.header } })).status,
    ).toBe(200);

    expect(
      (
        await h.call("POST", "/v1/admin/discounts", {
          headers: { cookie: login.header },
          body: { code: "SAFE30", percent: 30 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call("POST", "/v1/admin/discounts", {
          headers: { cookie: login.header, "x-admin-csrf": login.csrf },
          body: { code: "SAFE30", percent: 30 },
        })
      ).status,
    ).toBe(200);
  });
});
