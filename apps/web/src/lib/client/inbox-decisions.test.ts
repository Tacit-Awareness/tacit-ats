import { clientTools } from "@tacit-ats/core";
import { describe, expect, test } from "vitest";
import { approvalNotice, confirmCopy, decisionProps, offerTermLines, parseDecision, type DecisionAction } from "./inbox-decisions";
import type { IssueFix } from "./inbox-issues";

const ID = "11111111-1111-4111-8111-111111111111";
const REASON = "22222222-2222-4222-8222-222222222222";
const form = (fields: Record<string, string>) => ({ get: (k: string) => fields[k] ?? null });
const issue = { key: "appr-x", candidate: { id: "p", name: "Sam Stone" }, job: { id: "j", title: "Engineer" } };
const keys = (actions: DecisionAction[]) => actions.map((a) => a.key);
const confirmed = (a: DecisionAction) => "mode" in a;

describe("the bar", () => {
  test("an approval: A approves, R rejects, both confirmed first, and no O", () => {
    const d = decisionProps({ type: "approval", requestId: ID, kind: "offer" }, issue, [])!;
    expect(keys(d.actions)).toEqual(["a", "r"]);
    expect(d.actions.every(confirmed)).toBe(true);
    expect(d.target).toEqual({ name: "requestId", value: ID });
  });

  test("the team's call: A is a link, O and R are confirmed first", () => {
    const fix: IssueFix = { type: "decide", applicationId: ID, nextRoundHref: "/client/candidates/p" };
    const d = decisionProps(fix, issue, [{ reasonId: REASON, name: "Skills" }])!;
    expect(d.actions.map((a) => [a.key, confirmed(a)])).toEqual([["a", false], ["o", true], ["r", true]]);
    expect(d.actions[0]).toMatchObject({ label: "Next round", href: "/client/candidates/p" });
    expect(d.target).toEqual({ name: "applicationId", value: ID });
    expect(d.reasons).toEqual([{ reasonId: REASON, name: "Skills" }]);
  });

  test("any other fix has no bar", () => {
    expect(decisionProps({ type: "link", label: "Open", href: "/x" }, issue, [])).toBeNull();
    expect(decisionProps({ type: "write", write: "touch", label: "Log", applicationId: ID, nextAction: null }, issue, [])).toBeNull();
  });
});

describe("what the dialog says", () => {
  const offer = { approval: "offer" as const, candidate: "Sam Stone", job: "Engineer" };
  const job = { approval: "job_open" as const, candidate: null, job: "Engineer" };
  const call = { approval: null, candidate: "Sam Stone", job: "Engineer" };

  test("names what is being decided, and what isn't sent", () => {
    expect(confirmCopy("approve", offer)).toMatchObject({ title: "Approve the offer for Sam Stone?", danger: false });
    expect(confirmCopy("approve", offer).body).toContain("Nothing is sent to Sam Stone");
    expect(confirmCopy("approve", job).title).toBe("Approve opening Engineer?");
    expect(confirmCopy("reject", offer)).toMatchObject({ title: "Reject the offer for Sam Stone?", danger: true });
    expect(confirmCopy("reject", job).title).toBe("Reject opening Engineer?");
    expect(confirmCopy("offer", call).body).toContain("No offer is drafted or sent");
    expect(confirmCopy("close", call)).toMatchObject({ title: "Reject Sam Stone?", danger: true });
    expect(confirmCopy("close", call).body).toContain("No email goes out");
  });

  test("a missing name still reads", () => {
    expect(confirmCopy("approve", { approval: "offer", candidate: null, job: null }).title).toBe("Approve the offer for this candidate?");
    expect(confirmCopy("close", { approval: null, candidate: null, job: null }).body).toContain("this job");
  });
});

describe("the posted fields", () => {
  test("approve and reject name the request, with a trimmed reason", () => {
    expect(parseDecision(form({ decision: "approve", requestId: ID }))).toEqual({ on: "approval", requestId: ID, decision: "approve", reason: null });
    expect(parseDecision(form({ decision: "reject", requestId: ID, reason: "  Over band " }))).toEqual({ on: "approval", requestId: ID, decision: "reject", reason: "Over band" });
    expect(parseDecision(form({ decision: "reject", requestId: ID, reason: "x".repeat(9000) }))).toMatchObject({ reason: "x".repeat(clientTools.APPROVAL_REASON_MAX) });
  });

  test("offer and close always move from interviewing, whatever was posted", () => {
    expect(parseDecision(form({ decision: "offer", applicationId: ID, stage: "hired", expectedStage: "offer" }))).toEqual({
      on: "application",
      move: { applicationId: ID, stage: "offer", expectedStage: "interviewing", reasonId: null, note: null },
    });
    expect(parseDecision(form({ decision: "close", applicationId: ID, reasonId: REASON, note: " Skills gap " }))).toEqual({
      on: "application",
      move: { applicationId: ID, stage: "rejected", expectedStage: "interviewing", reasonId: REASON, note: "Skills gap" },
    });
  });

  test("offer ignores a reason; close with no reason reaches the write, which refuses it", () => {
    expect(parseDecision(form({ decision: "offer", applicationId: ID, reasonId: REASON, note: "n" }))).toMatchObject({ move: { reasonId: null, note: null } });
    expect(parseDecision(form({ decision: "close", applicationId: ID }))).toMatchObject({ move: { stage: "rejected", reasonId: null } });
  });

  test("anything the page never sent is nothing", () => {
    expect(parseDecision(form({}))).toBeNull();
    expect(parseDecision(form({ decision: "hire", applicationId: ID }))).toBeNull();
    expect(parseDecision(form({ decision: "approve", requestId: "nope" }))).toBeNull();
    expect(parseDecision(form({ decision: "approve", applicationId: ID }))).toBeNull();
    expect(parseDecision(form({ decision: "offer", requestId: ID }))).toBeNull();
    expect(parseDecision(form({ decision: "close", applicationId: "1' or 1=1" }))).toBeNull();
  });
});

describe("the notice", () => {
  test("each outcome has its code", () => {
    expect(approvalNotice("advanced", "offer")).toBe("approved_step");
    expect(approvalNotice("approved", "offer")).toBe("approved_offer");
    expect(approvalNotice("approved", "job_open")).toBe("approved_job");
    expect(approvalNotice("rejected", "offer")).toBe("rejected_offer");
    expect(approvalNotice("rejected", "job_open")).toBe("rejected_job");
    expect(approvalNotice("not_pending", "job_open")).toBe("already_decided");
  });
});

describe("an offer's terms", () => {
  const none = { salary: null, currency: null, bonus: null, equity: null, startDate: null, expiresOn: null };

  test("as lines, the ones not set left out", () => {
    expect(offerTermLines({ ...none, salary: 180000, currency: "USD", equity: "0.5%", startDate: "2026-12-01" })).toEqual([
      { label: "Salary", value: "180,000 USD" },
      { label: "Equity", value: "0.5%" },
      { label: "Start date", value: "2026-12-01" },
    ]);
    expect(offerTermLines(none)).toEqual([]);
  });

  test("a salary of no currency, and a salary of zero, still show", () => {
    expect(offerTermLines({ ...none, salary: 0 })).toEqual([{ label: "Salary", value: "0" }]);
  });
});
