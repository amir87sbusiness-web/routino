import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { issueAccessToken, verifyAccessToken } from "../src/services/tokens.js";

const env = loadEnv({ NODE_ENV: "test" });
const USER_ID = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-30T08:00:00.000Z");

describe("stateless access tokens", () => {
  it("issues a 30-day token without a device claim", async () => {
    const { access } = await issueAccessToken(env, USER_ID, now);
    const payload = decodeJwt(access);

    expect(payload.sub).toBe(USER_ID);
    expect(payload).not.toHaveProperty("did");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(30 * 86_400);
  });

  it("verifies only the account subject", async () => {
    const { access } = await issueAccessToken(env, USER_ID, now);

    await expect(verifyAccessToken(env, access)).resolves.toEqual({ sub: USER_ID });
  });
});
