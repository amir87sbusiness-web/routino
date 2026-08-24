/**
 * Framework-free HTTP errors.
 *
 * Lives in lib/ (not plugins/) because the services throw these and the services
 * are shared verbatim with the Supabase Edge Function port — this file must not
 * import Fastify. Each HTTP adapter (Fastify's registerErrorHandler, the edge
 * app's onError) maps them to the same JSON shape: { error, message }.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const unauthorized = (code = "unauthorized", msg = "Unauthorized") =>
  new HttpError(401, code, msg);
export const forbidden = (code = "forbidden", msg = "Forbidden") => new HttpError(403, code, msg);
export const locked = (code = "locked", msg = "Locked", details?: Record<string, unknown>) =>
  new HttpError(423, code, msg, details);
export const notFound = (code = "not_found", msg = "Not found") => new HttpError(404, code, msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const badGateway = (code: string, msg: string) => new HttpError(502, code, msg);
export const serviceUnavailable = (code: string, msg: string) => new HttpError(503, code, msg);
export const gatewayTimeout = (code: string, msg: string) => new HttpError(504, code, msg);
export const tooMany = (msg = "Too many requests", retryAfter?: number) => {
  const e = new HttpError(429, "rate_limited", msg);
  (e as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
  return e;
};
