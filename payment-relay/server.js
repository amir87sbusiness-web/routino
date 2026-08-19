import { createRelayHandler, validateRelayConfig } from "./relay.js";
import { createRelayServer } from "./server-core.js";

const merchant = process.env.ZIBAL_MERCHANT?.trim() ?? "";
const secret = process.env.RELAY_SECRET ?? "";
const port = Number(process.env.PORT ?? 3000);

validateRelayConfig({
  merchant,
  secret,
  nodeEnv: process.env.NODE_ENV,
  allowTestProviders: process.env.ALLOW_TEST_PROVIDERS,
});
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");

const relay = createRelayHandler({ merchant, secret });
const server = createRelayServer({ relay });

server.listen(port, "0.0.0.0", () => {
  console.log(`[payment-relay] listening on :${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
