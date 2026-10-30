import { describe, expect, test } from "vitest";

import {
  BULK_MAX,
  parseBulkName,
  parseBulkReject,
  rejectPlan,
  summarize,
  togglePage,
  togglePick,
  type BulkItem,
  type BulkRow,
  type Picked,
} from "./crm-bulk-rules";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, apps: BulkItem["apps"] = []): BulkItem => ({ candidateId: ID(n), name: `Person ${n}`, apps });
const app = (n: number, stage: string, jobTitle = "Engineer") => ({ applicationId: ID(1000 + n), jobTitle, stage });
const picks = (...items: BulkItem[]): Picked => new Map(items.map((i) => [i.candidateId, i]));

describe("the selection", () => {
  test("a row toggles on and off, and the map is a new one so the store sees the change", () => {
    const empty = picks();
    const one = togglePick(empty, item(1));
    expect([...one.keys()]).toEqual([ID(1)]);
    expect(one).not.toBe(empty);
    expect(togglePick(one, item(1)).size).toBe(0);
  });

  test("past the cap a new row is refused with the same map, and a selected one still comes off", () => {
    const full = picks(...Array.from({ length: BULK_MAX }, (_, i) => item(i)));
    expect(togglePick(full, item(9999))).toBe(full);
    expect(togglePick(full, item(0)).size).toBe(BULK_MAX - 1);
  });

  test("the header's box selects the rest of the page, then unselects the page, leaving other pages' rows", () => {
    const other = item(50);
    const page = [item(1), item(2), item(3)];
    const some = togglePick(picks(other), page[0]!);
    const all = togglePage(some, page);
    expect([...all.keys()].sort()).toEqual([ID(1), ID(2), ID(3), ID(50)].sort());
    expect([...togglePage(all, page).keys()]).toEqual([ID(50)]);
  });

  test("selecting a page stops at the cap, and an empty page does nothing", () => {
    const nearly = picks(...Array.from({ length: BULK_MAX - 1 }, (_, i) => item(i)));
    expect(togglePage(nearly, [item(5000), item(5001)]).size).toBe(BULK_MAX);
    expect(togglePage(picks(item(1)), []).size).toBe(1);
  });

  test("a row keeps the snapshot it was selected with, not a later one", () => {
    const first = item(1, [app(1, "screening")]);
    const picked = togglePage(picks(first), [item(1, [app(1, "interviewing")]), item(2)]);
    expect(picked.get(ID(1))).toBe(first);
  });
});

