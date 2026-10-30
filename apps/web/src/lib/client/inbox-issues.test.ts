import { describe, expect, test } from "vitest";
import { DRAFT_LATE_MS, inboxIssues, instanceId, issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, standingIssues, waitingSince, type InboxApproval, type InboxCard, type InboxDraft, type InboxOutstanding, type Issue } from "./inbox-issues";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const card = (id: string, over: Partial<InboxCard> = {}): InboxCard => ({
  applicationId: id,
  personId: `p-${id}`,
  personName: `Candidate ${id}`,
  roleId: "job",
  roleTitle: "Engineer",
  column: "screening",
  ownerName: "Olive Owner",
  lastTouchAt: daysAgo(1),
  nextAction: null,
  nextActionDue: null,
  nextActionOwnerName: null,
  stalled: [],
  interviews: [],
  ...over,
});

const missing = (applicationId: string, over: Partial<InboxOutstanding> = {}): InboxOutstanding => ({
  interviewId: `iv-${applicationId}`,
  applicationId,
  interviewerName: "Ivan Petrov",
  endsAt: daysAgo(2),
  ...over,
});

const approval = (over: Partial<InboxApproval> = {}): InboxApproval => ({
  requestId: "r1",
  kind: "offer",
  jobId: "job",
  jobTitle: "Engineer",
  applicationId: "a",
  candidateId: "p-a",
  candidateName: "Candidate a",
  requestedBy: "Lee Lead",
  requestedAt: daysAgo(1),
  waitingStep: 1,
  steps: 1,
  ...over,
});

const draft = (over: Partial<InboxDraft> = {}): InboxDraft => ({
  draftId: "d1",
  personId: "p-a",
  personName: "Candidate a",
  jobTitle: "Engineer",
  toEmail: "a@x.test",
  subject: "Hello",
  body: "Body",
  updatedAt: daysAgo(1),
  ...over,
});

const issues = (over: Partial<Parameters<typeof inboxIssues>[0]>) => inboxIssues({ cards: [], outstanding: [], approvals: [], drafts: [], ...over }, NOW);

