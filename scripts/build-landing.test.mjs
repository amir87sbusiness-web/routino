import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "routino-landing-test-"));

function copyInput(relativePath) {
  cpSync(join(ROOT, relativePath), join(sandbox, relativePath), { recursive: true });
}

try {
  copyInput("scripts/build-landing.mjs");
  copyInput("landing/index.template.html");
  copyInput("landing/legal.template.html");
  copyInput("landing/shots");
  copyInput("public/favicon.svg");
  copyInput("src/lib/legal-info.ts");
  copyInput("src/lib/legal-text.json");
  symlinkSync(
    join(ROOT, "node_modules"),
    join(sandbox, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const build = spawnSync(process.execPath, ["scripts/build-landing.mjs"], {
    cwd: sandbox,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const legalHtml = readFileSync(join(sandbox, "dist", "legal", "index.html"), "utf8");
  assert.match(legalHtml, /https:\/\/t\.me\/routino_support/);
  assert.match(legalHtml, /https:\/\/instagram\.com\/routino\.me/);
  assert.equal(legalHtml.includes(["mail", "to:"].join("")), false);
  assert.equal(legalHtml.includes(["amir.templates", "gmail.com"].join("@")), false);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
