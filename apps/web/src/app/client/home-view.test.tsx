import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// Home's markup for what comes from closed applications and the workload.

vi.mock("next/navigation", () => ({ usePathname: () => "/client", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ saveTargetAction: vi.fn() }));

import { overviewProps } from "./home-props";
import { HomeView } from "./home-view";
import type { HomeRead } from "@/lib/client/home";
import { WIDGET_KEYS, defaultWidgets, type Placed, type WidgetKey } from "@/lib/client/home-widgets";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const read: HomeRead = {
  departments: [],
  departmentId: null,
  jobs: [],
  jobId: null,
  applications: { current: 0, previous: 0, change: null, bins: [] },
  daily: [0, 0, 0, 0],
  sources: { referral: 0, tacit: 0, careers: 0, sourced: 0, agency: 0, event: 0, other: 0 },
  hires: Array.from({ length: 24 }, () => 0),
  offers: [],
  waiting: [],
  stages: null,
  stays: [{ stage: "screening", avgDays: 2, stays: 3 }],
  efficiency: null,
  interviews: [],
  names: {},
  feedback: [],
  feedbackMedianHours: null,
  outstanding: [],
  targets: {},
  truncated: false,
};
/** Every widget, at its first size, so a test reads whichever it wants. */
const every: Placed[] = WIDGET_KEYS.map((k) => ({ k, w: 2 }));
const page = (over: Partial<HomeRead> = {}, layout = every) => renderToStaticMarkup(<HomeView {...overviewProps({ ...read, ...over }, 7, NOW, false)} layout={layout} />);
const placed = (html: string) => [...html.matchAll(/data-wk="(\w+)"/g)].map((m) => m[1] as WidgetKey);

describe("Interview efficiency", () => {
  test("too few closed says so", () => {
    expect(page()).toContain("Not enough closed yet");
  });

  test("the rounds and what a hire costs, and no made-up estimate", () => {
    const html = page({ efficiency: { closed: 8, hires: 2, rounds: [{ label: "Round 1 to round 2", from: 4, to: 3, rate: 0.75 }], interviewsPerHire: 4, hoursPerHire: 3.5 } });
    expect(html).toContain("Round 1 to round 2");
    expect(html).toContain("75%");
    expect(html).toContain("interviews per hire");
    // The figure is drawn in parts (its point and unit in their own spans, stat-number.tsx): read its text.
    expect(html.replace(/<[^>]+>/g, "")).toContain("3.5h");
    expect(html).not.toContain("Not enough closed yet");
    expect(html).not.toMatch(/could free|Testbench|Estimate/);
  });
});

describe("the layout", () => {
  test("the widgets are drawn in the member's order", () => {
    const html = page({}, [{ k: "hires", w: 1 }, { k: "stays", w: 2 }, { k: "apps", w: 1 }]);
    expect(placed(html)).toEqual(["hires", "stays", "apps"]);
    expect(html).not.toContain("Bottlenecks");
    expect(html).toContain("wg w2");
  });

  test("with none saved, the Overview's default, which says each thing once", () => {
    const html = renderToStaticMarkup(<HomeView {...overviewProps(read, 7, NOW, false)} />);
    expect(placed(html)).toEqual(defaultWidgets().map((x) => x.k));
    // Applications over time has the top row; New applications, the same number, waits in the gallery.
    expect(placed(html)).toContain("trend");
    expect(placed(html)).not.toContain("apps");
  });

  test("someone who manages no job has no feedback widgets, even if their layout names them", () => {
    expect(placed(page({ feedback: null }))).not.toEqual(expect.arrayContaining(["cards"]));
    expect(placed(page({ feedback: null })).filter((k) => ["cards", "byiv", "outfb"].includes(k))).toEqual([]);
    expect(placed(page()).filter((k) => ["cards", "byiv", "outfb"].includes(k))).toEqual(["cards", "byiv", "outfb"]);
  });

  test("an empty layout says so and offers the way back", () => {
    expect(page({}, [])).toContain("No widgets on your Overview");
  });

  test("the bar offers editing and Present, and no edit controls until asked", () => {
    const html = page();
    expect(html).toContain("Edit widgets");
    expect(html).toContain("Present");
    expect(html).not.toContain("Drag to move");
    expect(html).not.toContain("wg-x");
  });
});

test("an offer's row is who and what job", () => {
  const html = page({ offers: [{ requestId: "r1", candidateName: "Ada Park", jobTitle: "Engineer", requestedBy: "Lin", requestedAt: new Date(NOW).toISOString() }] });
  expect(html).toContain("Ada Park");
  expect(html).toContain("/client/inbox?i=appr-r1");
});
