import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Logo } from "@/components/ui";

describe("Logo", () => {
  it("renders the approved light and dark assets under the app theme class", () => {
    const html = renderToStaticMarkup(<Logo className="h-8 w-8" />);

    expect(html).toContain("brand/logo-light.webp");
    expect(html).toContain("brand/logo-dark.webp");
    expect(html).toContain("dark:hidden");
    expect(html).toContain("dark:block");
    expect(html).toContain("h-8 w-8");
    expect(html).not.toContain("favicon.svg");
  });
});
