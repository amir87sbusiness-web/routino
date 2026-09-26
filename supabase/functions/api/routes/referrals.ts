import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { claimReferralCode, getReferralSummary } from "../shared/services/referral.ts";

const claimBody = z.object({ code: z.string() });

export function referralRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const auth = makeAuthenticate(deps);

  r.get("/referrals/me", auth, async (c) => {
    return c.json(await getReferralSummary(deps.db, requireUser(c).id));
  });

  r.post("/referrals/claim", auth, async (c) => {
    const { code } = claimBody.parse(await readJson(c));
    return c.json(await claimReferralCode(deps.db, requireUser(c).id, code, new Date(deps.now())));
  });

  return r;
}
