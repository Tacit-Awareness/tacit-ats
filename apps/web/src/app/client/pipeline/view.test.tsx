import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The Pipeline's frame, in the markup: the switch and what a row does.

vi.mock("next/navigation", () => ({ usePathname: () => "/client/pipeline", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ moveCardAction: vi.fn() }));

import { PersonPopup } from "./popup";
import { PipelineView, type LayoutSwitch, type PipelineListProps } from "./view";

const person = { applicationId: "a1", href: "/client/candidates/p1", name: "Ann Lee", status: "Waiting", facts: "Engineer", time: "2d", stuck: false, openHref: "/client/pipeline?open=a1", active: false };
const list: PipelineListProps = {
  modes: [{ href: "/client/pipeline", label: "Stuck", active: true }],
  stages: [],
  groups: [{ key: "new", label: "New", total: 1, rows: [person], more: null, moreHref: null }],
  zero: null,
};
const across: LayoutSwitch = { on: "list", list: "/client/pipeline", board: null };
const oneJob: LayoutSwitch = { on: "list", list: "/client/pipeline?job=j1&layout=list", board: "/client/pipeline?job=j1" };
const page = (over: Partial<React.ComponentProps<typeof PipelineView>> = {}) =>
  renderToStaticMarkup(
    <PipelineView total={1} columns={[]} list={list} departments={[]} job={null} search={{ q: "", keep: {} }} view={null} empty={null} capped={false} layout={across} {...over} />,
  );

describe("a row", () => {
  test("opens the pop-up, not the page, and leaves the list where it was", () => {
    const html = page();
    expect(html).toContain('href="/client/pipeline?open=a1"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-pop-row="a1"');
    expect(html).not.toContain('href="/client/candidates/p1"');
  });

  test("the pop-up goes back to the list, or on to the page", () => {
    const html = renderToStaticMarkup(
      <PersonPopup applicationId="a1" title="Ann Lee" subject="Engineer · New" home="/client/pipeline?mode=everyone" pageHref="/client/candidates/p1">
        <p>body</p>
      </PersonPopup>,
    );
    expect(html).toMatch(/role="dialog" aria-modal="true"/);
    expect(html).toContain("Ann Lee");
    expect(html).toContain('aria-label="Open as a page"');
    expect(html).toContain('href="/client/candidates/p1"');
    expect(html).toMatch(/href="\/client\/pipeline\?mode=everyone"/);
    expect(html).not.toContain("<dialog");
  });
});

describe("past candidates", () => {
  const past = { href: "/client/candidates?q=rust", label: "3 past candidates in CRM also match “rust”" };

  test("a line that leads to the CRM, and no people", () => {
    const html = page({ past });
    expect(html).toContain('href="/client/candidates?q=rust"');
    expect(html).toContain(past.label);
  });

  test("hidden with none", () => {
    expect(page({ past: null })).not.toContain("past candidate");
    expect(page()).not.toContain("past candidate");
  });

  test("shows over an empty pipeline too", () => {
    expect(page({ past, empty: "Nobody is in an open job's pipeline yet." })).toContain(past.label);
  });
});

describe("the List / Board switch", () => {
  test("across jobs Board is off, and says why", () => {
    const html = page();
    expect(html).toContain('aria-label="Layout"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Board"[^>]*title="Pick one job to see it as a board"/);
  });

  test("with a job both are links, the one showing marked", () => {
    const html = page({ layout: oneJob });
    expect(html).toMatch(/aria-label="List"[^>]*aria-current="page"/);
    expect(html).toContain('href="/client/pipeline?job=j1"');
    expect(html).not.toContain("disabled");
  });

  test("the board has no Stuck / Everyone: everyone is on it", () => {
    const html = page({ list: null, layout: { ...oneJob, on: "board" } });
    expect(html).not.toContain('aria-label="Show"');
    expect(html).toMatch(/aria-label="Board"[^>]*aria-current="page"/);
  });

  test("nobody in the pipeline, no switch", () => {
    expect(page({ empty: "Nobody is in an open job's pipeline yet." })).not.toContain('aria-label="Layout"');
  });
});
