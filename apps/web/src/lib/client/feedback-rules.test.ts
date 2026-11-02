import { clientTools } from "@tacit-ats/core";
import { describe, expect, test } from "vitest";
import { canFile, FEEDBACK_NOTES_MAX, feedbackRefusal, parseFeedback, RATING_NOTE_MAX } from "./feedback-rules";

const IV = "e6a00000-0000-4000-8000-0000000000b1";
const A1 = "e6a00000-0000-4000-8000-0000000000c1";
const A2 = "e6a00000-0000-4000-8000-0000000000c2";

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};
const base: [string, string][] = [["interviewId", IV], ["recommendation", "yes"], ["rating", ""], ["notes", "Clear on trade-offs."]];

describe("parseFeedback", () => {
  test("a plain filing", () => {
    const p = parseFeedback(form(base));
    expect(p).toMatchObject({ ok: true, input: { interviewId: IV, recommendation: "yes", rating: null, notes: "Clear on trade-offs.", ratings: [] } });
  });

  test("scorecard ratings only for the ids the page drew, blanks left out, notes kept", () => {
    const p = parseFeedback(form([...base, ["rating", "3"], ["attr", A1], ["attr", A2], ["r:" + A1, "4"], ["rn:" + A1, " Sharp "], ["r:" + A2, ""], ["r:e6a00000-0000-4000-8000-0000000000ff", "1"]]));
    expect(p.ok && p.input.ratings).toEqual([{ attributeId: A1, rating: 4, note: "Sharp" }]);
  });

  test("the first rating field wins, as FormData.get reads it", () => {
    const p = parseFeedback(form([["interviewId", IV], ["recommendation", "no"], ["rating", "2"], ["notes", "x"]]));
    expect(p.ok && p.input.rating).toBe(2);
  });

  test("a tampered interview id is no answer at all", () => {
    expect(parseFeedback(form([["interviewId", "nope"], ...base.slice(1)]))).toEqual({ ok: false, error: null });
  });

  test("each refusal keeps what was typed", () => {
    const missing = parseFeedback(form([["interviewId", IV], ["notes", "kept"], ["attr", A1], ["r:" + A1, "2"], ["rn:" + A1, "why"]]));
    expect(missing).toMatchObject({ ok: false, error: "no_recommendation", draft: { notes: "kept", ratings: { [A1]: 2 }, ratingNotes: { [A1]: "why" } } });
    expect(parseFeedback(form([["interviewId", IV], ["recommendation", "maybe"], ["notes", "x"]]))).toMatchObject({ error: "no_recommendation" });
    expect(parseFeedback(form([...base.slice(0, 3), ["notes", "  \r\n "]]))).toMatchObject({ error: "no_notes" });
    expect(parseFeedback(form([["interviewId", IV], ["recommendation", "yes"], ["rating", "5"], ["notes", "x"]]))).toMatchObject({ error: "bad_rating" });
    expect(parseFeedback(form([...base, ["attr", A1], ["r:" + A1, "1.5"]]))).toMatchObject({ error: "bad_rating" });
    expect(parseFeedback(form([...base.slice(0, 3), ["notes", "x".repeat(FEEDBACK_NOTES_MAX + 1)]]))).toMatchObject({ error: "too_long" });
    expect(parseFeedback(form([...base, ["attr", A1], ["r:" + A1, "3"], ["rn:" + A1, "x".repeat(RATING_NOTE_MAX + 1)]]))).toMatchObject({ error: "too_long" });
  });

  test("CRLF reads as one character and a NUL is dropped", () => {
    const p = parseFeedback(form([...base.slice(0, 3), ["notes", `a\r\nb\0c${"x".repeat(FEEDBACK_NOTES_MAX - 4)}`]]));
    expect(p.ok && p.input.notes.startsWith("a\nbc")).toBe(true);
  });
});

// The limits and sentences are core's: these run its own checks, which refuse before any read.
describe("against core's submitFeedback", () => {
  const ctx = { actorId: "a1", orgId: "o1", accessLevel: "limited", source: "dashboard" } as const;
  const refusal = async (input: Parameters<typeof clientTools.submitFeedback>[2]) => {
    try {
      await clientTools.submitFeedback(null as never, ctx, input);
    } catch (err) {
      if (err instanceof clientTools.ClientToolError) return feedbackRefusal(err.code, err.message);
      return "reached the database";
    }
  };
  const ok = { interviewId: IV, recommendation: "yes" as const, notes: "x" };

  test("each of its refusals maps to the form's code", async () => {
    expect(await refusal({ ...ok, notes: " " })).toBe("no_notes");
    expect(await refusal({ ...ok, rating: 5 })).toBe("bad_rating");
    expect(await refusal({ ...ok, ratings: [{ attributeId: A1, rating: 0 }] })).toBe("bad_rating");
    expect(await refusal({ ...ok, notes: "x".repeat(FEEDBACK_NOTES_MAX + 1) })).toBe("too_long");
    expect(await refusal({ ...ok, ratings: [{ attributeId: A1, rating: 2, note: "x".repeat(RATING_NOTE_MAX + 1) }] })).toBe("too_long");
  });

  test("the form's limits are core's, not lower", async () => {
    expect(await refusal({ ...ok, notes: "x".repeat(FEEDBACK_NOTES_MAX), ratings: [{ attributeId: A1, rating: 2, note: "x".repeat(RATING_NOTE_MAX) }] })).toBe("reached the database");
  });

  test("the reads' sentences", () => {
    expect(feedbackRefusal("forbidden", "You were not an interviewer on that interview")).toBe("not_interviewer");
    expect(feedbackRefusal("invalid", "That interview was cancelled. Nothing was saved.")).toBe("cancelled");
    expect(feedbackRefusal("invalid", "That interview has not happened yet. Nothing was saved.")).toBe("not_yet");
    expect(feedbackRefusal("not_found", "Every rating must be for an attribute on this job's scorecard.")).toBe("scorecard_changed");
    expect(feedbackRefusal("invalid", `"Depth" was taken off this job's scorecard.`)).toBe("scorecard_changed");
    expect(feedbackRefusal("rate_limited", "You have made 300 changes")).toBe("rate_limited");
    expect(feedbackRefusal("invalid", "Something new")).toBe("failed");
  });
});

describe("canFile", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  test("only your own, started, not cancelled", () => {
    expect(canFile({ mine: true, status: "scheduled", startsAt: "2026-11-01T11:00:00Z" }, now)).toBe(true);
    expect(canFile({ mine: true, status: "completed", startsAt: "2026-10-01T11:00:00Z" }, now)).toBe(true);
    expect(canFile({ mine: false, status: "completed", startsAt: "2026-10-01T11:00:00Z" }, now)).toBe(false);
    expect(canFile({ mine: true, status: "cancelled", startsAt: "2026-10-01T11:00:00Z" }, now)).toBe(false);
    expect(canFile({ mine: true, status: "scheduled", startsAt: "2026-11-01T13:00:00Z" }, now)).toBe(false);
  });
});
