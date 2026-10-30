import { describe, expect, test } from "vitest";

import { nextStage } from "./candidate-edit-rules";
import { columnOf, NO_DROP, PIPELINE_COLUMNS, type ColumnKey, type InterviewTimes } from "./pipeline-columns";
import { movesFor, parseBoardMove } from "./pipeline-moves";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
const iv = (startH: number, status = "scheduled"): InterviewTimes => ({ startsAt: at(startH), endsAt: at(startH + 1), status });

const APP = "11111111-1111-4111-8111-111111111111";
const fields = (o: Record<string, string>) => new Map(Object.entries(o));
const stagesOf = (stage: string, ivs: InterviewTimes[] = []) => movesFor(stage, ivs, NOW).stages.map((m) => m.stage);

describe("the moves a board card offers", () => {
  test("the menu is every other plain stage, never a close and never where it already is", () => {
    expect(stagesOf("screening")).toEqual(["sourced", "contacted", "interviewing", "offer", "hired"]);
    expect(stagesOf("sourced")).toEqual(["contacted", "screening", "interviewing", "offer", "hired"]);
    for (const stage of ["sourced", "contacted", "screening", "interviewing", "offer"]) {
      const s = stagesOf(stage);
      expect(s).not.toContain(stage);
      expect(s).not.toContain("rejected");
      expect(s).not.toContain("withdrawn");
    }
  });

  test("a card already in Scheduling, Interview booked or Your call is not offered interviewing again", () => {
    expect(stagesOf("interviewing")).not.toContain("interviewing");
    expect(stagesOf("interviewing", [iv(24)])).not.toContain("interviewing");
    expect(stagesOf("interviewing", [iv(-24, "done")])).not.toContain("interviewing");
  });

  test("every drop is a real stage change that lands the card in that very column", () => {
    const shapes: [string, InterviewTimes[]][] = [];
    for (const stage of ["sourced", "contacted", "screening", "interviewing", "offer"]) {
      for (const ivs of [[], [iv(24)], [iv(-24)], [iv(-24, "done"), iv(24)], [iv(24, "cancelled")]]) shapes.push([stage, ivs]);
    }
    for (const [stage, ivs] of shapes) {
      const from = columnOf(stage, ivs, NOW);
      for (const [column, to] of Object.entries(movesFor(stage, ivs, NOW).drops)) {
        expect(to, `${stage} on ${column}`).not.toBe(stage);
        expect(column, `${stage} on ${column}`).not.toBe(from);
        expect(columnOf(to, ivs, NOW), `${stage} on ${column}`).toBe(column);
      }
    }
  });

  test("the three interviewing columns take one drop between them, the one the card's interviews say", () => {
    const interviewingDrops = (ivs: InterviewTimes[]) => {
      const { drops } = movesFor("screening", ivs, NOW);
      return (["scheduling", "booked", "decide"] as ColumnKey[]).filter((c) => drops[c]);
    };
    expect(interviewingDrops([])).toEqual(["scheduling"]);
    expect(interviewingDrops([iv(24)])).toEqual(["booked"]);
    expect(interviewingDrops([iv(-24)])).toEqual(["decide"]);
    expect(interviewingDrops([iv(24, "cancelled")])).toEqual(["scheduling"]);
  });

  test("moving between the interviewing columns is not a stage change, so it is not offered", () => {
    expect(movesFor("interviewing", [], NOW).drops).toEqual({ new: "contacted", screening: "screening", offer: "offer" });
    expect(movesFor("interviewing", [iv(24)], NOW).drops).toEqual({ new: "contacted", screening: "screening", offer: "offer" });
    expect(movesFor("interviewing", [iv(-24)], NOW).drops).toEqual({ new: "contacted", screening: "screening", offer: "offer" });
  });

  test("a drop on New means contacted, and a card already in New has no drop there", () => {
    expect(movesFor("offer", [], NOW).drops.new).toBe("contacted");
    expect(movesFor("screening", [], NOW).drops.new).toBe("contacted");
    expect(movesFor("sourced", [], NOW).drops.new).toBeUndefined();
    expect(movesFor("contacted", [], NOW).drops.new).toBeUndefined();
  });

  test("inside New, sourced to contacted is still a stage change, by the menu and A", () => {
    const m = movesFor("sourced", [], NOW);
    expect(m.next).toBe("contacted");
    expect(m.stages.find((s) => s.stage === "contacted")?.column).toBe("new");
    expect(movesFor("contacted", [], NOW).stages.find((s) => s.stage === "sourced")?.column).toBe("new");
  });

  test("hired has no column, so it is never a drop", () => {
    for (const stage of ["sourced", "screening", "interviewing", "offer"]) {
      expect(Object.values(movesFor(stage, [], NOW).drops)).not.toContain("hired");
    }
    expect(movesFor("offer", [], NOW).stages.find((s) => s.stage === "hired")).toEqual({ stage: "hired", label: "Hired", column: null });
  });

  test("A is the candidate page's next stage, except hired, which takes the menu", () => {
    expect(movesFor("sourced", [], NOW).next).toBe(nextStage("sourced"));
    expect(movesFor("screening", [], NOW).next).toBe("interviewing");
    expect(movesFor("interviewing", [], NOW).next).toBe("offer");
    expect(nextStage("offer")).toBe("hired");
    expect(movesFor("offer", [], NOW).next).toBeNull();
  });

  test("every column with no stage behind it has a sentence for a drop there", () => {
    const fromStage = new Set(["sourced", "contacted", "screening", "offer"].map((s) => columnOf(s, [], NOW)));
    for (const { key } of PIPELINE_COLUMNS) {
      if (!fromStage.has(key) && key !== "scheduling") expect(NO_DROP[key], key).toBeTruthy();
    }
    expect(NO_DROP.scheduling).toBeTruthy();
  });
});

describe("a move posted from the board", () => {
  test("reads the application, the stage and the stage the board showed", () => {
    expect(parseBoardMove(fields({ applicationId: APP, stage: "offer", expectedStage: "interviewing" }))).toEqual({
      applicationId: APP,
      stage: "offer",
      expectedStage: "interviewing",
      reasonId: null,
      note: null,
    });
  });

  test("refuses a close, which needs the candidate page's reason", () => {
    expect(parseBoardMove(fields({ applicationId: APP, stage: "rejected", expectedStage: "screening" }))).toBeNull();
    expect(parseBoardMove(fields({ applicationId: APP, stage: "withdrawn", expectedStage: "screening" }))).toBeNull();
  });

  test("refuses anything the board never sends", () => {
    expect(parseBoardMove(fields({ applicationId: "nope", stage: "offer", expectedStage: "screening" }))).toBeNull();
    expect(parseBoardMove(fields({ applicationId: APP, stage: "booked", expectedStage: "screening" }))).toBeNull();
    expect(parseBoardMove(fields({ applicationId: APP, stage: "offer", expectedStage: "decide" }))).toBeNull();
    expect(parseBoardMove(fields({ applicationId: APP, stage: "offer" }))).toBeNull();
  });
});
