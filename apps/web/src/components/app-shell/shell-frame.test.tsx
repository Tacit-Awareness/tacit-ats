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
  test("has Tutorial, a button, and Settings, a link, side by side under your name", () => {
    const html = shell(false);
    const foot = html.slice(html.indexOf('class="sb-foot"'));
    const tools = foot.slice(foot.indexOf('class="sb-tools"'));
    expect(tools).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Tutorial<\/span><\/button>/);
    expect(tools).toContain('href="/client/settings"');
    expect(tools.indexOf("Tutorial")).toBeLessThan(tools.indexOf("Settings"));
    expect(foot.indexOf("Account: Sam")).toBeLessThan(foot.indexOf('class="sb-tools"'));
    // Documentation and the keys are in the account menu now.
    const sidebar = foot.slice(0, foot.indexOf("</aside>"));
    expect(sidebar).not.toContain("Keyboard shortcuts");
    expect(sidebar).not.toContain('href="/client/docs"');
  });

  test("has no Integrations link: its panels are in Settings", () => {
    expect(shell(false)).not.toContain("/client/integrations");
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
