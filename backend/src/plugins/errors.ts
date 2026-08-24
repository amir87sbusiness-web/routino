import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-errors.js";

// The error classes/helpers moved to lib/http-errors.ts (framework-free, shared
// with the edge port). Re-exported here so existing imports keep working.
export {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  locked,
  notFound,
  conflict,
  badGateway,
  serviceUnavailable,
  gatewayTimeout,
  tooMany,
} from "../lib/http-errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter;
      if (retryAfter) void reply.header("Retry-After", String(retryAfter));
      return reply
        .status(err.statusCode)
        .send({ error: err.code, message: err.message, ...(err.details ?? {}) });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "invalid_request",
        message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    // Fastify's own errors — body over the 64 KB cap, bad Content-Length,
    // unsupported media type, malformed JSON — already carry the right status
    // and a stable `FST_ERR_*` code. They used to fall through to the 500 below,
    // which told the caller "the server is broken, retry" for what is really
    // "fix your request". That mattered most to the sync client: its push size
    // is bounded by that same body limit, so an oversized batch came back as a
    // 500 and was retried forever instead of being split.
    const fastifyErr = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    const status = typeof fastifyErr.statusCode === "number" ? fastifyErr.statusCode : 500;
    if (status >= 400 && status < 500) {
      req.log.warn({ err }, "client error");
      return reply.status(status).send({
        error: typeof fastifyErr.code === "string" ? fastifyErr.code : "bad_request",
        message: typeof fastifyErr.message === "string" ? fastifyErr.message : "Bad request",
      });
    }

    // Anything unrecognised is a bug. Log it with the stack, but never leak the
    // internals to the client.
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "internal", message: "Internal server error" });
  });
}
