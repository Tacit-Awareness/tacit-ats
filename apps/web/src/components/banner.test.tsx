import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BANNER_ICONS, BANNER_STATUSES } from "@/lib/banner-rules";
import { Banner } from "./banner";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("a banner", () => {
  test("each status draws its own glyph and colour class, and a warning or an error is an alert", () => {
    for (const status of BANNER_STATUSES) {
      const out = html(<Banner status={status} title="T" />);
      expect(out).toContain(`s-${status}`);
      expect(out).toContain(BANNER_ICONS[status]);
      expect(out).toContain(`role="${status === "warning" || status === "error" ? "alert" : "status"}"`);
    }
    expect(html(<Banner title="T" />)).toContain("s-default");
  });

  test("contrast, variant and size are classes; low, inline and default add none", () => {
    const plain = html(<Banner title="T" />);
    for (const c of ["high", "fixed", "compact", "out"]) expect(plain).not.toMatch(new RegExp(`class="[^"]*\\b${c}\\b`));
    const all = html(<Banner title="T" contrast="high" variant="fixed" size="compact" />);
    expect(all).toMatch(/class="bn s-default high fixed compact"/);
  });

  test("title and line are text, never markup; no line draws no line", () => {
    const out = html(<Banner title="<img src=x>" desc="<script>x</script>" />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img src=x&gt;");
    expect(html(<Banner title="T" />)).not.toContain("bn-d");
  });

  test("up to three actions, primary first and ghost last; a link is a link, an external one opens a tab", () => {
    const out = html(
      <Banner
        title="T"
        actions={[
          { label: "Ignore", variant: "ghost", dismiss: true },
          { label: "Send by email" },
          { label: "Reconnect", variant: "primary", href: "/client/settings" },
          { label: "Fourth" },
        ]}
      />,
    );
    expect(out).not.toContain("Fourth");
    const order = ["Reconnect", "Send by email", "Ignore"].map((l) => out.indexOf(`>${l}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toMatch(/<a [^>]*href="\/client\/settings"[^>]*>Reconnect</);
    expect(out).toMatch(/<button[^>]*class="[^"]*bn-a ghost"[^>]*>Ignore</);
    const ext = html(<Banner title="T" actions={[{ label: "Docs", href: "https://example.com", external: true }]} />);
    expect(ext).toContain('target="_blank"');
    expect(ext).toContain('rel="noopener noreferrer"');
    expect(html(<Banner title="T" />)).not.toContain("bn-acts");
  });

  test("dismissible draws the ✕; without an id it is on the server's page", () => {
    expect(html(<Banner title="T" dismissible />)).toContain('aria-label="Dismiss"');
    expect(html(<Banner title="T" />)).not.toContain("Dismiss");
  });

  test("a dismissible banner with an id waits for the browser, which knows whether it was dismissed", () => {
    expect(html(<Banner id="a" title="T" dismissible />)).toBe("");
    // An id alone remembers nothing, so it is drawn.
    expect(html(<Banner id="a" title="T" />)).toContain('data-banner="a"');
  });

  test("an icon of its own replaces the status's glyph", () => {
    const out = html(<Banner status="info" icon="M1 1h2" title="T" />);
    expect(out).toContain('d="M1 1h2"');
    expect(out).not.toContain(BANNER_ICONS.info);
  });
});
