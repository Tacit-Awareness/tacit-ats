import { describe, expect, test } from "vitest";

import type { Referral } from "./referral-table";
import { TOP_REFERRERS_MAX, referrerKey, topReferrers } from "./top-referrers";

let seq = 0;
const ref = (referredBy: string | null, stage = "screening", over: Partial<Referral> = {}): Referral => ({
  applicationId: `app-${++seq}`,
  candidateId: `p-${seq}`,
  name: `Candidate ${seq}`,
  referredBy,
  jobId: "job-1",
  jobTitle: "Founding Engineer",
  stage,
  referredAt: new Date(Date.parse("2026-10-01T12:00:00Z") + seq * 86_400_000).toISOString(),
  ...over,
});

describe("referrerKey", () => {
  test("folds case, whitespace and Unicode form, and nothing else", () => {
    expect(referrerKey("  Priya   Shah ")).toBe("priya shah");
    expect(referrerKey("PRIYA SHAH")).toBe(referrerKey("priya shah"));
    expect(referrerKey("José")).toBe(referrerKey("José"));
    expect(referrerKey("Sam")).not.toBe(referrerKey("Sam Lee"));
  });

  test("an empty referrer has no key", () => {
    expect(referrerKey(null)).toBeNull();
    expect(referrerKey("   ")).toBeNull();
  });
});

describe("topReferrers", () => {
  test("counts referred, in process (the tab's stages) and hired per referrer", () => {
    const { rows, more } = topReferrers([
      ref("Priya", "sourced"),
      ref("Priya", "interviewing"),
      ref("Priya", "offer"),
      ref("Priya", "hired"),
      ref("Priya", "rejected"),
      ref("Marco", "screening"),
    ]);
    expect(rows).toEqual([
      { name: "Priya", referred: 5, inProcess: 2, hired: 1 },
      { name: "Marco", referred: 1, inProcess: 1, hired: 0 },
    ]);
    expect(more).toBe(0);
  });

  test("most hired first, then most referred, then by name", () => {
    const { rows } = topReferrers([
      ref("Ann", "screening"),
      ref("Ann", "screening"),
      ref("Ann", "screening"),
      ref("Bo", "hired"),
      ref("Cy", "screening"),
      ref("Ab", "screening"),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Bo", "Ann", "Ab", "Cy"]);
  });

  test("one referrer across spellings, named by the one typed most often", () => {
    const { rows } = topReferrers([ref("priya shah"), ref("Priya Shah"), ref("Priya  Shah "), ref("PRIYA SHAH", "hired")]);
    expect(rows).toEqual([{ name: "Priya Shah", referred: 4, inProcess: 3, hired: 1 }]);
  });

  test("a tie between spellings goes to the earliest", () => {
    const { rows } = topReferrers([ref("sam lee", "screening", { referredAt: "2026-10-05T00:00:00Z" }), ref("Sam Lee", "screening", { referredAt: "2026-10-02T00:00:00Z" })]);
    expect(rows[0]!.name).toBe("Sam Lee");
  });

  test("a referral with no referrer is left out", () => {
    expect(topReferrers([ref(null), ref("  ")])).toEqual({ rows: [], more: 0 });
  });

  test("at most the max, the rest counted", () => {
    const many = Array.from({ length: TOP_REFERRERS_MAX + 3 }, (_, i) => ref(`Person ${String(i).padStart(2, "0")}`));
    const { rows, more } = topReferrers(many);
    expect(rows).toHaveLength(TOP_REFERRERS_MAX);
    expect(more).toBe(3);
    expect(topReferrers(many, 2).rows.map((r) => r.name)).toEqual(["Person 00", "Person 01"]);
  });
});
