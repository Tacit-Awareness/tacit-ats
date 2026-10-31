import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// Home's markup for what comes from closed applications and the workload.

vi.mock("next/navigation", () => ({ usePathname: () => "/client", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ saveTargetAction: vi.fn() }));

import { overviewProps } from "./home-props";
import { HomeView } from "./home-view";
import type { HomeRead } from "@/lib/client/home";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const read: HomeRead = {
  departments: [],
  departmentId: null,
  jobs: [],
  jobId: null,
  applications: { current: 0, previous: 0, change: null, bins: [] },
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
const page = (over: Partial<HomeRead> = {}) => renderToStaticMarkup(<HomeView {...overviewProps({ ...read, ...over }, 7, NOW, false)} />);

describe("Interview efficiency", () => {
  test("too few closed says so", () => {
    expect(page()).toContain("Not enough closed yet");
  });

  test("the rounds and what a hire costs, and no made-up estimate", () => {
    const html = page({ efficiency: { closed: 8, hires: 2, rounds: [{ label: "Round 1 to round 2", from: 4, to: 3, rate: 0.75 }], interviewsPerHire: 4, hoursPerHire: 3.5 } });
    expect(html).toContain("Round 1 to round 2");
    expect(html).toContain("75%");
    expect(html).toContain("interviews per hire");
    expect(html).toContain("3.5h");
    expect(html).not.toContain("Not enough closed yet");
    expect(html).not.toMatch(/could free|Testbench|Estimate/);
  });
});

test("the average stay sits under time in stage, efficiency where it was", () => {
  const html = page();
  const at = (s: string) => html.indexOf(s);
  expect(at("Time in stage")).toBeLessThan(at("Average stay in each stage"));
  expect(at("Average stay in each stage")).toBeLessThan(at("Interview efficiency"));
  expect(at("Interview efficiency")).toBeLessThan(at("Outstanding feedback"));
});
