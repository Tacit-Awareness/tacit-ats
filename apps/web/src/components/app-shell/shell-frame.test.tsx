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

describe("the sidebar's Onboarding section", () => {
  const section = () => {
    const html = shell(false);
    const at = html.indexOf('aria-label="Onboarding"');
    return html.slice(at, html.indexOf("</nav>", at));
  };

  test("is Team, Interview process and CRM, in that order, and CRM has left the top", () => {
    const html = section();
    expect(html).toContain('href="/client/onboarding/people"');
    expect(html.indexOf(">Team<")).toBeLessThan(html.indexOf(">Interview process<"));
    expect(html.indexOf(">Interview process<")).toBeLessThan(html.indexOf(">CRM<"));
    const all = shell(false);
    const top = all.slice(all.indexOf('aria-label="Home"'), all.indexOf('aria-label="Top of Funnel"'));
    expect(top).not.toContain(">CRM<");
  });

  test("says nothing of a Grokbot", () => {
    expect(section()).not.toMatch(/grok/i);
  });
});

test("the toasts are there from the start, so a reader hears the first, and stay live under a pop-up", () => {
  const html = renderToStaticMarkup(<Toaster />);
  expect(html).toContain('role="status"');
  expect(html).toContain("data-toasts");
});
