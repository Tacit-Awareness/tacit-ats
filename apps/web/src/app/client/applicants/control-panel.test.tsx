import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// What the panel draws, to markup. The actions are stubs: nothing here routes,
// writes or sends. The keys and the pick need a browser, so this holds the form
// to the fields routeApplicantAction reads.

vi.mock("./actions", () => ({ routeApplicantAction: vi.fn(), draftReplyAction: vi.fn(), sendReplyAction: vi.fn() }));

import { ControlPanel } from "./control-panel";
import type { Reply } from "./reply-box";
import type { Routing } from "./routing-bar";

const routing: Routing = { applicationId: "a1", next: "a2", reasons: [{ reasonId: "r1", name: "Not a fit" }] };
const reply: Reply = {
  applicationId: "a1",
  candidateId: "p1",
  to: "nia@x.test",
  enabled: true,
  draft: null,
  sender: null,
  failed: null,
  sent: null,
  starters: { subject: "Your application", bodies: { interview: "Hi Nia, meet us", testbench: "Hi Nia, try it", decline: "Hi Nia, no", blank: "Hi Nia," } },
  subjectMax: 300,
  bodyMax: 20000,
};
const html = (over: { routing?: Routing | null; reply?: Reply | null; team?: string | null } = {}) =>
  renderToStaticMarkup(<ControlPanel routing={routing} reply={reply} team="Engineering › Platform" {...over} />);

describe("the control panel", () => {
  test("posts what routeApplicantAction reads: the application, the next ticket, the route and the reason", () => {
    const out = html();
    expect(out).toMatch(/type="hidden" name="applicationId" value="a1"/);
    expect(out).toMatch(/type="hidden" name="next" value="a2"/);
    expect(out).toMatch(/<button type="submit" value="interview"[^>]* name="route"/);
    expect(out).toContain('name="reasonId"');
    expect(out).toContain("Not a fit");
  });

  test("the next step is three pills, with interview picked first, and Testbench posts no route", () => {
    const out = html();
    expect(out.match(/aria-pressed="true"[^>]*aria-keyshortcuts="[ITD]"/g)).toEqual(['aria-pressed="true" aria-keyshortcuts="I"']);
    expect(out.match(/aria-pressed="false"[^>]*aria-keyshortcuts="[ITD]"/g)).toHaveLength(2);
    expect(out).not.toContain('value="testbench"');
  });

  test("only the picked move can be posted: Enter in the reason submits the form's first button", () => {
    expect(html().match(/<button type="submit" value="[a-z]+"[^>]* name="route"/g)).toHaveLength(1);
  });

  test("the picked pill wears the hover highlight", () => {
    const pills = html().match(/<button type="button" aria-pressed="(true|false)"[^>]*aria-keyshortcuts="[ISD]"[^>]*>/g)!;
    const picked = pills.find((p) => p.includes('aria-pressed="true"'))!;
    expect(picked).toContain(" bg-foreground/[0.12]");
    expect(picked).toContain("hover:bg-foreground/[0.12]");
    expect(pills.find((p) => p.includes('aria-pressed="false"'))).not.toContain(" bg-foreground/[0.12]");
  });

  test("the reply opens on the picked move's starter", () => {
    const out = html();
    expect(out).toContain("Hi Nia, meet us");
    expect(out).not.toContain("Hi Nia, no");
  });

  test("the team is shown, and only as a fact", () => {
    expect(html()).toMatch(/<span title="Engineering › Platform"/);
    expect(html({ team: null })).not.toContain(">Team<");
  });

  test("a member who may not move them gets the reply and the team, and no route", () => {
    const out = html({ routing: null });
    expect(out).not.toContain('name="route"');
    expect(out).toContain(">Team<");
    expect(out).toContain("Review draft");
  });

  test("a member who may not email them gets the next step alone", () => {
    const out = html({ reply: null });
    expect(out).toContain('name="route"');
    expect(out).not.toContain("Review draft");
  });
});
