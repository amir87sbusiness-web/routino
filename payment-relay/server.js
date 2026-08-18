import { createServer } from "node:http";
import { createRelayHandler } from "./relay.js";

const merchant = process.env.ZIBAL_MERCHANT?.trim() ?? "";
const secret = process.env.RELAY_SECRET ?? "";
const port = Number(process.env.PORT ?? 3000);

if (!merchant) throw new Error("ZIBAL_MERCHANT is required");
if (secret.length < 32) throw new Error("RELAY_SECRET must be at least 32 characters");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");

const relay = createRelayHandler({ merchant, secret });

const server = createServer({ maxHeaderSize: 8 * 1024 }, async (incoming, outgoing) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > 8 * 1024) {
        outgoing.writeHead(413, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        outgoing.end('{"error":"payload_too_large"}');
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
    outgoing.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    outgoing.end('{"error":"internal"}');
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[payment-relay] listening on :${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
