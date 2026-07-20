import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-errors.js";

// The error classes/helpers moved to lib/http-errors.ts (framework-free, shared
// with the edge port). Re-exported here so existing imports keep working.
export { HttpError, badRequest, unauthorized, forbidden, notFound, tooMany } from "../lib/http-errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter;
      if (retryAfter) void reply.header("Retry-After", String(retryAfter));
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "invalid_request",
        message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    // Anything unrecognised is a bug. Log it with the stack, but never leak the
    // internals to the client.
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "internal", message: "Internal server error" });
  });
}
