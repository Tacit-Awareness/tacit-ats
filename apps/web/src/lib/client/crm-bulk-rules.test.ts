import { describe, expect, test } from "vitest";

import {
  BULK_MAX,
  parseBulkName,
  parseBulkReject,
  rejectPlan,
  retryPicked,
  summarize,
  syncPicked,
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

  test("at the cap with the page half selected, the header's box still does something: it unselects the page", () => {
    const others = Array.from({ length: BULK_MAX - 1 }, (_, i) => item(i));
    const page = [item(5000), item(5001)];
    const full = togglePage(picks(...others), page);
    expect(full.size).toBe(BULK_MAX);
    const after = togglePage(full, page);
    expect(after.size).toBe(BULK_MAX - 1);
    expect(after.has(page[0]!.candidateId)).toBe(false);
  });

  test("a row keeps the snapshot it was selected with, not a later one", () => {
    const first = item(1, [app(1, "screening")]);
    const picked = togglePage(picks(first), [item(1, [app(1, "interviewing")]), item(2)]);
    expect(picked.get(ID(1))).toBe(first);
  });
});

describe("a selected row and the page in front of the member", () => {
  test("a row on the page follows what it now shows, so a reject never closes a job the row has stopped showing", () => {
    const two = item(1, [app(1, "screening", "Engineer"), app(2, "screening", "Designer")]);
    const narrowed = item(1, [app(1, "screening", "Engineer")]);
    const elsewhere = item(2, [app(3, "screening")]);
    const synced = syncPicked(picks(two, elsewhere), [narrowed, item(3)]);
    expect(synced.get(ID(1))).toEqual(narrowed);
    expect(synced.get(ID(2))).toBe(elsewhere);
    expect(synced.has(ID(3))).toBe(false);
    expect(rejectPlan([...synced.values()]).apps.map((a) => a.applicationId)).toEqual([ID(1001), ID(1003)]);
  });

  test("with nothing different it hands back the same map, so the store stays quiet", () => {
    const one = picks(item(1, [app(1, "screening")]));
    expect(syncPicked(one, [item(1, [app(1, "screening")]), item(2)])).toBe(one);
  });
});

describe("what stays selected after a run", () => {
  const a = item(1, [app(1, "screening"), app(2, "screening")]);
  const b = item(2, [app(3, "screening")]);
  const c = item(3, [app(4, "screening")]);

  test("a reject keeps only the applications worth trying again", () => {
    const rows: BulkRow[] = [
      { id: ID(1001), outcome: "done" },
      { id: ID(1002), outcome: "not_tried" },
      { id: ID(1003), outcome: "changed" },
      { id: ID(1004), outcome: "rate_limited" },
    ];
    expect(retryPicked("reject", [a, b, c], rows)).toEqual([{ ...a, apps: [a.apps[1]] }, c]);
  });

  test("a tag or a pool keeps the candidates who did not go through for a reason that may pass", () => {
    const rows: BulkRow[] = [
      { id: ID(1), outcome: "done" },
      { id: ID(2), outcome: "failed" },
      { id: ID(3), outcome: "forbidden" },
    ];
    expect(retryPicked("tag", [a, b, c], rows)).toEqual([b]);
  });

  test("a run that went through leaves nothing selected", () => {
    expect(retryPicked("pool", [a], [{ id: ID(1), outcome: "unchanged" }])).toEqual([]);
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

describe("the report", () => {
  test("an open offer says so, with the row's name", () => {
    const report = summarize("reject", [{ id: "x", outcome: "at_offer" }], new Map([["x", "Grace · Engineer"]]));
    expect(report).toEqual({ done: 0, unchanged: 0, problems: [{ id: "x", label: "Grace · Engineer", sentence: expect.stringContaining("offer") }] });
  });
});

describe("posted input", () => {
  const REASON = ID(7);
  test("nothing but the dialog's own shape gets through", () => {
    for (const raw of [null, undefined, 1, "x", [], {}, { applications: "x", reasonId: REASON }, { applications: [], reasonId: REASON }, { applications: [[]], reasonId: REASON }]) {
      expect(parseBulkReject(raw)).toBeNull();
    }
    const good = { applicationId: ID(1), expectedStage: "screening" };
    expect(parseBulkReject({ applications: [good], reasonId: "'; drop" })).toBeNull();
    expect(parseBulkReject({ applications: [{ ...good, expectedStage: "offer" }], reasonId: REASON })).toBeNull();
    expect(parseBulkReject({ applications: [{ ...good, expectedStage: "hired" }], reasonId: REASON })).toBeNull();
    expect(parseBulkReject({ applications: [{ ...good, applicationId: "x" }], reasonId: REASON })).toBeNull();
    expect(parseBulkName({ candidateIds: [ID(1)], name: {} })).toBeNull();
    expect(parseBulkName({ candidateIds: [ID(1)], name: "   " })).toBeNull();
    expect(parseBulkName({ candidateIds: ["x"], name: "Tag" })).toBeNull();
  });

  test("the same id twice, in either case, is one row, and past the cap is refused", () => {
    const up = ID(1).replace("00000000", "ABCDEF00");
    const parsed = parseBulkName({ candidateIds: [up, up.toLowerCase()], name: "Tag" });
    expect(parsed?.candidateIds).toHaveLength(1);
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => ID(i));
    expect(parseBulkName({ candidateIds: many, name: "Tag" })).toBeNull();
    expect(parseBulkReject({ applications: many.map((applicationId) => ({ applicationId, expectedStage: "screening" })), reasonId: REASON })).toBeNull();
  });

  test("a note that is not text is no note, and a long one is cut", () => {
    const applications = [{ applicationId: ID(1), expectedStage: "screening" }];
    expect(parseBulkReject({ applications, reasonId: REASON, note: { a: 1 } })?.note).toBeNull();
    expect(parseBulkReject({ applications, reasonId: REASON, note: "x".repeat(5000) })?.note).toHaveLength(2000);
  });
});
