import { describe, expect, test } from "vitest";
import type { Offer } from "./offer-rules";
import { groupOf, nextStep, signOffSteps } from "./offer-page-rules";

const offer = (over: Partial<Offer> = {}): Offer =>
  ({
    offerId: "o1",
    applicationId: "a1",
    status: "draft",
    salary: 180000,
    currency: "USD",
    bonus: null,
    equity: null,
    startDate: null,
    expiresOn: null,
    notes: null,
    createdBy: "Ada",
    createdAt: "2026-11-01T00:00:00Z",
    extendedAt: null,
    resolvedAt: null,
    approval: null,
    customFields: [],
    ...over,
  }) as Offer;
const approval = (over: Partial<NonNullable<Offer["approval"]>> = {}) =>
  ({ required: true, status: "not_requested", requestId: null, waitingStep: null, steps: 2, requestedBy: null, requestedAt: null, decisions: [], ...over }) as NonNullable<Offer["approval"]>;

test("groups: a draft waiting on you, a draft, extended, closed", () => {
  expect(groupOf(offer(), true)).toBe("sign");
  expect(groupOf(offer(), false)).toBe("draft");
  expect(groupOf(offer({ status: "extended" }), false)).toBe("out");
  expect(groupOf(offer({ status: "accepted" }), false)).toBe("closed");
});

describe("the next step", () => {
  test("a draft with no flow is ready to go out", () => {
    expect(nextStep(offer(), "Nora Lind", null)).toEqual({ kind: "extend", say: "Ready to go out to Nora." });
  });
  test("a job with a flow asks first, and says who sent it back", () => {
    expect(nextStep(offer({ approval: approval() }), "Nora", null).kind).toBe("ask");
    const back = nextStep(offer({ approval: approval({ status: "rejected", decisions: [{ step: 1, decision: "rejected", by: "Lee", at: "x", reason: null }] }) }), "Nora", null);
    expect(back).toEqual({ kind: "ask", say: "Lee sent it back. Change the terms and ask again." });
  });
  test("pending: yours to decide, or someone else's to wait on", () => {
    const pending = offer({ approval: approval({ status: "pending", requestId: "r1", waitingStep: 1, requestedBy: "Ada" }) });
    expect(nextStep(pending, "Nora", "r1")).toEqual({ kind: "decide", say: "Ada asked you to sign off", requestId: "r1" });
    expect(nextStep(pending, "Nora", null)).toEqual({ kind: "waiting", say: "Waiting on sign-off, step 1 of 2" });
  });
  test("extended waits on their answer; closed says how it ended", () => {
    expect(nextStep(offer({ status: "extended" }), "Nora Lind", null)).toEqual({ kind: "answer", say: "With Nora" });
    expect(nextStep(offer({ status: "declined" }), "Nora Lind", null).say).toBe("Nora declined");
  });
});

describe("sign-off steps", () => {
  test("no flow: drafted, extended, answered", () => {
    expect(signOffSteps(offer()).map((s) => s.name)).toEqual(["Drafted", "Extended", "Answered"]);
  });
  test("a two-step flow names each step and marks the one waiting", () => {
    const steps = signOffSteps(offer({ approval: approval({ status: "pending", waitingStep: 2, decisions: [{ step: 1, decision: "approved", by: "Lee", at: "x", reason: null }] }) }));
    expect(steps.map((s) => [s.name, s.who, s.note, s.done, s.now])).toEqual([
      ["Drafted", "Ada", "", true, false],
      ["Approval, Step 1", "Lee", "Approved", true, false],
      ["Approval, Step 2", null, "Waiting", false, true],
      ["Extended", null, "", false, false],
      ["Answered", null, "", false, false],
    ]);
  });
  test("accepted: everything done", () => {
    expect(signOffSteps(offer({ status: "accepted", extendedAt: "x" })).every((s) => s.done)).toBe(true);
  });
});