describe("what a reject touches", () => {
  test("every open application on a row, each posted with the stage shown", () => {
    const plan = rejectPlan([item(1, [app(1, "screening", "Engineer"), app(2, "sourced", "Designer")])]);
    expect(plan.apps).toEqual([
      { applicationId: ID(1001), expectedStage: "screening", label: "Person 1 · Engineer" },
      { applicationId: ID(1002), expectedStage: "sourced", label: "Person 1 · Designer" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("nobody at offer, and nobody with nothing open: each is left alone and says why", () => {
    const plan = rejectPlan([item(1), item(2, [app(1, "offer"), app(2, "contacted", "Designer")])]);
    expect(plan.apps.map((a) => a.applicationId)).toEqual([ID(1002)]);
    expect(plan.skipped).toEqual([
      { id: ID(1), label: "Person 1", why: "no_open" },
      { id: ID(1001), label: "Person 2 · Engineer", why: "at_offer" },
    ]);
  });
});

describe("the posted input", () => {
  const reject = (over: Record<string, unknown> = {}) => ({ applications: [{ applicationId: ID(1), expectedStage: "screening" }], reasonId: ID(2), note: "  why  ", ...over });

  test("a reject reads back typed, the note trimmed and an empty one null", () => {
    expect(parseBulkReject(reject())).toEqual({ applications: [{ applicationId: ID(1), expectedStage: "screening" }], reasonId: ID(2), note: "why" });
    expect(parseBulkReject(reject({ note: "   " }))?.note).toBeNull();
    expect(parseBulkReject(reject({ note: null }))?.note).toBeNull();
    expect(parseBulkReject(reject({ note: "x".repeat(5000) }))?.note).toHaveLength(2000);
  });

  test("a reject refuses what the dialog never sends", () => {
    for (const bad of [
      null,
      "x",
      {},
      reject({ reasonId: "not-an-id" }),
      reject({ reasonId: undefined }),
      reject({ applications: [] }),
      reject({ applications: "x" }),
      reject({ applications: [{ applicationId: "x", expectedStage: "screening" }] }),
      reject({ applications: [{ applicationId: ID(1), expectedStage: "hired" }] }),
      reject({ applications: [{ applicationId: ID(1), expectedStage: "offer" }] }),
      reject({ applications: [{ applicationId: ID(1), expectedStage: "rejected" }] }),
      reject({ applications: Array.from({ length: BULK_MAX + 1 }, (_, i) => ({ applicationId: ID(i), expectedStage: "sourced" })) }),
    ]) {
      expect(parseBulkReject(bad)).toBeNull();
    }
  });

  test("the same application twice is one row, in any case", () => {
    const id = "abcdefab-0000-4000-8000-000000000001";
    const twice = [{ applicationId: id, expectedStage: "sourced" }, { applicationId: id.toUpperCase(), expectedStage: "sourced" }];
    expect(parseBulkReject(reject({ applications: twice }))?.applications).toHaveLength(1);
  });

  test("a tag or pool needs ids and a name", () => {
    expect(parseBulkName({ candidateIds: [ID(1), ID(1), ID(2)], name: " Silver " })).toEqual({ candidateIds: [ID(1), ID(2)], name: "Silver" });
    for (const bad of [
      null,
      { candidateIds: [ID(1)] },
      { candidateIds: [ID(1)], name: "   " },
      { candidateIds: [], name: "x" },
      { candidateIds: ["x"], name: "x" },
      { candidateIds: ID(1), name: "x" },
      { candidateIds: Array.from({ length: BULK_MAX + 1 }, (_, i) => ID(i)), name: "x" },
    ]) {
      expect(parseBulkName(bad)).toBeNull();
    }
  });
});

describe("the report", () => {
  const labels = new Map([[ID(1), "Ada"], [ID(2), "Bo"], [ID(3), "Cy"]]);

  test("counts what went through, and names every row that did not with its own reason", () => {
    const rows: BulkRow[] = [
      { id: ID(1), outcome: "done" },
      { id: ID(2), outcome: "forbidden" },
      { id: ID(3), outcome: "changed" },
    ];
    expect(summarize("reject", rows, labels)).toEqual({
      done: 1,
      unchanged: 0,
      problems: [
        { id: ID(2), label: "Bo", sentence: "You can't edit that job's pipeline." },
        { id: ID(3), label: "Cy", sentence: "Someone already moved them, so nothing was changed." },
      ],
    });
  });

  test("a refusal reads for the action, and someone already tagged is no failure", () => {
    const rows: BulkRow[] = [
      { id: ID(1), outcome: "unchanged" },
      { id: ID(2), outcome: "forbidden" },
    ];
    expect(summarize("tag", rows, labels)).toMatchObject({ unchanged: 1, problems: [{ sentence: "You can't change this person's record." }] });
    expect(summarize("pool", rows, labels).problems[0]!.sentence).toBe("You can't add people to talent pools.");
  });

  test("the hourly limit reports the row that hit it and those never tried; rows left alone are listed too", () => {
    const rows: BulkRow[] = [
      { id: ID(1), outcome: "rate_limited" },
      { id: ID(2), outcome: "not_tried" },
    ];
    const summary = summarize("reject", rows, labels, [{ id: ID(3), label: "Cy · Engineer", why: "at_offer" }]);
    expect(summary.problems.map((p) => [p.label, p.sentence])).toEqual([
      ["Ada", "You've hit the limit of 300 changes an hour."],
      ["Bo", "Not tried: the hourly limit stopped the run first."],
      ["Cy · Engineer", "At offer. Reject them from their own page."],
    ]);
  });

  test("a row the page cannot name is still reported", () => {
    expect(summarize("tag", [{ id: ID(9), outcome: "failed" }], labels).problems[0]).toMatchObject({ label: "Unnamed", sentence: "That didn't work." });
  });
});