describe("inboxIssues", () => {
  test("a healthy application is no issue", () => {
    expect(issues({ cards: [card("a")] })).toEqual([]);
  });

  test("one issue an application: feedback, then overdue, then the team's call, then quiet", () => {
    const stalled = ["overdue", "no_touch"] as const;
    const everything = { column: "decide" as const, stalled: [...stalled], nextAction: "Call", nextActionDue: "2026-10-27" };
    expect(issues({ cards: [card("a", everything)], outstanding: [missing("a")] }).map((i) => i.reason)).toEqual(["feedback"]);
    expect(issues({ cards: [card("a", everything)] }).map((i) => i.reason)).toEqual(["overdue"]);
    expect(issues({ cards: [card("a", { column: "decide", stalled: ["no_touch"] })] }).map((i) => i.reason)).toEqual(["decide"]);
    expect(issues({ cards: [card("a", { stalled: ["no_touch"] })] }).map((i) => i.reason)).toEqual(["quiet"]);
  });

  test("feedback: who is missing, the oldest interview first, one person counted once", () => {
    const one = issues({ cards: [card("a")], outstanding: [missing("a")] })[0]!;
    expect(one).toMatchObject({ what: "Ivan hasn't sent feedback", why: "Interview ended 2d ago", who: "Ivan Petrov", interviewId: "iv-a", kind: "late" });
    const twice = issues({ cards: [card("a")], outstanding: [missing("a", { interviewId: "new", endsAt: daysAgo(1) }), missing("a", { interviewId: "old", endsAt: daysAgo(5) })] })[0]!;
    expect(twice).toMatchObject({ what: "Ivan hasn't sent feedback", interviewId: "old", since: daysAgo(5) });
    const two = issues({ cards: [card("a")], outstanding: [missing("a"), missing("a", { interviewerName: "Bo Lin" })] })[0]!;
    expect(two).toMatchObject({ what: "2 interviewers haven't sent feedback", who: null });
    const unnamed = issues({ cards: [card("a")], outstanding: [missing("a", { interviewerName: null })] })[0]!;
    expect(unnamed).toMatchObject({ what: "An interviewer hasn't sent feedback", who: null });
  });

  test("feedback on an application off the board (closed, or a closed job) is no issue", () => {
    expect(issues({ cards: [card("a")], outstanding: [missing("gone")] })).toEqual([]);
  });

  test("overdue: says the action and whose it is, the owner standing in", () => {
    const c = card("a", { stalled: ["overdue"], nextAction: "Send the take-home", nextActionDue: "2026-10-27" });
    expect(issues({ cards: [c] })[0]).toMatchObject({ what: "Overdue: Send the take-home", why: "Was due 3d ago", who: "Olive Owner", nextAction: "Send the take-home" });
    expect(issues({ cards: [{ ...c, nextActionOwnerName: "Dee Doer" }] })[0]!.who).toBe("Dee Doer");
  });

  test("a decision dates from the last interview held", () => {
    const c = card("a", { column: "decide", interviews: [{ startsAt: daysAgo(4), endsAt: daysAgo(3), status: "done" }] });
    expect(issues({ cards: [c] })[0]).toMatchObject({ kind: "decide", what: "Decide on Candidate a", at: daysAgo(3), why: "Interviewed 3d ago, nothing booked next" });
  });

  test("a pending approval takes the place of its application's issue, and never carries terms", () => {
    const list = issues({ cards: [card("a", { stalled: ["no_touch"] }), card("b", { stalled: ["no_touch"] })], approvals: [approval()] });
    expect(list.map((i) => [i.key, i.reason])).toEqual([["app-b", "quiet"], ["appr-r1", "approval"]]);
    expect(list[1]).toMatchObject({ what: "Approve the offer for Candidate a", why: "Your approval", who: "Lee Lead", kind: "decide" });
  });

  test("a job's approval has no candidate; a flow with steps says which", () => {
    const i = issues({ approvals: [approval({ kind: "job_open", applicationId: null, candidateId: null, candidateName: null, waitingStep: 2, steps: 3 })] })[0]!;
    expect(i).toMatchObject({ what: "Approve opening Engineer", why: "Your approval, step 2 of 3", candidate: null });
  });

  test("a draft only counts once it has sat for a while", () => {
    const fresh = draft({ draftId: "fresh", updatedAt: new Date(NOW - DRAFT_LATE_MS + 60_000).toISOString() });
    expect(issues({ drafts: [fresh, draft()] }).map((i) => i.key)).toEqual(["draft-d1"]);
    expect(issues({ drafts: [draft()] })[0]).toMatchObject({ kind: "draft", what: "Draft to Candidate a not sent", why: "Hello" });
  });

  test("the queue: drafts, overdue, decisions, newest first in each", () => {
    const list = issues({
      drafts: [draft()],
      cards: [
        card("old", { stalled: ["no_touch"], lastTouchAt: daysAgo(20) }),
        card("new", { stalled: ["no_touch"], lastTouchAt: daysAgo(9) }),
        card("dec", { column: "decide", interviews: [{ startsAt: daysAgo(1), endsAt: daysAgo(1), status: "done" }] }),
      ],
    });
    expect(list.map((i) => i.key)).toEqual(["draft-d1", "app-new", "app-old", "app-dec"]);
  });
});

describe("selecting", () => {
  const list = issues({ cards: [card("a", { stalled: ["no_touch"], lastTouchAt: daysAgo(8) }), card("b", { stalled: ["no_touch"], lastTouchAt: daysAgo(9) }), card("c", { stalled: ["no_touch"], lastTouchAt: daysAgo(10) })] });

  test("the one asked for, else the first, else nobody", () => {
    expect(selectedIssue(list, "app-b")?.key).toBe("app-b");
    expect(selectedIssue(list, "app-gone")?.key).toBe("app-a");
    expect(selectedIssue([], null)).toBeNull();
  });

  test("next is below, or above at the end", () => {
    expect(nextIssue(list, "app-a")?.key).toBe("app-b");
    expect(nextIssue(list, "app-c")?.key).toBe("app-b");
    expect(nextIssue(list, "app-gone")).toBeNull();
    expect(nextIssue(list.slice(0, 1), "app-a")).toBeNull();
  });
});

