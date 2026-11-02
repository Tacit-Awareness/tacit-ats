import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { moveOffer, readOffers, saveOffer } from "./offers";

const { getOffers, updateOffer, createOffer } = vi.hoisted(() => ({ getOffers: vi.fn(), updateOffer: vi.fn(), createOffer: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, getOffers, updateOffer, createOffer } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const row = (data: unknown): Db => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }) }) as unknown as Db;
const refuse = (code: clientTools.ClientToolErrorCode, message = "No.") => new clientTools.ClientToolError(code, message);
const TERMS = { salary: 1, currency: "USD", bonus: null, equity: null, startDate: null, expiresOn: null, notes: null };

beforeEach(() => {
  getOffers.mockReset();
  updateOffer.mockReset();
  createOffer.mockReset();
});

describe("readOffers", () => {
  test("an interviewer is never asked", async () => {
    expect(await readOffers(row(null), { ...CTX, accessLevel: "limited" }, ["a"])).toEqual({});
    expect(getOffers).not.toHaveBeenCalled();
  });

  test("a job they can't manage is left out, and a failed read is a failure, not an empty list", async () => {
    getOffers.mockImplementation(async (_d, _c, { applicationId }) => {
      if (applicationId === "no") throw refuse("forbidden");
      return [];
    });
    expect(await readOffers(row(null), CTX, ["yes", "no"])).toEqual({ yes: [] });
    getOffers.mockRejectedValue(new Error("connection refused"));
    await expect(readOffers(row(null), CTX, ["yes"])).rejects.toThrow("connection refused");
  });
});

describe("a refusal is a code", () => {
  test.each([
    [refuse("forbidden"), "offer_forbidden"],
    [refuse("not_found"), "offer_gone"],
    [refuse("rate_limited"), "rate_limited"],
    [refuse("invalid", "Not saved: this offer needs its approval. request_approval with the offer_id asks for it."), "offer_approval"],
    [refuse("invalid", "This application already has an open offer. Change it with update_offer, or withdraw it first."), "offer_exists"],
    [refuse("invalid", "An offer that is draft can only become extended or withdrawn."), "offer_changed"],
  ])("%s", async (err, error) => {
    createOffer.mockRejectedValue(err);
    expect(await saveOffer(row({ stage: "offer" }), CTX, { applicationId: "a", offerId: null, terms: TERMS })).toEqual({ ok: false, error });
  });

  test("anything else is a failure for the action to word", async () => {
    updateOffer.mockRejectedValue(new Error("boom"));
    await expect(moveOffer(row({ status: "draft" }), CTX, { offerId: "o", from: "draft", status: "withdrawn" })).rejects.toThrow("boom");
  });
});

describe("moveOffer", () => {
  test("asks for the status alone, so the terms stay as they were", async () => {
    updateOffer.mockResolvedValue({ outcome: "updated", status: "extended", changed: ["status"] });
    expect(await moveOffer(row({ status: "draft" }), CTX, { offerId: "o", from: "draft", status: "extended" })).toEqual({ ok: true, notice: "offer_extended" });
    expect(updateOffer).toHaveBeenCalledWith(expect.anything(), CTX, { offerId: "o", status: "extended" });
  });

  test("lost a race: said so", async () => {
    updateOffer.mockResolvedValue({ outcome: "changed_since", status: "draft", changed: [] });
    expect(await moveOffer(row({ status: "draft" }), CTX, { offerId: "o", from: "draft", status: "extended" })).toEqual({ ok: false, error: "offer_changed" });
  });
});
