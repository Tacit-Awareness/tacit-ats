import { describe, expect, test } from "vitest";
import { groupInterviews, groupOf, verdictOf } from "./interview-groups";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
const iv = (id: string, h: number, status = "scheduled", recommendations: string[] = []) => ({
  interviewId: id,
  startsAt: at(h),
  endsAt: at(h + 1),
  status,
  recommendations,
});

describe("verdictOf", () => {
  test("every yes is a pass, every no a fail, both a mix, none pending", () => {
    expect(verdictOf(["yes", "strong_yes"])).toBe("pass");
    expect(verdictOf(["no", "strong_no"])).toBe("fail");
    expect(verdictOf(["strong_yes", "no"])).toBe("mixed");
    expect(verdictOf([])).toBe("pending");
  });
});

describe("groupOf", () => {
  test("scheduled and not over is upcoming, even if it has started", () => {
    expect(groupOf(iv("a", 24), NOW)).toBe("upcoming");
    expect(groupOf({ ...iv("a", -0.5) }, NOW)).toBe("upcoming");
  });

  test("a scheduled interview past its end counts as held, by its feedback", () => {
    expect(groupOf(iv("a", -26), NOW)).toBe("pending");
    expect(groupOf(iv("a", -26, "scheduled", ["yes"]), NOW)).toBe("pass");
  });

  test("done is past whenever it was; cancelled is left off", () => {
    expect(groupOf(iv("a", 5, "done", ["no"]), NOW)).toBe("fail");
    expect(groupOf(iv("a", 24, "cancelled"), NOW)).toBeNull();
    expect(groupOf(iv("a", -24, "cancelled", ["yes"]), NOW)).toBeNull();
  });
});

describe("groupInterviews", () => {
  test("Upcoming first, then Pass, Mixed, Fail, Read pending; empty groups left out", () => {
    const groups = groupInterviews(
      [
        iv("pending", -48, "done"),
        iv("fail", -24, "done", ["no"]),
        iv("soon", 2),
        iv("pass", -72, "done", ["yes"]),
        iv("gone", 3, "cancelled"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["upcoming", "pass", "fail", "pending"]);
    expect(groups.map((g) => g.label)).toEqual(["Upcoming", "Pass", "Fail", "Read pending"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.interviewId))).toEqual(["soon", "pass", "fail", "pending"]);
  });

  test("upcoming soonest first, past newest first", () => {
    const groups = groupInterviews([iv("later", 48), iv("old", -72, "done"), iv("next", 2), iv("recent", -3, "done")], NOW);
    expect(groups[0]!.items.map((i) => i.interviewId)).toEqual(["next", "later"]);
    expect(groups[1]!.items.map((i) => i.interviewId)).toEqual(["recent", "old"]);
  });
});
