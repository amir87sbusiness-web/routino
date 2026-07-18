import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const unauthorized = (code = "unauthorized", msg = "Unauthorized") => new HttpError(401, code, msg);
export const forbidden = (code = "forbidden", msg = "Forbidden") => new HttpError(403, code, msg);
export const notFound = (code = "not_found", msg = "Not found") => new HttpError(404, code, msg);
export const tooMany = (msg = "Too many requests", retryAfter?: number) => {
  const e = new HttpError(429, "rate_limited", msg);
  (e as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
  return e;
};

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