describe("a decision's fix", () => {
  const offer = issues({ approvals: [approval()] })[0]!;
  const job = issues({ approvals: [approval({ kind: "job_open", applicationId: null, candidateId: null, candidateName: null })] })[0]!;
  const decide = issues({ cards: [card("a", { column: "decide", interviews: [{ startsAt: daysAgo(2), endsAt: daysAgo(2), status: "scheduled" }] })] })[0]!;

  test("an approval is decided here, whether or not they may edit the pipeline", () => {
    for (const canEdit of [true, false]) {
      expect(issueFix(offer, canEdit)).toEqual({ type: "approval", requestId: "r1", kind: "offer" });
      expect(issueFix(job, canEdit)).toEqual({ type: "approval", requestId: "r1", kind: "job_open" });
    }
  });

  test("the team's call is decided here only by someone who may edit the pipeline", () => {
    expect(decide.reason).toBe("decide");
    expect(issueFix(decide, true)).toEqual({ type: "decide", applicationId: "a", nextRoundHref: "/client/candidates/p-a" });
    expect(issueFix(decide, false).type).toBe("link");
  });

  test("the second way out is the candidate, or for a job's approval the job", () => {
    expect(secondaryLink(offer, issueFix(offer, true))).toEqual({ label: "Open candidate", href: "/client/candidates/p-a" });
    expect(secondaryLink(job, issueFix(job, true))).toEqual({ label: "Open the job", href: "/client/jobs/job" });
    // Next round is already their page.
    expect(secondaryLink(decide, issueFix(decide, true))).toBeNull();
  });

  test("an approver who can't open the page behind it gets no link to a 404", () => {
    expect(secondaryLink(offer, issueFix(offer, true), false)).toBeNull();
    expect(secondaryLink(job, issueFix(job, true), false)).toBeNull();
  });
});

describe("issueFix", () => {
  const overdue = issues({ cards: [card("a", { stalled: ["overdue"], nextActionDue: "2026-10-27" })] })[0]!;
  const quiet = issues({ cards: [card("a", { stalled: ["no_touch"] })] })[0]!;

  test("a write only for someone who may edit the job, else the candidate's page", () => {
    expect(issueFix(overdue, true)).toEqual({ type: "write", write: "done", label: "Mark it done", applicationId: "a", nextAction: overdue.nextAction });
    expect(issueFix(quiet, true)).toEqual({ type: "write", write: "touch", label: "Log a touch", applicationId: "a", nextAction: null });
    expect(issueFix(overdue, false)).toEqual({ type: "link", label: "Open candidate", href: "/client/candidates/p-a" });
    expect(issueFix(quiet, false)).toEqual({ type: "link", label: "Open candidate", href: "/client/candidates/p-a" });
  });

  test("the others open the page that has the fix", () => {
    const feedback = issues({ cards: [card("a")], outstanding: [missing("a")] })[0]!;
    expect(issueFix(feedback, true)).toEqual({ type: "link", label: "Open the interview", href: "/client/interviews?i=iv-a" });
    const decide = issues({ cards: [card("a", { column: "decide" })] })[0]!;
    expect(issueFix(decide, false)).toEqual({ type: "link", label: "Decide", href: "/client/candidates/p-a" });
  });

  test("the candidate's page is offered unless the fix already is it", () => {
    expect(secondaryLink(overdue, issueFix(overdue, true))).toEqual({ label: "Open candidate", href: "/client/candidates/p-a" });
    expect(secondaryLink(overdue, issueFix(overdue, false))).toBeNull();
  });
});

