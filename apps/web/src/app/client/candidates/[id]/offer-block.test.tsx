import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { requireClient, updateOffer, createOffer, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  updateOffer: vi.fn(),
  createOffer: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, updateOffer, createOffer } };
});

import type { Offer } from "@/lib/client/offer-rules";
import { moveOfferAction, saveOfferAction } from "./actions";
import { OfferBlock } from "./offer-block";

const APP = "c1d00000-0000-4000-8000-000000000001";
const OFFER = "c1f00000-0000-4000-8000-000000000001";
const CANDIDATE = "c1c00000-0000-4000-8000-000000000001";
const TARGET = { candidateId: CANDIDATE, applicationId: APP, name: "Grace" };

const offer = (over: Partial<Offer> = {}): Offer => ({
  offerId: OFFER, applicationId: APP, status: "draft", salary: 185000, currency: "USD", bonus: null, equity: null, startDate: null, expiresOn: null,
  notes: null, createdBy: "Ada", createdAt: "2026-11-01T00:00:00Z", extendedAt: null, resolvedAt: null, approval: null, customFields: [], ...over,
});
const draw = (stage: string, offers: Offer[]) => renderToStaticMarkup(<OfferBlock target={TARGET} stage={stage} offers={offers} />);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireClient.mockResolvedValue({ db: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "draft", stage: "offer" }, error: null }) }) }) }) }, actorId: "a1", accessLevel: "admin", org: { id: "o1" } });
});

describe("the block", () => {
  test("offers a draft when there's none", () => {
    expect(draw("interviewing", [])).toContain("Draft an offer");
  });

  test("a draft shows its terms and can be extended, edited or withdrawn", () => {
    const html = draw("offer", [offer()]);
    expect(html).toContain("185,000 USD");
    for (const word of ["Mark as extended", "Edit terms", "Withdraw"]) expect(html).toContain(word);
    expect(html).not.toContain("Draft an offer");
  });

  test("a draft needing approval asks for it instead of going out", () => {
    const html = draw("offer", [offer({ approval: { required: true, status: "not_requested", requestId: null, waitingStep: null, steps: 1, requestedBy: null, requestedAt: null, decisions: [] } })]);
    expect(html).toContain("Ask for approval");
    expect(html).not.toContain("Mark as extended");
  });

  test("an extended offer's terms can't be edited, and it records the answer", () => {
    const html = draw("offer", [offer({ status: "extended" })]);
    for (const word of ["They accepted", "They declined", "Withdraw"]) expect(html).toContain(word);
    expect(html).not.toContain("Edit terms");
  });

  test("a closed offer folds away, and a declined one leaves room for another", () => {
    const html = draw("offer", [offer({ status: "declined" })]);
    expect(html).toContain("<details");
    expect(html).toContain("Draft an offer");
  });

  test("the candidate's text stays text", () => {
    expect(draw("offer", [offer({ notes: "<img src=x>" })])).toContain("&lt;img src=x&gt;");
  });
});

describe("the actions", () => {
  test("a tampered form writes nothing", async () => {
    expect(await moveOfferAction(form({ offerId: OFFER, from: "draft", status: "accepted" }))).toEqual({ ok: false, error: "offer_gone" });
    expect(await saveOfferAction(form({ applicationId: APP, currency: "USD", salary: "lots" }))).toEqual({ ok: false, error: "offer_salary" });
    expect(updateOffer).not.toHaveBeenCalled();
    expect(createOffer).not.toHaveBeenCalled();
  });

  test("a failed write says it may have landed, and logs no terms", async () => {
    updateOffer.mockRejectedValue(new Error("salary 185000 refused"));
    expect(await moveOfferAction(form({ candidateId: CANDIDATE, offerId: OFFER, from: "draft", status: "withdrawn" }))).toEqual({ ok: false, error: "failed" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("185000");
  });

  test("a write refreshes the pages that show it", async () => {
    updateOffer.mockResolvedValue({ outcome: "updated", status: "withdrawn", changed: ["status"] });
    expect(await moveOfferAction(form({ candidateId: CANDIDATE, offerId: OFFER, from: "draft", status: "withdrawn" }))).toEqual({ ok: true, notice: "offer_withdrawn" });
    for (const path of [`/client/candidates/${CANDIDATE}`, "/client/pipeline", "/client/inbox"]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });
});
