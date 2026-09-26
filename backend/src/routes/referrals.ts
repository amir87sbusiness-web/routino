import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../plugins/auth.js";
import { claimReferralCode, getReferralSummary } from "../services/referral.js";

const claimBody = z.object({ code: z.string() });

export const referralRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/referrals/me", { preHandler: app.authenticate }, async (req) => {
    return getReferralSummary(db, requireUser(req).id);
  });

  app.post("/referrals/claim", { preHandler: app.authenticate }, async (req) => {
    const { code } = claimBody.parse(req.body);
    return claimReferralCode(db, requireUser(req).id, code, new Date(app.deps.now()));
  });
};
