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
  test("has Tutorial, a button, the theme, and Settings, a link, beside your name", () => {
    const html = shell(false);
    const foot = html.slice(html.indexOf('class="sb-foot"'));
    const tools = foot.slice(foot.indexOf('class="sb-tools"'));
    expect(tools).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Tutorial<\/span><\/button>/);
    expect(tools).toContain('aria-label="Appearance"');
    expect(tools).toContain('href="/client/settings"');
    expect(tools.indexOf("Tutorial")).toBeLessThan(tools.indexOf("Settings"));
    expect(foot.indexOf("Account: Sam")).toBeLessThan(foot.indexOf('class="sb-tools"'));
    // Documentation and the keys are in the account menu.
    const sidebar = foot.slice(0, foot.indexOf("</aside>"));
    expect(sidebar).not.toContain("Keyboard shortcuts");
    expect(sidebar).not.toContain('href="/client/docs"');
  });

  test("has no Integrations link: its panels are in Settings", () => {
    expect(shell(false)).not.toContain("/client/integrations");
  });

  test("on the rail a row's label has gone, so the link names itself", () => {
    expect(shell(true)).toMatch(/aria-label="Triage"/);
    expect(shell(false)).not.toMatch(/aria-label="Triage"/);
  });
});

describe("All Teams", () => {
  const nav = (html = shell(false)) => {
    const at = html.indexOf('aria-label="All Teams"');
    return html.slice(at, html.indexOf("</nav>", at));
  };

  test("is Home, Triage, Tickets with People, Interviews and Offers under it, then Listings & Asks", () => {
    const labels = [...nav().matchAll(/class="sb-label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Home", "Triage", "Tickets", "People", "Interviews", "Offers", "Listings &amp; Asks"]);
  });

  test("each row opens the page that does its work until its own screen lands", () => {
    const html = nav();
    for (const href of ["/client", "/client/triage", "/client/tickets", "/client/tickets/people", "/client/tickets/interviews", "/client/tickets/offers", "/client/jobs"]) expect(html).toContain(`href="${href}"`);
  });

  test("People and Interviews hang under Tickets", () => {
    expect(nav()).toMatch(/sb-under[^>]*href="\/client\/tickets\/people"|href="\/client\/tickets\/people"[^>]*sb-under/);
  });

  test("says nothing of a Grokbot", () => {
    expect(shell(false)).not.toMatch(/grok/i);
  });
});

describe("Teams", () => {
  const withTeams = () =>
    renderToStaticMarkup(
      <ShellFrame actorId="a" org="Acme" orgLogoUrl={null} user={{ name: "Sam", email: "s@a.co", level: "Admin" }} jobs={[]} teams={[{ id: "d1", name: "Engineering", depth: 0 }, { id: "d2", name: "Infra", depth: 1 }]} sidebar={{ width: 240, collapsed: false }}>
        <p>page</p>
      </ShellFrame>,
    );

  test("are the org's departments, counted, with a way to find one", () => {
    const html = withTeams();
    expect(html).toMatch(/Teams <span[^>]*>2<\/span>/);
    expect(html).toContain(">Engineering<");
    expect(html).toContain(">Infra<");
    expect(html).toContain('aria-label="Find a team"');
  });

  test("an org without departments, or an interviewer, gets no Teams", () => {
    expect(shell(false)).not.toContain("Find a team");
  });
});

test("the toasts are there from the start, so a reader hears the first, and stay live under a pop-up", () => {
  const html = renderToStaticMarkup(<Toaster />);
  expect(html).toContain('role="status"');
  expect(html).toContain("data-toasts");
});

describe("the company switcher", () => {
  const withCompanies = (companies: { id: string; name: string }[]) =>
    renderToStaticMarkup(
      <ShellFrame actorId="a" org="Acme" orgLogoUrl={null} orgId="o1" companies={companies} user={{ name: "Sam", email: "s@a.co", level: "Admin" }} jobs={[]} sidebar={{ width: 240, collapsed: false }}>
        <p>page</p>
      </ShellFrame>,
    );

  test("someone in several companies gets the switch in the workspace menu on the company's name", () => {
    const html = withCompanies([{ id: "o1", name: "Acme" }, { id: "o2", name: "Globex" }]);
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-label="Company: Acme\. Switch company"/);
  });

  test("someone in one company has nothing to switch to", () => {
    expect(withCompanies([{ id: "o1", name: "Acme" }])).not.toContain("Switch company");
    expect(shell(false)).not.toContain("Switch company");
  });
});
