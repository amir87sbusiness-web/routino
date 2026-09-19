import postcss from "postcss";

/**
 * Tailwind 4 puts its reset and utilities inside CSS cascade layers. Older
 * Android WebViews ignore an unknown @layer block wholesale, which leaves the
 * otherwise working React app as unstyled HTML. The native build only unwraps
 * those containers; it keeps every selector and declaration unchanged.
 */
export function flattenCascadeLayers(css: string): string {
  const root = postcss.parse(css);
  root.walkAtRules("layer", (rule) => {
    if (rule.nodes) rule.replaceWith(...rule.nodes);
    else rule.remove();
  });
  return root.toString();
}
