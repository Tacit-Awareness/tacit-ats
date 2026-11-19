import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import type { HomeTicketsRead } from "@/lib/client/home-tickets";
import { HomeTickets } from "./home-tickets";

const read = (live: HomeTicketsRead["live"]): HomeTicketsRead => ({ from: "2024-01-01", arrivals: [], live, truncated: false });
const dot = (id: string, column: HomeTicketsRead["live"][number]["column"], tone: HomeTicketsRead["live"][number]["tone"]) => ({
  applicationId: id,
  personId: `p-${id}`,
  name: `Person ${id}`,
  job: "Staff Engineer",
  column,
  stalled: [],
  next: null,
  tone,
});

describe("Home", () => {
  test("counts everyone in process, one block per Pipeline column, beside the legend", () => {
    const html = renderToStaticMarkup(<HomeTickets firstName="Sam" read={read([dot("a", "new", "running"), dot("b", "decide", "needs"), dot("c", "decide", "failed")])} />);
    expect(html).toContain("3 in process now");
    expect(html).toContain("People in process by stage: New 1, Screening 0, Scheduling 0, Interview Booked 0, Your Call 2, Offer 0");
    for (const name of ["Needs you", "Overdue", "Moving", "Waiting on them"]) expect(html).toContain(name);
  });

  test("the search field is the way into ⌘K", () => {
    const html = renderToStaticMarkup(<HomeTickets firstName="Sam" read={read([])} />);
    expect(html).toMatch(/<button[^>]*data-tour="home-search"[^>]*>.*Search people, jobs and pages/);
  });

  test("the fullest block's people are listed under it, each opening their page", () => {
    const html = renderToStaticMarkup(<HomeTickets firstName="Sam" read={read([dot("a", "new", "running"), dot("b", "decide", "needs"), dot("c", "decide", "failed")])} />);
    expect(html).toContain('href="/client/candidates/p-b"');
    expect(html).toContain('href="/client/candidates/p-c"');
    expect(html).toContain("tint-failed");
    expect(html).not.toContain('href="/client/candidates/p-a"');
  });

  test("no em dashes or dot separators in its words", () => {
    const html = renderToStaticMarkup(<HomeTickets firstName="Sam" read={read([dot("a", "new", "running")])} />);
    expect(html).not.toMatch(/—|·/);
  });
});
