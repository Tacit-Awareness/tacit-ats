import type { ApplicationStage } from "@tacit/core";
import { MOVABLE_STAGES, nextStage, parseMove, type MoveInput } from "./candidate-edit-rules";
import { stageLabel } from "./crm-views";
import { columnOf, type ColumnKey, type InterviewTimes } from "./pipeline-columns";

// Which moves the Pipeline board offers a card, pure. A column is computed, so
// it is not a stage: three columns are all `interviewing`, and two stages are
// New. Every move here is a real stage change the candidate page would make
// too (its MOVABLE_STAGES and nextStage), and a column only takes a drop when
// that stage, with this card's interviews, lands the card in that column.

export type StageMove = { stage: ApplicationStage; label: string; column: ColumnKey | null };

export type CardMoves = {
  /** The S menu: every other stage a plain move may go to. */
  stages: StageMove[];
  /** A: the next stage, unless that is hired, which is picked from the menu on purpose. */
  next: ApplicationStage | null;
  /** The columns a drop means something on, and the stage each one means. */
  drops: Partial<Record<ColumnKey, ApplicationStage>>;
};

/**
 * What a card at `stage` may do. A drop on New means `contacted`, the later of
 * its two stages: anyone already past it has been contacted. Inside New a card
 * has only the menu and A, since a drop on its own column moves nothing.
 */
export function movesFor(stage: string, interviews: InterviewTimes[], now: number): CardMoves {
  const stages = MOVABLE_STAGES.filter((s) => s !== stage).map((s) => ({ stage: s, label: stageLabel(s), column: columnOf(s, interviews, now) }));
  const from = columnOf(stage, interviews, now);
  const drops: CardMoves["drops"] = {};
  // In stage order, so a later stage takes a column an earlier one shares.
  for (const m of stages) if (m.column && m.column !== from) drops[m.column] = m.stage;
  const next = nextStage(stage);
  return { stages, next: next === "hired" ? null : next, drops };
}

/** A move posted from the board: a plain move only, since closing needs the candidate page's reason. */
export function parseBoardMove(f: { get(key: string): unknown }): MoveInput | null {
  const input = parseMove(f);
  return input && MOVABLE_STAGES.includes(input.stage) ? input : null;
}
