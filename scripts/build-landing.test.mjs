import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("landing build script", () => {
  it("renders legal contact links without leaking the retired email address", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "routino-landing-test-"));

    function copyInput(relativePath) {
      cpSync(join(ROOT, relativePath), join(sandbox, relativePath), { recursive: true });
    }

    try {
      copyInput("scripts/build-landing.mjs");
      copyInput("landing/index.template.html");
      copyInput("landing/legal.template.html");
      copyInput("landing/shots");
      copyInput("public/brand");
      copyInput("public/icons/favicon-16.png");
      copyInput("public/icons/favicon-32.png");
      copyInput("public/favicon.ico");
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

      const homeHtml = readFileSync(join(sandbox, "dist", "index.html"), "utf8");
      for (const html of [homeHtml, legalHtml]) {
        assert.match(html, /\/brand\/logo-dark\.webp/);
        assert.match(html, /\/icons\/favicon-32\.png/);
        assert.match(html, /\/favicon\.ico/);
        assert.equal(html.includes("favicon.svg"), false);
      }
      assert.equal(existsSync(join(sandbox, "dist", "brand", "logo-dark.webp")), true);
      assert.equal(existsSync(join(sandbox, "dist", "icons", "favicon-16.png")), true);
      assert.equal(existsSync(join(sandbox, "dist", "icons", "favicon-32.png")), true);
      assert.equal(existsSync(join(sandbox, "dist", "favicon.ico")), true);

      const headers = readFileSync(join(sandbox, "dist", "_headers"), "utf8");
      assert.match(
        headers,
        /\/\*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains/,
      );
      assert.match(headers, /  X-Content-Type-Options: nosniff/);
      assert.match(headers, /  X-Frame-Options: DENY/);
      assert.match(headers, /  Referrer-Policy: strict-origin-when-cross-origin/);
      assert.match(headers, /  Content-Security-Policy: .*frame-ancestors 'none'.*/);
      assert.match(headers, /\/app\/index\.html\n  Cache-Control: no-cache/);
      assert.match(headers, /\/app\n  Cache-Control: no-cache/);
      assert.match(headers, /\/app\/\n  Cache-Control: no-cache/);
      assert.match(headers, /\/app\/sw\.js\n  Cache-Control: no-cache/);
      assert.match(headers, /\/app\/manifest\.webmanifest\n  Cache-Control: no-cache/);
      assert.match(
        headers,
        /\/app\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/,
      );
      assert.match(
        headers,
        /\/app\/workbox-\*\.js\n  Cache-Control: public, max-age=31536000, immutable/,
      );

      const routes = JSON.parse(readFileSync(join(sandbox, "dist", "_routes.json"), "utf8"));
      assert.deepEqual(routes, {
        version: 1,
        include: ["/v1/*", "/app/*"],
        exclude: [
          "/app",
          "/app/",
          "/app/index.html",
          "/app/assets/*",
          "/app/brand/*",
          "/app/icons/*",
          "/app/sw.js",
          "/app/workbox-*.js",
          "/app/manifest.webmanifest",
          "/app/favicon.ico",
          "/app/robots.txt",
        ],
      });
      assert.equal(existsSync(join(sandbox, "dist", "_redirects")), false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