describe("a dismissal", () => {
  const offOf = (...list: Issue[]) => new Set(list.map(instanceId));
  const input = {
    cards: [card("a", { column: "decide", nextAction: "Ring", nextActionDue: daysAgo(3).slice(0, 10), stalled: ["overdue", "no_touch"] })],
    outstanding: [missing("a")],
    approvals: [],
    drafts: [],
  };

  test("hides that one instance, and the next that holds on the application takes its place", () => {
    const first = inboxIssues(input, NOW)[0]!;
    expect(first.reason).toBe("feedback");
    const second = inboxIssues(input, NOW, offOf(first))[0]!;
    expect(second).toMatchObject({ key: first.key, reason: "overdue" });
    const third = inboxIssues(input, NOW, offOf(first, second))[0]!;
    expect(third.reason).toBe("decide");
    const fourth = inboxIssues(input, NOW, offOf(first, second, third))[0]!;
    expect(fourth.reason).toBe("quiet");
    expect(inboxIssues(input, NOW, offOf(first, second, third, fourth))).toEqual([]);
  });

  test("matches as instants, in whatever format the row comes back", () => {
    const quiet = { cards: [card("a", { lastTouchAt: "2026-10-20T10:00:00.123456+00:00", stalled: ["no_touch"] })], outstanding: [], approvals: [], drafts: [] };
    const row = { key: "app-a", reason: "quiet" as const, at: "2026-10-20T10:00:00.123+00:00" };
    expect(inboxIssues(quiet, NOW, new Set([instanceId(row)]))).toEqual([]);
  });

  test("a later issue with the same key and reason isn't hidden, even dated before the dismissal", () => {
    const first = inboxIssues({ ...input, outstanding: [] }, NOW)[0]!;
    const moved = { ...input, outstanding: [], cards: [card("a", { nextAction: "Ring", nextActionDue: daysAgo(1).slice(0, 10), stalled: ["overdue"] })] };
    expect(inboxIssues(moved, NOW, offOf(first)).map((i) => i.reason)).toEqual(["overdue"]);
  });

  test("a dismissed approval gives its place back to its application's issue", () => {
    const withApproval = { cards: [card("a", { stalled: ["no_touch"] })], outstanding: [], drafts: [], approvals: [approval({ applicationId: "a" })] };
    const shown = inboxIssues(withApproval, NOW);
    expect(shown.map((i) => i.reason)).toEqual(["approval"]);
    expect(inboxIssues(withApproval, NOW, offOf(shown[0]!)).map((i) => i.reason)).toEqual(["quiet"]);
  });

  test("a later round's missing feedback isn't hidden by a dismissal of an earlier round's", () => {
    const first = { cards: [card("a")], outstanding: [missing("a", { interviewId: "iv-1", endsAt: daysAgo(9) })], approvals: [], drafts: [] };
    const off = offOf(inboxIssues(first, NOW)[0]!);
    const later = { ...first, outstanding: [...first.outstanding, missing("a", { interviewId: "iv-2", interviewerName: "Kim Roe", endsAt: daysAgo(1) })] };
    expect(inboxIssues(first, NOW, off)).toEqual([]);
    expect(inboxIssues(later, NOW, off)).toMatchObject([{ reason: "feedback", what: "2 interviewers haven't sent feedback" }]);
  });

  test("with feedback missing from two rounds, the row still reads and sorts from the oldest", () => {
    const two = [missing("a", { interviewId: "iv-1", endsAt: daysAgo(9) }), missing("a", { interviewId: "iv-2", endsAt: daysAgo(1) })];
    const other = missing("b", { endsAt: daysAgo(4) });
    const shown = issues({ cards: [card("b"), card("a")], outstanding: [other, ...two] });
    expect(shown.map((i) => i.key)).toEqual(["app-b", "app-a"]);
    expect(shown[1]).toMatchObject({ interviewId: "iv-1", why: "Interview ended 9d ago" });
    expect(waitingSince(shown[1]!)).toBe(daysAgo(9));
  });

  test("an approval dismissed at one step comes back when it reaches this approver at a later one", () => {
    const at = (waitingStep: number) => ({ cards: [], outstanding: [], drafts: [], approvals: [approval({ applicationId: null, waitingStep, steps: 2 })] });
    const off = offOf(inboxIssues(at(1), NOW)[0]!);
    expect(inboxIssues(at(1), NOW, off)).toEqual([]);
    expect(inboxIssues(at(2), NOW, off)).toMatchObject([{ reason: "approval", why: "Your approval, step 2 of 2" }]);
    expect(waitingSince(inboxIssues(at(2), NOW)[0]!)).toBe(daysAgo(1));
  });

  test("standingIssues lists what holds, dismissed or not, behind a more pressing one too", () => {
    expect(standingIssues(input, NOW).map((i) => i.reason)).toEqual(["feedback", "overdue", "decide", "quiet"]);
  });
});

describe("issueLine", () => {
  test("who, the candidate unless the heading names them, and why", () => {
    expect(issueLine(issues({ cards: [card("a")], outstanding: [missing("a")] })[0]!)).toBe("Ivan Petrov · Candidate a · Interview ended 2d ago");
    expect(issueLine(issues({ cards: [card("a", { column: "decide" })] })[0]!)).toMatch(/^Interviewed/);
  });
});
