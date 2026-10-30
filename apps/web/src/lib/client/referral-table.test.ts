import { describe, expect, test } from "vitest";

import { REFERRAL_PAGE_SIZE, cleanReferrer, inTab, matches, parseReferralQuery, referralTable, referralsHref, whereTheyAre, type Referral, type ReferralQuery } from "./referral-table";

const day = (n: number) => new Date(Date.parse("2026-10-01T12:00:00Z") + n * 86_400_000).toISOString();

let seq = 0;
const ref = (stage: string, over: Partial<Referral> = {}): Referral => ({
  applicationId: `app-${String(++seq).padStart(3, "0")}`,
  candidateId: `p-${seq}`,
  name: `Candidate ${seq}`,
  referredBy: "Priya",
  jobId: "job-1",
  jobTitle: "Founding Engineer",
  stage,
  referredAt: day(seq),
  ...over,
});
const q = (over: Partial<ReferralQuery> = {}): ReferralQuery => ({ tab: "all", q: "", page: 1, ...over });

describe("tabs", () => {
  test("In process is core's IN_PROCESS_STAGES; sourced and contacted are only in All", () => {
    expect(["screening", "interviewing", "offer"].every((s) => inTab(s, "active"))).toBe(true);
    expect(inTab("sourced", "active")).toBe(false);
    expect(inTab("contacted", "active")).toBe(false);
    expect(inTab("sourced", "all")).toBe(true);
  });

  test("Hired is hired; Closed is rejected or withdrawn", () => {
    expect(inTab("hired", "hired")).toBe(true);
    expect(inTab("hired", "closed")).toBe(false);
    expect(inTab("rejected", "closed")).toBe(true);
    expect(inTab("withdrawn", "closed")).toBe(true);
    expect(inTab("offer", "closed")).toBe(false);
  });
});

describe("the table", () => {
  test("counts each tab after the search, newest referral first", () => {
    const rs = [ref("sourced"), ref("interviewing"), ref("hired"), ref("rejected", { referredBy: "Marco" }), ref("withdrawn")];
    const t = referralTable(rs, q());
    expect(t.counts).toEqual({ all: 5, active: 1, hired: 1, closed: 2 });
    expect(t.rows.map((r) => r.stage)).toEqual(["withdrawn", "rejected", "hired", "interviewing", "sourced"]);

    const marco = referralTable(rs, q({ q: "marco" }));
    expect(marco.counts).toEqual({ all: 1, active: 0, hired: 0, closed: 1 });
    expect(referralTable(rs, q({ tab: "closed" })).rows.map((r) => r.stage)).toEqual(["withdrawn", "rejected"]);
  });

  test("pages by 50, and a page past the end is the last one", () => {
    const rs = Array.from({ length: REFERRAL_PAGE_SIZE + 3 }, () => ref("screening"));
    const t = referralTable(rs, q({ page: 9 }));
    expect(t).toMatchObject({ total: 53, page: 2, pages: 2 });
    expect(t.rows).toHaveLength(3);
  });

  test("an empty list is one empty page", () => {
    expect(referralTable([], q())).toMatchObject({ total: 0, page: 1, pages: 1, rows: [] });
  });
});

describe("search", () => {
  test("every word must be in the candidate, the referrer or the job", () => {
    const r = ref("sourced", { name: "Ana Lima", referredBy: "Priya S.", jobTitle: "Designer" });
    expect(matches(r, "ana priya")).toBe(true);
    expect(matches(r, "designer")).toBe(true);
    expect(matches(r, "ana marco")).toBe(false);
    expect(matches(ref("sourced", { name: null, referredBy: null, jobTitle: null }), "x")).toBe(false);
    expect(matches(r, "  ")).toBe(true);
  });
});

describe("the URL", () => {
  test("unknown values fall back to the defaults, and defaults are left out", () => {
    expect(parseReferralQuery({ tab: "nope", page: "-2", q: "  ana " })).toEqual({ tab: "all", q: "ana", page: 1 });
    expect(parseReferralQuery({ tab: ["hired", "closed"], page: "3" })).toEqual({ tab: "hired", q: "", page: 3 });
    expect(referralsHref(q())).toBe("/client/referrals");
    expect(referralsHref(q({ tab: "closed", q: "a b", page: 2 }))).toBe("/client/referrals?tab=closed&q=a+b&page=2");
  });
});

describe("where they are", () => {
  test("in the CRM's words, green only once hired", () => {
    expect(whereTheyAre("hired")).toEqual({ label: "Hired", tone: "green" });
    expect(whereTheyAre("withdrawn")).toEqual({ label: "Withdrew", tone: "grey" });
    expect(whereTheyAre("interviewing")).toEqual({ label: "Interviewing", tone: "grey" });
  });
});

describe("the referrer typed into the form", () => {
  test("is kept as given, whitespace collapsed; empty or too long is refused", () => {
    expect(cleanReferrer("  Priya   Shah ")).toBe("Priya Shah");
    expect(cleanReferrer("")).toBeNull();
    expect(cleanReferrer("   ")).toBeNull();
    expect(cleanReferrer(null)).toBeNull();
    expect(cleanReferrer("x".repeat(201))).toBeNull();
    expect(cleanReferrer("x".repeat(200))).toBe("x".repeat(200));
  });
});
