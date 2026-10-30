import { describe, expect, test } from "vitest";
import { scheduleHref } from "./schedule-layout";
import { matchesSearch, parseSearch, searchOrder } from "./schedule-search";

const interview = { candidateName: "José Núñez", jobTitle: "Founding Engineer", step: "Onsite", interviewers: ["Ada Admin", "Ben Builder"] };

describe("the search box's value", () => {
  test("is trimmed, and empty or blank is no search", () => {
    expect(parseSearch("  ada  ")).toBe("ada");
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  test("is bounded, with no trailing space left by the cut", () => {
    expect(parseSearch("x".repeat(500))).toHaveLength(100);
    expect(parseSearch(`${"x".repeat(99)} y`)).toBe("x".repeat(99));
  });
});

describe("matching an interview", () => {
  test("reads the candidate, the interviewers, the job and the step", () => {
    for (const q of ["José", "ben", "founding", "ONSITE"]) expect(matchesSearch(interview, q)).toBe(true);
    expect(matchesSearch(interview, "designer")).toBe(false);
  });

  test("every word has to be there, in any field and any order", () => {
    expect(matchesSearch(interview, "onsite ada")).toBe(true);
    expect(matchesSearch(interview, "ada  engineer   jose")).toBe(true);
    expect(matchesSearch(interview, "ada designer")).toBe(false);
  });

  test("accents do not matter, typed or stored", () => {
    expect(matchesSearch(interview, "jose nunez")).toBe(true);
    expect(matchesSearch({ ...interview, candidateName: "Jose Nunez" }, "José")).toBe(true);
  });

  test("a candidate with no name, or no step, is still searchable by the rest", () => {
    const bare = { candidateName: null, jobTitle: "Designer", step: null, interviewers: [] };
    expect(matchesSearch(bare, "designer")).toBe(true);
    expect(matchesSearch(bare, "null")).toBe(false);
  });

  test("what looks like a pattern or a query is only text", () => {
    expect(matchesSearch(interview, ".*")).toBe(false);
    expect(matchesSearch(interview, "%")).toBe(false);
    expect(matchesSearch({ ...interview, candidateName: "100% Real (Ada)" }, "100% (ada)")).toBe(true);
  });
});

describe("the order of the matches", () => {
  const ev = (id: string, day: number) => ({ id, startsAt: `2026-10-${day}T10:00:00Z`, endsAt: `2026-10-${day}T11:00:00Z` });
  const NOW = Date.parse("2026-10-20T12:00:00Z");

  test("what is ahead soonest first, then what is over newest first", () => {
    const events = [ev("old", 12), ev("far", 28), ev("recent", 19), ev("soon", 21)];
    expect(searchOrder(events, NOW).map((e) => e.id)).toEqual(["soon", "far", "recent", "old"]);
  });

  test("one still running counts as ahead, one that just ended as over", () => {
    const running = { id: "running", startsAt: "2026-10-20T11:30:00Z", endsAt: "2026-10-20T12:30:00Z" };
    const ended = { id: "ended", startsAt: "2026-10-20T11:00:00Z", endsAt: "2026-10-20T12:00:00Z" };
    expect(searchOrder([ended, ev("soon", 21), running], NOW).map((e) => e.id)).toEqual(["running", "soon", "ended"]);
  });

  test("the same time is steady, and the input is left as it was", () => {
    const events = [ev("b", 21), ev("a", 21)];
    expect(searchOrder(events, NOW).map((e) => e.id)).toEqual(["a", "b"]);
    expect(events.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("a search that does not sit neatly in 100 characters", () => {
  test("cut in the middle of an emoji, it still makes a link", () => {
    const q = parseSearch(`${"a".repeat(99)}😀`)!;
    expect(() => encodeURIComponent(q)).not.toThrow();
    expect(() => scheduleHref({ view: "week", date: null, dept: "Eng", q })).not.toThrow();
  });

  test("nothing left to match is no search", () => {
    // A lone combining accent, once folded, is no words: it would match everything.
    expect(parseSearch("\u0301")).toBeNull();
    expect(parseSearch("\u0301 \u0300")).toBeNull();
  });
});
