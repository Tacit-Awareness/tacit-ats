import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseOffer, parseOfferMove } from "./candidate-edit-rules";
import { approvalLine, OFFER_NOTES_MAX, OFFER_SALARY_MAX, OFFER_TERM_MAX, offerBoard, offerGate, offerMoves, offerTermLines, type Offer } from "./offer-rules";

const APP = "11111111-1111-4111-8111-111111111111";
const OFFER = "22222222-2222-4222-8222-222222222222";

const offer = (over: Partial<Offer> = {}): Offer => ({
  offerId: OFFER, applicationId: APP, status: "draft", salary: 185000, currency: "USD", bonus: null, equity: "0.1%", startDate: "2027-03-02",
  expiresOn: null, notes: null, createdBy: "Ada", createdAt: "2026-11-01T00:00:00Z", extendedAt: null, resolvedAt: null, approval: null, customFields: [],
  ...over,
});
const approval = (over: Partial<NonNullable<Offer["approval"]>> = {}): NonNullable<Offer["approval"]> => ({
  required: true, status: "not_requested", requestId: null, waitingStep: null, steps: 2, requestedBy: null, requestedAt: null, decisions: [], ...over,
});
const form = (over: Record<string, string> = {}) => new Map(Object.entries({ applicationId: APP, currency: "usd", ...over }));

describe("the limits", () => {
  test("are core's", () => {
    const core = readFileSync(new URL("../../../../../packages/core/src/client-tools/offers.ts", import.meta.url), "utf8");
    const of = (name: string) => Number(core.match(new RegExp(`const ${name} = ([\\d_]+);`))![1]!.replaceAll("_", ""));
    expect([of("SALARY_MAX"), of("TERM_MAX"), of("OFFER_NOTES_MAX")]).toEqual([OFFER_SALARY_MAX, OFFER_TERM_MAX, OFFER_NOTES_MAX]);
  });
});

describe("offerBoard", () => {
  test("a live application with nothing open may draft", () => {
    expect(offerBoard("interviewing", [])).toEqual({ open: null, closed: [], canDraft: true });
  });

  test("an open offer takes the draft's place, whichever way it stands", () => {
    for (const status of ["draft", "extended"] as const) {
      const b = offerBoard("offer", [offer({ status })]);
      expect([b.open?.status, b.canDraft]).toEqual([status, false]);
    }
  });

  test("a closed offer leaves room for another, but an accepted one doesn't", () => {
    expect(offerBoard("offer", [offer({ status: "declined" })]).canDraft).toBe(true);
    expect(offerBoard("offer", [offer({ status: "withdrawn" })]).canDraft).toBe(true);
    expect(offerBoard("offer", [offer({ status: "accepted" })]).canDraft).toBe(false);
  });

  test("nobody hired or closed gets a new offer", () => {
    for (const stage of ["hired", "rejected", "withdrawn"]) expect(offerBoard(stage, []).canDraft).toBe(false);
  });
});

describe("the approval gate", () => {
  test("no flow, nothing to ask", () => {
    expect(offerGate(offer())).toBe("free");
    expect(approvalLine(offer())).toBeNull();
  });

  test("a flow needs a request; pending waits; approved goes", () => {
    expect(offerGate(offer({ approval: approval() }))).toBe("ask");
    expect(offerGate(offer({ approval: approval({ status: "pending" }) }))).toBe("pending");
    expect(offerGate(offer({ approval: approval({ status: "approved" }) }))).toBe("free");
  });

  test("turned down or reset means asking again", () => {
    for (const status of ["rejected", "reset", "cancelled"] as const) expect(offerGate(offer({ approval: approval({ status }) }))).toBe("ask");
  });

  test("a flow removed since leaves a turned-down request nothing to hold up", () => {
    expect(offerGate(offer({ approval: approval({ required: false, status: "rejected" }) }))).toBe("free");
  });

  test("a draft that isn't cleared can only be withdrawn", () => {
    expect(offerMoves(offer())).toEqual(["extended", "withdrawn"]);
    expect(offerMoves(offer({ approval: approval() }))).toEqual(["withdrawn"]);
    expect(offerMoves(offer({ approval: approval({ status: "pending" }) }))).toEqual(["withdrawn"]);
  });

  test("an extended offer closes; a closed one has no moves", () => {
    expect(offerMoves(offer({ status: "extended" }))).toEqual(["accepted", "declined", "withdrawn"]);
    expect(offerMoves(offer({ status: "accepted" }))).toEqual([]);
  });

  test("the line says who turned it down and why, and nothing once it left draft", () => {
    const a = approval({ status: "rejected", decisions: [{ step: 1, decision: "rejected", by: "Lee", at: "2026-11-01T00:00:00Z", reason: "Over band" }] as never });
    expect(approvalLine(offer({ approval: a }))).toBe("Approval turned down by Lee: Over band");
    expect(approvalLine(offer({ status: "extended", approval: approval({ status: "approved" }) }))).toBeNull();
    expect(approvalLine(offer({ approval: approval({ status: "pending", waitingStep: 1 }) }))).toBe("Waiting for approval, step 1 of 2.");
  });
});

