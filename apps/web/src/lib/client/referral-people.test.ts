import { describe, expect, test } from "vitest";
import { parseReferralPeopleQuery, referralPeople, referralPeopleHref, type ReferralPeopleQuery } from "./referral-people";
import { REFERRAL_PAGE_SIZE, type Referral } from "./referral-table";

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
const q = (over: Partial<ReferralPeopleQuery> = {}): ReferralPeopleQuery => ({ tab: "all", q: "", page: 1, sort: "when", dir: "desc", ...over });

describe("one row per person", () => {
  test("someone referred to two jobs is one row, about the referral furthest along, listing both jobs", () => {
    const a = ref("sourced", { candidateId: "p-x", name: "Maya", jobTitle: "Designer", referredBy: "Sam" });
    const b = ref("interviewing", { candidateId: "p-x", name: "Maya", jobTitle: "Engineer", referredBy: "Lena" });
    const t = referralPeople([a, b, ref("hired")], q());
    expect(t.everyone).toBe(2);
    const maya = t.rows.find((r) => r.candidateId === "p-x")!;
    expect(maya).toMatchObject({ stage: "interviewing", referredBy: "Lena", jobs: ["Engineer", "Designer"], referredAt: b.referredAt });
  });

  test("a tab counts people, each by the referrals that put them there", () => {
    const t = referralPeople(
      [ref("interviewing", { candidateId: "p-y" }), ref("rejected", { candidateId: "p-y", jobTitle: "Designer" }), ref("hired")],
      q({ tab: "closed" }),
    );
    expect(t.counts).toEqual({ all: 2, active: 1, hired: 1, closed: 1 });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ candidateId: "p-y", stage: "rejected", jobs: ["Designer"] });
  });

  test("the search matches any of a person's referrals", () => {
    const t = referralPeople([ref("sourced", { candidateId: "p-z", referredBy: "Marco" }), ref("screening", { candidateId: "p-z" }), ref("sourced")], q({ q: "marco" }));
    expect(t.rows.map((r) => r.candidateId)).toEqual(["p-z"]);
  });
});

describe("sorting, as the CRM's columns sort", () => {
  const rows = () => [
    ref("offer", { name: "Bea", referredBy: "Zed", jobTitle: "B job" }),
    ref("sourced", { name: "ada", referredBy: null, jobTitle: "A job" }),
    ref("hired", { name: "Cy", referredBy: "Amy", jobTitle: "C job" }),
  ];
  const names = (over: Partial<ReferralPeopleQuery>) => referralPeople(rows(), q(over)).rows.map((r) => r.name);

  test("newest referral first by default", () => {
    expect(names({})).toEqual(["Cy", "ada", "Bea"]);
  });

  test("by name, referrer, job and stage; nothing in a column goes last either way", () => {
    expect(names({ sort: "name", dir: "asc" })).toEqual(["ada", "Bea", "Cy"]);
    expect(names({ sort: "referrer", dir: "asc" })).toEqual(["Cy", "Bea", "ada"]);
    expect(names({ sort: "referrer", dir: "desc" })).toEqual(["Bea", "Cy", "ada"]);
    // By the name shown, not the wording recorded around it.
    const worded = [ref("offer", { name: "Bea", referredBy: "Referred by Zed" }), ref("offer", { name: "Cy", referredBy: "Backchannel from Amy" })];
    expect(referralPeople(worded, q({ sort: "referrer", dir: "asc" })).rows.map((r) => r.name)).toEqual(["Cy", "Bea"]);
    expect(names({ sort: "job", dir: "desc" })).toEqual(["Cy", "Bea", "ada"]);
    expect(names({ sort: "stage", dir: "asc" })).toEqual(["Bea", "ada", "Cy"]);
  });
});

describe("the URL", () => {
  test("reads the sort, falling back to the newest first", () => {
    expect(parseReferralPeopleQuery({ sort: "referrer" })).toMatchObject({ sort: "referrer", dir: "asc" });
    expect(parseReferralPeopleQuery({ sort: "nope", dir: "sideways" })).toMatchObject({ sort: "when", dir: "desc" });
    expect(parseReferralPeopleQuery({ tab: "hired", q: " sam ", page: "2" })).toMatchObject({ tab: "hired", q: "sam", page: 2 });
  });

  test("writes only what isn't the default, in Home's tab too", () => {
    expect(referralPeopleHref(q())).toBe("/client/referrals");
    expect(referralPeopleHref(q({ sort: "name", dir: "asc", tab: "active", page: 2 }))).toBe("/client/referrals?tab=active&sort=name&page=2");
    expect(referralPeopleHref(q({ sort: "when", dir: "asc" }), "/client?sub=referrals")).toBe("/client?sub=referrals&dir=asc");
  });

  test("pages by REFERRAL_PAGE_SIZE people", () => {
    const many = Array.from({ length: REFERRAL_PAGE_SIZE + 3 }, () => ref("sourced"));
    const t = referralPeople(many, q({ page: 9 }));
    expect(t).toMatchObject({ total: REFERRAL_PAGE_SIZE + 3, page: 2, pages: 2 });
    expect(t.rows).toHaveLength(3);
  });
});
