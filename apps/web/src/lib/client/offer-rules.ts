import type { clientTools } from "@tacit-ats/core";

// What the candidate page's Offer block shows and offers, pure and with type
// imports only, since a client component needs it (offer-block.tsx). What may
// happen is core's and the database's: this only says so first, and offers the
// page's buttons. The posted fields are read back in candidate-edit-rules.ts,
// the writes are lib/client/offers.ts.

export type Offer = clientTools.Offer;
export type OfferMove = "extended" | "accepted" | "declined" | "withdrawn";

/** clientTools' offers.ts's limits, repeated for the form; offer-rules.test.ts holds them together. */
export const OFFER_SALARY_MAX = 100_000_000;
export const OFFER_TERM_MAX = 500;
export const OFFER_NOTES_MAX = 5000;
export const OFFER_DEFAULT_CURRENCY = "USD";

const OPEN: ReadonlySet<string> = new Set(["draft", "extended"]);
const NO_NEW_OFFER: ReadonlySet<string> = new Set(["hired", "rejected", "withdrawn"]);

export type OfferBoard = {
  /** The one draft or extended offer the database allows. */
  open: Offer | null;
  closed: Offer[];
  /** Nothing open, nothing accepted, and an application still going. */
  canDraft: boolean;
};

export function offerBoard(stage: string, offers: Offer[]): OfferBoard {
  const open = offers.find((o) => OPEN.has(o.status)) ?? null;
  return {
    open,
    closed: offers.filter((o) => !OPEN.has(o.status)),
    canDraft: !open && !NO_NEW_OFFER.has(stage) && !offers.some((o) => o.status === "accepted"),
  };
}

/** Whether a draft may be extended: `free`, or waiting on a request, or needing one (`ask`). */
export type OfferGate = "free" | "ask" | "pending";

export function offerGate(offer: Pick<Offer, "approval">): OfferGate {
  const a = offer.approval;
  if (!a || a.status === "approved") return "free";
  if (a.status === "pending") return "pending";
  return a.required ? "ask" : "free";
}

/** The status changes an offer can take, as core's NEXT, the first being the way on. A draft that isn't cleared can only be withdrawn. */
export function offerMoves(offer: Pick<Offer, "status" | "approval">): OfferMove[] {
  if (offer.status === "draft") return offerGate(offer) === "free" ? ["extended", "withdrawn"] : ["withdrawn"];
  if (offer.status === "extended") return ["accepted", "declined", "withdrawn"];
  return [];
}

/** Each change's button and what its confirmation says. Nothing here reaches the candidate, so each one says what it records. */
export const OFFER_MOVE_COPY: Record<OfferMove, { button: string; title: (name: string) => string; body: string; confirm: string }> = {
  extended: {
    button: "Mark as extended",
    title: (name) => `Has the offer gone to ${name}?`,
    body: "This records that it went out. tATS doesn't send it. The terms can't change after this, so what was extended stays on record.",
    confirm: "Mark as extended",
  },
  accepted: {
    button: "They accepted",
    title: (name) => `Did ${name} accept?`,
    body: "This closes the offer as accepted. It doesn't mark them hired: move their stage when you're ready.",
    confirm: "Record accepted",
  },
  declined: {
    button: "They declined",
    title: (name) => `Did ${name} decline?`,
    body: "This closes the offer as declined. Their stage stays as it is, and you can draft a new offer.",
    confirm: "Record declined",
  },
  withdrawn: {
    button: "Withdraw",
    title: (name) => `Withdraw the offer for ${name}?`,
    body: "This closes the offer and tells nobody. Their stage stays as it is, and you can draft a new offer.",
    confirm: "Withdraw offer",
  },
};

const STATUS_WORDS: Record<clientTools.OfferStatus, string> = {
  draft: "Draft",
  extended: "Extended",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const offerStatusWord = (status: clientTools.OfferStatus): string => STATUS_WORDS[status];

/** Where an offer's approval stands, or null when it has none to speak of. */
export function approvalLine(offer: Pick<Offer, "status" | "approval">): string | null {
  const a = offer.approval;
  if (!a || offer.status !== "draft") return null;
  switch (a.status) {
    case "not_requested":
      return a.required ? "This job needs its offers approved before they go out." : null;
    case "pending":
      return a.waitingStep ? `Waiting for approval, step ${a.waitingStep} of ${a.steps}.` : "Waiting for approval.";
    case "approved":
      return "Approved. It can go out.";
    case "rejected": {
      const no = a.decisions.find((d) => d.decision === "rejected");
      return no?.reason ? `Approval turned down${no.by ? ` by ${no.by}` : ""}: ${no.reason}` : "Approval turned down. Change it and ask again.";
    }
    default:
      return "Its approval no longer stands. Ask again.";
  }
}

export type TermLine = { label: string; value: string };

type Terms = Pick<Offer, "salary" | "bonus" | "equity" | "startDate" | "expiresOn"> & { currency: string | null };

/** An offer's terms as lines. The ones not set are left out. */
export function offerTermLines(terms: Terms): TermLine[] {
  const lines: [string, string | null][] = [
    ["Salary", terms.salary === null ? null : [terms.salary.toLocaleString("en-US"), terms.currency].filter(Boolean).join(" ")],
    ["Bonus", terms.bonus],
    ["Equity", terms.equity],
    ["Start date", terms.startDate],
    ["Expires", terms.expiresOn],
  ];
  return lines.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}
