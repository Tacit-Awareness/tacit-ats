import { describe, expect, test } from "vitest";
import { CANDIDATE_NOTE_MAX, closeReasonKind, nextStage, noteable, parseMove, parseNextAction, parseNote, parseOwner, parseTouch } from "./candidate-edit-rules";

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

describe("noteable", () => {
  test("anyone but someone erased", () => {
    expect(noteable("Grace Hopper")).toBe(true);
    expect(noteable(null)).toBe(true);
    expect(noteable("Anonymized candidate")).toBe(false);
  });
});

describe("parseNote", () => {
  test("a note is trimmed and keeps its own line breaks", () => {
    expect(parseNote(form({ text: "  Strong on systems.\n\nAsk about relocation.  " }))).toEqual({ ok: true, text: "Strong on systems.\n\nAsk about relocation." });
  });

  test("the CRLF a browser posts comes back as LF, so a box filled to its limit is not refused", () => {
    expect(parseNote(form({ text: "one\r\ntwo\rthree" }))).toEqual({ ok: true, text: "one\ntwo\nthree" });
    const full = `${"x".repeat(CANDIDATE_NOTE_MAX - 2)}\r\nx`;
    expect(full.length).toBeGreaterThan(CANDIDATE_NOTE_MAX);
    expect(parseNote(form({ text: full }))).toMatchObject({ ok: true });
  });

  test("nothing to say is refused, whatever was posted", () => {
    expect(parseNote(form({ text: " \r\n\t " }))).toEqual({ ok: false, error: "note_empty", text: "" });
    expect(parseNote(form({ text: "\u0000 \u0000" }))).toEqual({ ok: false, error: "note_empty", text: "" });
    expect(parseNote(form({}))).toEqual({ ok: false, error: "note_empty", text: "" });
    const file = new FormData();
    file.set("text", new File(["x"], "x.txt"));
    expect(parseNote(file)).toEqual({ ok: false, error: "note_empty", text: "" });
  });

  test("a NUL is dropped, since Postgres cannot hold one", () => {
    expect(parseNote(form({ text: "a\u0000b" }))).toEqual({ ok: true, text: "ab" });
  });

  test("too long is refused with the words intact, never cut", () => {
    const text = "x".repeat(CANDIDATE_NOTE_MAX + 1);
    expect(parseNote(form({ text }))).toEqual({ ok: false, error: "note_long", text });
    expect(parseNote(form({ text: text.slice(1) }))).toEqual({ ok: true, text: text.slice(1) });
  });
});
