import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deps } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { authPlugin, requireUser } from "../src/plugins/auth.js";
import { issueAccessToken } from "../src/services/tokens.js";

const env = loadEnv({ NODE_ENV: "test" });
const USER_ID = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-30T08:00:00.000Z");

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("stateless bearer middleware", () => {
  it("authenticates a valid subject without reading users or devices", async () => {
    const dbReads = vi.fn(() => {
      throw new Error("auth middleware must not read the database");
    });
    const app = Fastify();
    apps.push(app);
    app.decorate("deps", {
      db: { select: dbReads },
      env,
      now: () => now.getTime(),
    } as unknown as Deps);
    await app.register(authPlugin);
    app.get("/protected", { preHandler: app.authenticate }, async (req) => requireUser(req));

    const { access } = await issueAccessToken(env, USER_ID, now);
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${access}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: USER_ID });
    expect(dbReads).not.toHaveBeenCalled();
  });
});
