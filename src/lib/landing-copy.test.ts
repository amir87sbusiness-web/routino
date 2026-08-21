import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const templatePath = resolve(process.cwd(), "landing", "index.template.html");
const template = readFileSync(templatePath, "utf8");

describe("public landing copy", () => {
  it("describes verified local-first account sync without a local-only claim", () => {
    expect(template).not.toContain("اطلاعاتت روی همین دستگاه می‌مونه");
    expect(template).not.toContain("فقط روی همین دستگاه");
    expect(template).not.toContain("امسال رو");
    expect(template).toContain('هر روز، <span class="hl">یک قدم</span> جلوتر');
    expect(template).toContain(
      "نسخهٔ محلی همیشه در دسترسه و وقتی آنلاین بشی، اطلاعات حسابت بین دستگاه‌ها همگام می‌شه.",
    );
    expect(template).toContain("آفلاین و همگام");
  });

  it("leaves one build-time slot for the Android download action", () => {
    expect(template.match(/<!--ANDROID-DOWNLOAD-->/g)).toHaveLength(1);
  });
});

describe("Android download markup", () => {
  it("renders an honest disabled action before an upload URL exists", async () => {
    // The build script is JavaScript by design so Cloudflare can run it with
    // plain Node. Vitest exercises the exported renderer directly.
    // @ts-expect-error no declaration file is needed for this build-only module.
    const { renderAndroidDownload } = await import("../../scripts/build-landing.mjs");
    const html = renderAndroidDownload("");
    expect(html).toContain("disabled");
    expect(html).toContain("بعد از انتشار");
    expect(html).not.toContain("<a ");
  });

  it("accepts only HTTPS and escapes the cloud URL", async () => {
    // @ts-expect-error build-only JavaScript module.
    const { renderAndroidDownload } = await import("../../scripts/build-landing.mjs");
    expect(() => renderAndroidDownload("http://files.example/app.apk")).toThrow(/HTTPS/);
    const html = renderAndroidDownload("https://files.example/routino.apk?from=site&v=1");
    expect(html).toContain('href="https://files.example/routino.apk?from=site&amp;v=1"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).not.toContain("disabled");
  });
});
