import { describe, expect, test } from "vitest";

import { isClosedStage, pastApplications, type PastInput, type StageEvent } from "./past-applications";

const day = (n: number) => new Date(Date.parse("2026-01-01T12:00:00Z") + n * 86_400_000).toISOString();

const app = (id: string, stage: string, createdDay: number, over: Partial<PastInput> = {}): PastInput => ({
  applicationId: id,
  jobId: `job-${id}`,
  jobTitle: `Job ${id}`,
  stage,
  rejectionReason: null,
  createdAt: day(createdDay),
  lastTouchAt: day(createdDay),
  ...over,
});
const ev = (applicationId: string, fromStage: string | null, toStage: string | null, atDay: number): StageEvent => ({ applicationId, fromStage, toStage, at: day(atDay) });

describe("which applications are past", () => {
  test("one closed before another began", () => {
    const past = pastApplications([app("a", "rejected", 0, { rejectionReason: "Not now" }), app("b", "screening", 100)], [ev("a", "sourced", "screening", 5), ev("a", "screening", "rejected", 10)]);
    expect(past).toEqual([
      { applicationId: "a", jobId: "job-a", jobTitle: "Job a", stage: "rejected", rejectionReason: "Not now", appliedAt: day(0), closedAt: day(10), reached: "screening" },
    ]);
  });

  test("not one closed while the other was running: two jobs side by side", () => {
    expect(pastApplications([app("a", "rejected", 0), app("b", "screening", 5)], [ev("a", "sourced", "rejected", 10)])).toEqual([]);
  });

  test("not a live application, however old, and not an only application", () => {
    expect(pastApplications([app("a", "screening", 0), app("b", "sourced", 100)], [])).toEqual([]);
    expect(pastApplications([app("a", "rejected", 0)], [ev("a", "sourced", "rejected", 1)])).toEqual([]);
  });

  test("the newest closed one stays current; only the earlier is past when they came back twice", () => {
    const past = pastApplications([app("a", "rejected", 0), app("b", "withdrawn", 50)], [ev("a", "sourced", "rejected", 10), ev("b", "sourced", "withdrawn", 60)]);
    expect(past.map((p) => p.applicationId)).toEqual(["a"]);
  });

  test("a hire who came back: the outcome says how far, so no got-to", () => {
    const [p] = pastApplications([app("a", "hired", 0), app("b", "sourced", 500)], [ev("a", "offer", "hired", 30)]);
    expect(p).toMatchObject({ stage: "hired", closedAt: day(30), reached: null });
  });

  test("newest close first", () => {
    const past = pastApplications([app("a", "rejected", 0), app("b", "rejected", 20), app("c", "sourced", 100)], [ev("a", "sourced", "rejected", 5), ev("b", "sourced", "rejected", 30)]);
    expect(past.map((p) => p.applicationId)).toEqual(["b", "a"]);
  });
});

describe("what is recorded", () => {
  test("with no close on record, the last touch decides, and no date or stage is made up", () => {
    const past = pastApplications([app("a", "rejected", 0, { lastTouchAt: day(4) }), app("b", "sourced", 100)], []);
    expect(past).toEqual([expect.objectContaining({ applicationId: "a", closedAt: null, reached: null })]);
  });

  test("a last touch after the other began keeps it out: it may have closed after", () => {
    expect(pastApplications([app("a", "rejected", 0, { lastTouchAt: day(120) }), app("b", "sourced", 100)], [])).toEqual([]);
  });

  test("closed, reopened and closed again: the latest close, and the furthest stage of the whole run", () => {
    const events = [ev("a", "sourced", "interviewing", 2), ev("a", "interviewing", "rejected", 5), ev("a", "rejected", "screening", 6), ev("a", "screening", "rejected", 20)];
    const [p] = pastApplications([app("a", "rejected", 0), app("b", "sourced", 100)], events);
    expect(p).toMatchObject({ closedAt: day(20), reached: "interviewing" });
  });

  test("the close is the one to the stage it closed at, whatever else happened to the application", () => {
    const [p] = pastApplications([app("a", "withdrawn", 0), app("b", "sourced", 100)], [ev("a", "sourced", "rejected", 2), ev("a", "rejected", "withdrawn", 7)]);
    expect(p).toMatchObject({ closedAt: day(7) });
  });

  test("another application's events are not this one's", () => {
    const [p] = pastApplications([app("a", "rejected", 0), app("b", "offer", 100)], [ev("a", "sourced", "rejected", 2), ev("b", "sourced", "offer", 110)]);
    expect(p).toMatchObject({ reached: "sourced" });
  });
});

test("closed stages are the three ends", () => {
  expect(["rejected", "withdrawn", "hired"].every(isClosedStage)).toBe(true);
  expect(["sourced", "offer", "x"].some(isClosedStage)).toBe(false);
});
