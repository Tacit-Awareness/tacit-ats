import { describe, expect, test } from "vitest";
import { closeReasonKind, nextStage, parseMove, parseNextAction, parseOwner, parseTouch } from "./candidate-edit-rules";

const APP = "c5d00000-0000-4000-8000-0000000000b1";
const REASON = "c5e00000-0000-4000-8000-0000000000b1";
const MEMBER = "c5a00000-0000-4000-8000-0000000000b1";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("closeReasonKind", () => {
  test("a reject needs a rejected reason, a withdrawal a withdrew one, anything else none", () => {
    expect(closeReasonKind("rejected")).toBe("rejected");
    expect(closeReasonKind("withdrawn")).toBe("withdrew");
    for (const s of ["sourced", "screening", "offer", "hired", "nonsense"]) expect(closeReasonKind(s)).toBeNull();
  });
});

describe("nextStage", () => {
  test("steps along the live stages to hired, and stops there and at a close", () => {
    expect(nextStage("sourced")).toBe("contacted");
    expect(nextStage("interviewing")).toBe("offer");
    expect(nextStage("offer")).toBe("hired");
    expect(nextStage("hired")).toBeNull();
    expect(nextStage("rejected")).toBeNull();
    expect(nextStage("withdrawn")).toBeNull();
  });
});

describe("parseMove", () => {
  test("reads the target and the stage the page showed", () => {
    expect(parseMove(form({ applicationId: APP, stage: "screening", expectedStage: "sourced", reasonId: REASON, note: "x" }))).toEqual({
      applicationId: APP,
      stage: "screening",
      expectedStage: "sourced",
      reasonId: null,
      note: null,
    });
  });

  test("keeps a reason and a trimmed note only for a close", () => {
    expect(parseMove(form({ applicationId: APP, stage: "rejected", expectedStage: "screening", reasonId: REASON, note: "  Too junior  " }))).toMatchObject({
      reasonId: REASON,
      note: "Too junior",
    });
    expect(parseMove(form({ applicationId: APP, stage: "withdrawn", expectedStage: "offer", reasonId: "not-an-id", note: " " }))).toMatchObject({
      reasonId: null,
      note: null,
    });
  });

  test("refuses a bad id, an unknown stage, or no expected stage", () => {
    expect(parseMove(form({ applicationId: "x", stage: "screening", expectedStage: "sourced" }))).toBeNull();
    expect(parseMove(form({ applicationId: APP, stage: "promoted", expectedStage: "sourced" }))).toBeNull();
    expect(parseMove(form({ applicationId: APP, stage: "screening" }))).toBeNull();
  });
});

describe("parseNextAction", () => {
  test("an action with a due date", () => {
    expect(parseNextAction(form({ applicationId: APP, nextAction: " Send the take-home ", due: "2026-11-02" }))).toEqual({
      ok: true,
      input: { applicationId: APP, nextAction: "Send the take-home", due: "2026-11-02" },
    });
  });

  test("Clear, or an empty action, clears both", () => {
    expect(parseNextAction(form({ applicationId: APP, nextAction: "Call", due: "2026-11-02", clear: "1" }))).toEqual({
      ok: true,
      input: { applicationId: APP, nextAction: null, due: null },
    });
    expect(parseNextAction(form({ applicationId: APP, nextAction: "", due: "" }))).toEqual({
      ok: true,
      input: { applicationId: APP, nextAction: null, due: null },
    });
  });

  test("a date that is not a date, or a date with nothing to do, is refused", () => {
    expect(parseNextAction(form({ applicationId: APP, nextAction: "Call", due: "next week" }))).toEqual({ ok: false, error: "invalid_due" });
    expect(parseNextAction(form({ applicationId: APP, nextAction: "", due: "2026-11-02" }))).toEqual({ ok: false, error: "invalid_due" });
    expect(parseNextAction(form({ applicationId: "x" }))).toEqual({ ok: false, error: "not_found" });
  });
});

describe("parseOwner and parseTouch", () => {
  test("an owner is a member's id, or empty for nobody; anything else is refused", () => {
    expect(parseOwner(form({ applicationId: APP, ownerActorId: MEMBER }))).toEqual({ applicationId: APP, ownerActorId: MEMBER });
    expect(parseOwner(form({ applicationId: APP, ownerActorId: "" }))).toEqual({ applicationId: APP, ownerActorId: null });
    expect(parseOwner(form({ applicationId: APP, ownerActorId: "Ada" }))).toBeNull();
  });

  test("a touch's note is optional", () => {
    expect(parseTouch(form({ applicationId: APP, note: " Called " }))).toEqual({ applicationId: APP, note: "Called" });
    expect(parseTouch(form({ applicationId: APP }))).toEqual({ applicationId: APP, note: null });
    expect(parseTouch(form({ applicationId: "x" }))).toBeNull();
  });
});
