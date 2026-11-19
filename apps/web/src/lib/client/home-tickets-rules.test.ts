import { describe, expect, test } from "vitest";
import { FUNNEL_STAGES, closedTone, healthOf, liveTone, standingLabel, standingOf, tally, wayOf, yearWindow } from "./home-tickets-rules";

describe("wayOf", () => {
  test("folds the source groups into Referred, Inbound and Reached Out", () => {
    expect(wayOf("referral", null)).toBe("referred");
    expect(wayOf("job_board", null)).toBe("inbound");
    expect(wayOf("applicant", null)).toBe("inbound");
    expect(wayOf("candidate", null)).toBe("inbound");
    expect(wayOf("sourced", null)).toBe("outreach");
    expect(wayOf("suggested", null)).toBe("outreach");
  });
  test("Tacit's submissions, agencies and events are Other, never dropped", () => {
    expect(wayOf("agency", "Tacit · Ryan")).toBe("other");
    expect(wayOf("agency", "Acme Search")).toBe("other");
    expect(wayOf("event", null)).toBe("other");
    expect(wayOf("something new", null)).toBe("other");
  });
});

describe("liveTone", () => {
  const base = { column: "screening" as const, stalled: [] as string[], waitingOnMe: false };
  test("green when moving", () => expect(liveTone(base)).toBe("running"));
  test("amber for Your Call or an approval waiting on you", () => {
    expect(liveTone({ ...base, column: "decide" })).toBe("needs");
    expect(liveTone({ ...base, waitingOnMe: true })).toBe("needs");
  });
  test("blue when nobody has touched it", () => expect(liveTone({ ...base, stalled: ["no_touch"] })).toBe("waiting"));
  test("red when overdue, over everything else", () => {
    expect(liveTone({ column: "decide", stalled: ["no_touch", "overdue"], waitingOnMe: true })).toBe("failed");
  });
  test("amber over blue", () => expect(liveTone({ ...base, column: "decide", stalled: ["no_touch"] })).toBe("needs"));
});

test("closedTone", () => {
  expect(closedTone("rejected")).toBe("failed");
  expect(closedTone("withdrawn")).toBe("waiting");
  expect(closedTone("hired")).toBe("running");
});

test("standings", () => {
  expect(standingOf("sourced")).toBe("awaiting review");
  expect(standingOf("contacted")).toBe("awaiting review");
  expect(standingOf("withdrawn")).toBe("withdrew");
  expect(standingOf("offer")).toBe("offer");
  expect(standingLabel("sourced")).toBe("Awaiting Review");
});

test("the funnel's blocks are the Pipeline's columns in Title Case", () => {
  expect(FUNNEL_STAGES.map((s) => s.label)).toEqual(["New", "Screening", "Scheduling", "Interview Booked", "Your Call", "Offer"]);
});

test("tally keeps the order and drops what is empty", () => {
  expect(tally(["a", "b", "c"], ["c", "a", "c"])).toEqual([
    ["a", 1],
    ["c", 2],
  ]);
});

test("healthOf", () => {
  expect(healthOf([])).toBe("on track");
  expect(healthOf(["no_touch"])).toBe("no reply");
  expect(healthOf(["no_touch", "overdue"])).toBe("overdue");
});

test("yearWindow is this calendar year, a month earlier per step back", () => {
  const today = new Date(2026, 10, 19);
  expect(yearWindow(today, 0)).toEqual({ start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) });
  expect(yearWindow(today, 1)).toEqual({ start: new Date(2025, 11, 1), end: new Date(2026, 10, 30) });
  expect(yearWindow(today, 12)).toEqual({ start: new Date(2025, 0, 1), end: new Date(2025, 11, 31) });
});
