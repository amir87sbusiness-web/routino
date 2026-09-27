import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../plugins/auth.js";
import { readEntitlement } from "../services/entitlement.js";
import { claimReferralCode, getReferralSummary } from "../services/referral.js";

const claimBody = z.object({ code: z.string() });

export const referralRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/referrals/me", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const now = new Date(app.deps.now());
    const [referral, entitlement] = await Promise.all([
      getReferralSummary(db, user.id),
      readEntitlement(db, user.id, now),
    ]);
    return { ...referral, entitlement };
  });

  app.post("/referrals/claim", { preHandler: app.authenticate }, async (req) => {
    const { code } = claimBody.parse(req.body);
    return claimReferralCode(db, requireUser(req).id, code, new Date(app.deps.now()));
  });
};
