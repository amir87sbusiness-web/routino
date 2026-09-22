import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

for (const name of ["pay-start.html", "pay-start.js"]) {
  copyFileSync(join(ROOT, "public", name), join(DIST, name));
}

// Keep the old /app handoff path static during rollout so an older Edge deploy
// can never fall through to the authenticated SPA/login screen.
const routesPath = join(DIST, "_routes.json");
const routes = JSON.parse(readFileSync(routesPath, "utf8"));
routes.exclude ??= [];
for (const path of ["/app/pay-start.html", "/app/pay-start.js"]) {
  if (!routes.exclude.includes(path)) routes.exclude.push(path);
}
writeFileSync(routesPath, JSON.stringify(routes, null, 2) + "\n");

const headersPath = join(DIST, "_headers");
let headers = readFileSync(headersPath, "utf8");
if (!headers.includes("/pay-start.html")) {
  headers += [
    "# Payment handoff is a tiny public bridge, never an authenticated app page.",
    "/pay-start.html",
    "  Cache-Control: no-store",
    "",
    "/pay-start.js",
    "  Cache-Control: no-cache",
    "",
    "/app/pay-start.html",
    "  Cache-Control: no-store",
    "",
    "/app/pay-start.js",
    "  Cache-Control: no-cache",
    "",
  ].join("\n");
}
writeFileSync(headersPath, headers.endsWith("\n") ? headers : headers + "\n");

console.log("[payment-handoff] published static root bridge and SPA bypass");
