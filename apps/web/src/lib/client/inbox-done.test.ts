import { describe, expect, test } from "vitest";
import { doneCandidateHref, doneItems, isIssueKey, parseInstance, selectedDone, type Dismissal, type DoneSubject } from "./inbox-done";
import { inboxIssues, instanceId, standingIssues, type InboxInput, type Issue } from "./inbox-issues";

const ID = "11111111-1111-4111-8111-111111111111";
const KEY = `app-${ID}`;
const AT = "2026-10-20T10:00:00.123456+00:00";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const fields = { issueKey: KEY, issueReason: "quiet", issueAt: AT };

describe("isIssueKey", () => {
  test.each([KEY, `appr-${ID}`, `draft-${ID}`])("%s is one", (k) => expect(isIssueKey(k)).toBe(true));
  test.each(["", "app-1", `job-${ID}`, `APP-${ID}`, `${KEY}\n`, "https://evil.example/", 7, null])("%s is not", (k) => expect(isIssueKey(k)).toBe(false));
});

describe("parseInstance", () => {
  test("reads what the page sent", () => {
    expect(parseInstance(form(fields))).toEqual({ key: KEY, reason: "quiet", at: AT });
  });

  test("the key an action already knows wins over a posted one", () => {
    expect(parseInstance(form({ ...fields, issueKey: `draft-${ID}` }), KEY)?.key).toBe(KEY);
  });

  test.each([
    ["a date with no time", { issueAt: "2026-10-20" }],
    ["a year zero", { issueAt: "0000-01-01T00:00:00Z" }],
    ["a five-digit year", { issueAt: "12026-10-20T10:00:00Z" }],
    ["infinity", { issueAt: "infinity" }],
    ["a month that isn't", { issueAt: "2026-13-20T10:00:00Z" }],
    ["no zone", { issueAt: "2026-10-20T10:00:00" }],
    ["an unknown reason", { issueReason: "bored" }],
    ["a prototype reason", { issueReason: "constructor" }],
    ["a key with words in it", { issueKey: "app-Candidate Name" }],
  ])("%s is refused", (_, over) => {
    expect(parseInstance(form({ ...fields, ...over }))).toBeNull();
  });

  test("a missing field is refused", () => {
    expect(parseInstance(form({ issueKey: KEY, issueReason: "quiet" }))).toBeNull();
    expect(parseInstance(form({ issueReason: "quiet", issueAt: AT }))).toBeNull();
  });
});

const NOW = Date.parse("2026-10-30T12:00:00Z");
const input: InboxInput = {
  cards: [
    {
      applicationId: ID,
      personId: "p",
      personName: "Sam Lee",
      roleId: "job",
      roleTitle: "Engineer",
      column: "screening",
      ownerName: null,
      lastTouchAt: AT,
      nextAction: null,
      nextActionDue: null,
      nextActionOwnerName: null,
      stalled: ["no_touch"],
      interviews: [],
    },
  ],
  outstanding: [],
  approvals: [],
  drafts: [],
  replies: [],
};
const row = (over: Partial<Dismissal> = {}): Dismissal => ({ id: "row", key: KEY, reason: "quiet", at: AT, how: "dismissed", dismissedAt: "2026-10-29T12:00:00Z", ...over });
const standing = standingIssues(input, NOW);
const subject = (over: Partial<DoneSubject> = {}): DoneSubject => ({ candidate: { id: "p", name: "Sam Lee" }, jobId: "job", jobTitle: "Engineer", approvalKind: null, ...over });

describe("doneItems", () => {
  test("what still stands is worded by the live issue, and can go back", () => {
    expect(doneItems([row()], standing, new Map())).toEqual([
      expect.objectContaining({ id: "row", kind: "late", what: "Nobody has been in touch", line: "Sam Lee · Engineer", stands: true, canMoveBack: true }),
    ]);
  });

  test("the same instant in Postgres's format still stands", () => {
    expect(doneItems([row({ at: "2026-10-20T10:00:00.123+00:00" })], standing, new Map())[0]?.stands).toBe(true);
  });

  test("a later instance on the same key isn't this one", () => {
    const [item] = doneItems([row({ at: "2026-10-19T10:00:00Z" })], standing, new Map([[KEY, subject()]]));
    expect(item).toMatchObject({ what: "Nobody had been in touch", stands: false, canMoveBack: false });
  });

  test("a resolved row never offers a way back, standing or not", () => {
    expect(doneItems([row({ how: "resolved" })], standing, new Map())[0]).toMatchObject({ stands: true, canMoveBack: false });
  });

  test("what has gone and can't be read is left out", () => {
    expect(doneItems([row({ at: "2026-10-19T10:00:00Z" })], standing, new Map())).toEqual([]);
  });

  test("a reason from another version is left out, not a crash", () => {
    expect(doneItems([row({ reason: "future" })], standing, new Map([[KEY, subject()]]))).toEqual([]);
  });

  test.each([
    ["feedback", subject(), "Feedback outstanding", "Sam Lee · Engineer"],
    ["overdue", subject(), "Next action overdue", "Sam Lee · Engineer"],
    ["decide", subject(), "Decide on Sam Lee", "Engineer"],
    ["draft", subject({ jobTitle: null }), "Draft to Sam Lee", ""],
    ["approval", subject({ candidate: null, approvalKind: "offer" }), "Approval for an offer", "Engineer"],
    ["approval", subject({ candidate: null, approvalKind: "job_open" }), "Approval to open a job", "Engineer"],
  ])("%s, gone, is worded by what is left", (reason, s, what, line) => {
    expect(doneItems([row({ reason, at: "2026-10-01T00:00:00Z" })], [], new Map([[KEY, s]]))[0]).toMatchObject({ what, line, stands: false });
  });

  test("order is kept", () => {
    const two = doneItems([row({ id: "b" }), row({ id: "a" })], standing, new Map());
    expect(two.map((x) => x.id)).toEqual(["b", "a"]);
    expect(selectedDone(two, "a")?.id).toBe("a");
    expect(selectedDone(two, "gone")?.id).toBe("b");
    expect(selectedDone([], "a")).toBeNull();
  });
});

describe("doneCandidateHref", () => {
  const item = doneItems([row({ at: "2026-10-19T10:00:00Z" })], [], new Map([[KEY, subject()]]))[0]!;

  test("links to the candidate someone can read", () => {
    expect(doneCandidateHref(item, [])).toBe("/client/candidates/p");
  });

  test("an approver not on the job has their name and no story: no link to a 404", () => {
    expect(doneCandidateHref(item, null)).toBeNull();
  });

  test("nobody to link to", () => {
    expect(doneCandidateHref({ ...item, candidate: null }, [])).toBeNull();
  });
});

describe("the issue carries no more than its instance into a dismissal", () => {
  test("instanceId holds only the key, the reason and the instant", () => {
    const i = inboxIssues(input, NOW)[0] as Issue;
    expect(instanceId(i)).toBe(`${KEY}|quiet|${Date.parse(AT)}`);
  });
});
