import { describe, expect, test } from "vitest";

import { ago, columnOf, lastInterviewAt, nextInterviewAt, until, type InterviewTimes } from "./pipeline-columns";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const H = 3_600_000;
const at = (offsetH: number) => new Date(NOW + offsetH * H).toISOString();
const iv = (startH: number, status = "scheduled"): InterviewTimes => ({ startsAt: at(startH), endsAt: at(startH + 1), status });

describe("the Pipeline board's columns", () => {
  test("stages before interviewing and the offer map straight across", () => {
    expect(columnOf("sourced", [], NOW)).toBe("new");
    expect(columnOf("contacted", [], NOW)).toBe("new");
    expect(columnOf("screening", [iv(24)], NOW)).toBe("screening");
    expect(columnOf("offer", [], NOW)).toBe("offer");
  });

  test("closed applications are not on the board", () => {
    for (const stage of ["hired", "rejected", "withdrawn", "something_else"]) expect(columnOf(stage, [iv(24)], NOW), stage).toBeNull();
  });

  test("interviewing with nothing booked or held is still being scheduled", () => {
    expect(columnOf("interviewing", [], NOW)).toBe("scheduling");
    expect(columnOf("interviewing", [iv(24, "cancelled"), iv(-48, "cancelled")], NOW)).toBe("scheduling");
  });

  test("an interview ahead, or under way, is booked, even after an earlier round", () => {
    expect(columnOf("interviewing", [iv(24)], NOW)).toBe("booked");
    expect(columnOf("interviewing", [iv(-0.5)], NOW)).toBe("booked");
    expect(columnOf("interviewing", [iv(-48, "done"), iv(24)], NOW)).toBe("booked");
  });

  test("interviews held and nothing next is the team's call", () => {
    expect(columnOf("interviewing", [iv(-48, "done")], NOW)).toBe("decide");
    // scheduled and over, never marked done
    expect(columnOf("interviewing", [iv(-3)], NOW)).toBe("decide");
    expect(columnOf("interviewing", [iv(-3), iv(24, "cancelled")], NOW)).toBe("decide");
  });
});

describe("interview times on a card", () => {
  test("the next is the soonest still ahead; the last is the latest held", () => {
    const xs = [iv(72), iv(24), iv(-48, "done"), iv(-3), iv(5, "cancelled")];
    expect(nextInterviewAt(xs, NOW)).toBe(at(24));
    expect(lastInterviewAt(xs, NOW)).toBe(at(-2));
    expect(nextInterviewAt([iv(-3)], NOW)).toBeNull();
    expect(lastInterviewAt([iv(24)], NOW)).toBeNull();
  });

  test("relative times", () => {
    expect(until(at(0.5), NOW)).toBe("in 30m");
    expect(until(at(5), NOW)).toBe("in 5h");
    expect(until(at(72), NOW)).toBe("in 3d");
    expect(until(at(-1), NOW)).toBe("now");
    expect(ago(at(-2), NOW)).toBe("today");
    expect(ago(at(-72), NOW)).toBe("3d ago");
    expect(ago(at(-24 * 21), NOW)).toBe("3w ago");
  });
});
