import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The sidebar's foot, in the markup. Starting the tutorial is lib/tour.ts and a look at the page.

vi.mock("next/navigation", () => ({ usePathname: () => "/client", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { Toaster } from "@/components/toasts";
import { ShellFrame } from "./shell-frame";

const shell = (collapsed: boolean) =>
  renderToStaticMarkup(
    <ShellFrame actorId="a" org="Acme" orgLogoUrl={null} user={{ name: "Sam", email: "s@a.co", level: "Admin" }} jobs={[]} sidebar={{ width: 240, collapsed }}>
      <p>page</p>
    </ShellFrame>,
  );

describe("the sidebar's foot", () => {
  test("has Tutorial, a button, between Documentation and the keys", () => {
    const html = shell(false);
    const foot = html.slice(html.indexOf('class="sb-foot"'));
    expect(foot).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Tutorial<\/span><\/button>/);
    expect(foot.indexOf("Documentation")).toBeLessThan(foot.indexOf("Tutorial"));
    expect(foot.indexOf("Tutorial")).toBeLessThan(foot.indexOf("Keyboard shortcuts"));
  });

  test("on the rail the label has gone, so the button names itself", () => {
    expect(shell(true)).toMatch(/title="Tutorial" aria-label="Tutorial"/);
    expect(shell(false)).not.toContain('aria-label="Tutorial"');
  });
});

test("the toasts are there from the start, so a reader hears the first, and stay live under a pop-up", () => {
  const html = renderToStaticMarkup(<Toaster />);
  expect(html).toContain('role="status"');
  expect(html).toContain("data-toasts");
});
