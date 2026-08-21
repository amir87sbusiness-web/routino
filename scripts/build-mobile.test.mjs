import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("mobile production build", () => {
  it("embeds the production API origin instead of the WebView localhost origin", () => {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("npm_execpath is required to run the production build");
    execFileSync(process.execPath, [npmCli, "run", "build:mobile"], {
      cwd: root,
      env: process.env,
      stdio: "pipe",
    });

    const assetsDir = join(root, "www", "assets");
    const javascript = readdirSync(assetsDir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(assetsDir, name), "utf8"))
      .join("\n");

    expect(javascript).toContain("https://api.routino.me/v1");
  });
});
