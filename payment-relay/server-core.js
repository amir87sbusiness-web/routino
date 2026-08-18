import { createServer } from "node:http";

const MAX_BODY_BYTES = 8 * 1024;

function sendJson(outgoing, status, body) {
  outgoing.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  outgoing.end(JSON.stringify(body));
}

export function createRelayServer({ relay }) {
  if (typeof relay !== "function") throw new TypeError("relay handler is required");

  const server = createServer({ maxHeaderSize: 8 * 1024 }, async (incoming, outgoing) => {
    try {
      const declaredLength = Number(incoming.headers["content-length"] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        sendJson(outgoing, 413, { error: "payload_too_large" });
        return;
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > MAX_BODY_BYTES) {
          sendJson(outgoing, 413, { error: "payload_too_large" });
          return;
        }
        chunks.push(bytes);
      }

      const method = incoming.method ?? "GET";
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`https://relay.routino.internal${incoming.url ?? "/"}`, {
        method,
        headers: incoming.headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
      const response = await relay(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) sendJson(outgoing, 500, { error: "internal" });
      else outgoing.destroy();
    }
  });

  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;
  return server;
}
