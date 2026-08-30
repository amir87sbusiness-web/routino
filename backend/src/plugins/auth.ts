import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { verifyAccessToken } from "../services/tokens.js";
import { unauthorized } from "./errors.js";

export interface AuthedUser {
  id: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

/**
 * Bearer auth as a `preHandler`.
 *
 * Signature, expiry, and subject are the complete authentication boundary.
 */
export const authPlugin = fp(async (app) => {
  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw unauthorized("missing_token", "Authorization header required");

    const claims = await verifyAccessToken(app.deps.env, header.slice(7));
    req.user = { id: claims.sub };
  });
});

/** Narrows `req.user` for handlers behind `authenticate`. */
export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