describe("offerTermLines", () => {
  test("leaves out what isn't set", () => {
    expect(offerTermLines(offer())).toEqual([
      { label: "Salary", value: "185,000 USD" },
      { label: "Equity", value: "0.1%" },
      { label: "Start date", value: "2027-03-02" },
    ]);
  });
});

describe("parseOffer", () => {
  test("reads the form whole, an empty field clearing what was there", () => {
    expect(parseOffer(form({ salary: "185,000", bonus: " 10% ", startDate: "2027-03-02", offerId: OFFER }))).toEqual({
      ok: true,
      input: {
        applicationId: APP,
        offerId: OFFER,
        terms: { salary: 185000, currency: "USD", bonus: "10%", equity: null, startDate: "2027-03-02", expiresOn: null, notes: null },
      },
    });
  });

  test("no offer id drafts; 0 is a salary and blank is none", () => {
    const blank = parseOffer(form({ offerId: "" }));
    expect(blank.ok && [blank.input.offerId, blank.input.terms.salary]).toEqual([null, null]);
    const zero = parseOffer(form({ salary: "0" }));
    expect(zero.ok && zero.input.terms.salary).toBe(0);
  });

  test("a salary is refused, never guessed", () => {
    for (const salary of ["185k", "1e6", "0x10", "-5", "12.5", String(OFFER_SALARY_MAX + 1)]) {
      expect(parseOffer(form({ salary }))).toEqual({ ok: false, error: "offer_salary" });
    }
  });

  test("a currency, a date and a length are each refused too", () => {
    expect(parseOffer(form({ currency: "US" }))).toEqual({ ok: false, error: "offer_currency" });
    expect(parseOffer(form({ expiresOn: "soon" }))).toEqual({ ok: false, error: "offer_date" });
    expect(parseOffer(form({ bonus: "x".repeat(OFFER_TERM_MAX + 1) }))).toEqual({ ok: false, error: "offer_long" });
  });

  test("a tampered id is no offer", () => {
    expect(parseOffer(form({ applicationId: "nope" }))).toEqual({ ok: false, error: "offer_gone" });
    expect(parseOffer(form({ offerId: "nope" }))).toEqual({ ok: false, error: "offer_gone" });
  });
});

describe("parseOfferMove", () => {
  const move = (from: string, status: string) => parseOfferMove(new Map([["offerId", OFFER], ["from", from], ["status", status]]));

  test("takes what the page offers, from the status it showed", () => {
    expect(move("draft", "extended")).toEqual({ offerId: OFFER, from: "draft", status: "extended" });
    expect(move("extended", "accepted")).toEqual({ offerId: OFFER, from: "extended", status: "accepted" });
  });

  test("refuses a pair it never offers", () => {
    expect(move("draft", "accepted")).toBeNull();
    expect(move("extended", "extended")).toBeNull();
    expect(move("accepted", "withdrawn")).toBeNull();
    expect(move("draft", "toString")).toBeNull();
  });
});
