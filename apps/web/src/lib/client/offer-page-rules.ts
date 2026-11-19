import type { Offer } from "./offer-rules";
import { offerGate } from "./offer-rules";

// The Offer page's rules (design/tacit-tickets's Offers), pure and
// unit-tested: the queue's groups, the sign-off steps on the right, and the one
// next step in the bar. What may happen is core's and the database's; this only
// says so first, as offer-rules.ts does for the candidate page.

export const OFFER_GROUPS = [
  { key: "sign", label: "Needs Your Sign-Off" },
  { key: "draft", label: "Drafts" },
  { key: "out", label: "Extended" },
  { key: "closed", label: "Closed" },
] as const;
export type OfferGroup = (typeof OFFER_GROUPS)[number]["key"];

export function groupOf(o: Pick<Offer, "status">, waitingOnMe: boolean): OfferGroup {
  if (o.status === "draft") return waitingOnMe ? "sign" : "draft";
  return o.status === "extended" ? "out" : "closed";
}

export type SignOffStep = { name: string; who: string | null; note: string; done: boolean; now: boolean };

/** Drafted, each approval step, extended, then how it closed. */
export function signOffSteps(o: Pick<Offer, "status" | "createdBy" | "approval" | "extendedAt" | "resolvedAt">): SignOffStep[] {
  const a = o.approval;
  const steps: SignOffStep[] = [{ name: "Drafted", who: o.createdBy, note: "", done: true, now: false }];
  const n = a && (a.status !== "not_requested" || a.required) ? Math.max(1, a.steps) : 0;
  for (let i = 1; i <= n; i++) {
    const d = a!.decisions.find((x) => x.step === i);
    const now = a!.status === "pending" && a!.waitingStep === i;
    steps.push({
      name: n > 1 ? `Approval, Step ${i}` : "Approval",
      who: d?.by ?? null,
      note: d ? (d.decision === "approved" ? "Approved" : "Sent back") : now ? "Waiting" : "",
      done: d?.decision === "approved" || a!.status === "approved" || o.status !== "draft",
      now,
    });
  }
  steps.push({ name: "Extended", who: null, note: o.extendedAt ? "Extended" : "", done: o.status !== "draft" && o.status !== "withdrawn" ? true : !!o.extendedAt, now: o.status === "draft" && offerGate(o) === "free" });
  const closing = o.status === "accepted" ? "Accepted" : o.status === "declined" ? "Declined" : o.status === "withdrawn" ? "Withdrawn" : "";
  steps.push({ name: "Answered", who: null, note: closing, done: o.status === "accepted", now: o.status === "extended" });
  return steps;
}

export type NextStep =
  | { kind: "decide"; say: string; requestId: string }
  | { kind: "waiting"; say: string }
  | { kind: "ask"; say: string }
  | { kind: "extend"; say: string }
  | { kind: "answer"; say: string }
  | { kind: "closed"; say: string };

/** The one next step: sign off, wait, ask, mark extended, record the answer, or nothing. */
export function nextStep(o: Offer, name: string, myRequestId: string | null): NextStep {
  const first = name.split(/\s+/)[0] || name;
  const a = o.approval;
  if (o.status === "draft") {
    if (myRequestId && a?.status === "pending") return { kind: "decide", say: `${a.requestedBy ?? "Someone"} asked you to sign off`, requestId: myRequestId };
    const gate = offerGate(o);
    if (gate === "pending") return { kind: "waiting", say: a?.waitingStep ? `Waiting on sign-off, step ${a.waitingStep} of ${a.steps}` : "Waiting on sign-off" };
    if (gate === "ask") {
      const no = a?.decisions.find((d) => d.decision === "rejected");
      return { kind: "ask", say: a?.status === "rejected" ? `${no?.by ?? "An approver"} sent it back. Change the terms and ask again.` : "This job needs its offers signed off before they go out." };
    }
    return { kind: "extend", say: a?.status === "approved" ? "Signed off. Ready to go out." : `Ready to go out to ${first}.` };
  }
  if (o.status === "extended") return { kind: "answer", say: `With ${first}` };
  return { kind: "closed", say: o.status === "accepted" ? `${first} accepted` : o.status === "declined" ? `${first} declined` : "Withdrawn" };
}
