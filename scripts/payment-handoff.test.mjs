import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("publishes both Pages canonical URLs outside the app function", () => {
  const dir = mkdtempSync(join(tmpdir(), "routino-handoff-"));
  try {
    mkdirSync(join(dir, "dist"));
    cpSync("public", join(dir, "public"), { recursive: true });
    mkdirSync(join(dir, "scripts"));
    cpSync("scripts/publish-payment-handoff.mjs", join(dir, "scripts/publish-payment-handoff.mjs"));
    writeFileSync(
      join(dir, "dist/_routes.json"),
      JSON.stringify({ version: 1, include: ["/app/*", "/v1/*"], exclude: [] }),
    );
    writeFileSync(join(dir, "dist/_headers"), "/*\n  X-Content-Type-Options: nosniff\n");
    const run = spawnSync(process.execPath, ["scripts/publish-payment-handoff.mjs"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const routes = JSON.parse(readFileSync(join(dir, "dist/_routes.json"), "utf8"));
    expect(routes.exclude).toEqual(
      expect.arrayContaining(["/app/pay-start", "/app/pay-start/", "/app/pay-start.html"]),
    );
    expect(readFileSync(join(dir, "dist/app/pay-start.html"), "utf8")).toBe(
      readFileSync("public/pay-start.html", "utf8"),
    );
    const headers = readFileSync(join(dir, "dist/_headers"), "utf8");
    expect(headers).toContain("/pay-start\n  Cache-Control: no-store");
    expect(headers).toContain("/app/pay-start\n  Cache-Control: no-store");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
