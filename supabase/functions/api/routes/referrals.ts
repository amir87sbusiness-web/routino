import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { readEntitlement } from "../shared/services/entitlement.ts";
import { claimReferralCode, getReferralSummary } from "../shared/services/referral.ts";

const claimBody = z.object({ code: z.string() });

export function referralRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const auth = makeAuthenticate(deps);

  r.get("/referrals/me", auth, async (c) => {
    c.header("cache-control", "no-store");
    const user = requireUser(c);
    const now = new Date(deps.now());
    const [referral, entitlement] = await Promise.all([
      getReferralSummary(deps.db, user.id),
      readEntitlement(deps.db, user.id, now),
    ]);
    return c.json({ ...referral, entitlement });
  });

  r.post("/referrals/claim", auth, async (c) => {
    const { code } = claimBody.parse(await readJson(c));
    return c.json(await claimReferralCode(deps.db, requireUser(c).id, code, new Date(deps.now())));
  });

  return r;
}
