import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";

import { activityLine } from "./candidate-activity";

const entry = (e: Partial<clientTools.ActivityEntry> & Pick<clientTools.ActivityEntry, "kind">): clientTools.ActivityEntry => ({
  at: "2026-10-29T12:00:00Z",
  actor: null,
  applicationId: null,
  jobTitle: null,
  fromStage: null,
  toStage: null,
  source: null,
  people: [],
  text: null,
  startsAt: null,
  refId: null,
  ...e,
});

describe("the candidate page's activity lines", () => {
  test("pipeline moves name the stages and the job", () => {
    expect(activityLine(entry({ kind: "application.added", toStage: "sourced", jobTitle: "Engineer", text: "Tacit · Kim" }))).toEqual({
      what: "added them for Engineer at Sourced",
      body: "Tacit · Kim",
    });
    expect(activityLine(entry({ kind: "application.stage_changed", fromStage: "screening", toStage: "withdrawn", jobTitle: "Engineer" })).what).toBe(
      "moved them from Screening to Withdrew for Engineer",
    );
    expect(activityLine(entry({ kind: "application.owner_changed", people: ["Lee"] })).what).toBe("made Lee the owner");
    expect(activityLine(entry({ kind: "application.owner_changed" })).what).toBe("cleared the owner");
  });

  test("written text is the body, never part of the sentence", () => {
    expect(activityLine(entry({ kind: "note", text: "<b>strong</b> systems" }))).toEqual({ what: "left a note", body: "<b>strong</b> systems" });
    expect(activityLine(entry({ kind: "email", text: "Next steps" }))).toEqual({ what: "emailed them", body: "Next steps" });
    expect(activityLine(entry({ kind: "tag.added", text: "referral" }))).toEqual({ what: "tagged them", body: "referral" });
  });

  test("interviews name their step and interviewers", () => {
    expect(activityLine(entry({ kind: "interview.scheduled", text: "Onsite", people: ["Ada", "Lee"], jobTitle: "Engineer" }))).toEqual({
      what: "scheduled the Onsite interview for Engineer",
      body: "With Ada, Lee",
    });
    expect(activityLine(entry({ kind: "interview.cancelled" })).what).toBe("cancelled an interview");
  });

  test("offers say only what happened, never the terms", () => {
    expect(activityLine(entry({ kind: "offer.extended", jobTitle: "Engineer" }))).toEqual({ what: "extended an offer for Engineer", body: null });
    expect(activityLine(entry({ kind: "approval.rejected", text: "Over band" }))).toEqual({ what: "turned down the offer's approval", body: "Over band" });
  });
});
