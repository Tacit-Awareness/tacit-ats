import { brandCss } from "@tacit/core/dist/brand/theme.js";

/**
 * The company's accent over the ATS's own, in both themes. brandCss writes
 * nothing but a validated #rrggbb's derived colours, so this is safe to inline,
 * and the theme file alone is imported so a public page does not take in the
 * rest of core. Rendered after globals.css, and matching its selectors, so it wins.
 */
export function BrandStyle({ accent }: { accent: string | null }) {
  const css = brandCss(accent);
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
