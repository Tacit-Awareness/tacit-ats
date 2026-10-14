import type { PipelineBoardActions } from "@/components/pipeline-board";
import { logTouchAction, moveStageAction, removeFromPipelineAction, updateCardAction } from "./actions";

/** The client board's writes, as the member signed in. */
export const CLIENT_PIPELINE_ACTIONS: PipelineBoardActions = {
  move: moveStageAction,
  update: updateCardAction,
  logTouch: logTouchAction,
  remove: removeFromPipelineAction,
};
