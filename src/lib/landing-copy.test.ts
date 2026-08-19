import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const templatePath = resolve(process.cwd(), "landing", "index.template.html");
const template = readFileSync(templatePath, "utf8");

describe("public landing copy", () => {
  it("keeps the page concise and removes claims the local-only product cannot make", () => {
    expect(template).not.toContain("بعد همگام می‌شه");
    expect(template).not.toContain("همون اطلاعات روی گوشی و لپ‌تاپت باز می‌شه");
    expect(template).not.toContain("گوشی و لپ‌تاپ");
    expect(template).not.toContain("امسال رو");
    expect(template).toContain('هر روز، <span class="hl">یک قدم</span> جلوتر');
    expect(template).toContain("اطلاعاتت روی همین دستگاه می‌مونه");
  });

  it("leaves one build-time slot for the Android download action", () => {
    expect(template.match(/<!--ANDROID-DOWNLOAD-->/g)).toHaveLength(1);
  });

  it("routes every primary start action to the download section, never into the web app", () => {
    expect(template).toContain('id="download"');
    expect(template.match(/href="#download"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(template).toContain("نسخه وب برای آیفون و دسکتاپ");
    const beforeDownload = template.slice(0, template.indexOf('id="download"'));
    expect(beforeDownload).not.toContain('href="/app/"');
  });

  it("does not expose the removed email contact", () => {
    expect(template).not.toContain("mailto:");
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
