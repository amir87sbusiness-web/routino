import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { users } from "../db/schema.js";
import { verifyAccessToken } from "../services/tokens.js";
import { forbidden, unauthorized } from "./errors.js";

export interface AuthedUser {
  id: string;
  phone: string;
  deviceId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

/**
 * Bearer auth as a `preHandler`.
 *
 * Re-reads the user row on every request rather than trusting the JWT alone —
 * that's what makes blocking take effect within the access-token TTL instead of
 * whenever the token happens to expire.
 */
export const authPlugin = fp(async (app) => {
  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized("missing_token", "Authorization header required");

    const claims = await verifyAccessToken(app.deps.env, header.slice(7));
    const [row] = await app.deps.db.select().from(users).where(eq(users.id, claims.sub)).limit(1);

    if (!row) throw unauthorized("unknown_user", "User no longer exists");
    if (row.blocked) throw forbidden("blocked", "Account is blocked");

    req.user = { id: row.id, phone: row.phone, deviceId: claims.did };
  });
});

/** Narrows `req.user` for handlers behind `authenticate`. */
export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
