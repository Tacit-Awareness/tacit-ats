import type { ApplicationChoice } from "./schedule-choices";

// "Next round", design/tats's A on the team's call, as one move: the Inbox's
// button opens the Calendar's Find a time with the candidate, their job and
// the round after the last one already filled in (`?book=`), instead of
// leaving the member to go find them. Pure and type-only: the Calendar's
// dialog is a client component. The round itself is core's getInterviewPlan
// (`nextStep`), read by schedule-choices.ts's readNextRound on the page.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the Calendar opens on: whose next round, and the plan's next step when there is one. */
export type NextRound = { applicationId: string; step: string | null };

/** Where Next round goes. Only the application's id: the step is read again on the Calendar, on the member's own token. */
export const nextRoundHref = (applicationId: string) => `/client/schedule?book=${encodeURIComponent(applicationId)}`;

/** The `?book=`, or null for anything that is not an id. */
export function parseBook(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? "";
  return UUID.test(v) ? v.toLowerCase() : null;
}

/** The Calendar's address without `?book=`, so a reload or Back doesn't open the dialog again. */
export function withoutBook(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("book");
  const rest = params.toString();
  return `/client/schedule${rest ? `?${rest}` : ""}`;
}

export type Prefill = {
  /** The candidate picked, or null when they aren't someone the member can book for (`missing`). */
  applicationId: string | null;
  /** The step picked: the next round when the job's plan has it, else empty for the member to choose. */
  step: string;
  /** Asked for someone the dialog's choices don't have: closed, on a job they don't schedule for, or past the read's cap. */
  missing: boolean;
};

export const NO_PREFILL: Prefill = { applicationId: null, step: "", missing: false };

/**
 * The Book form's starting point for a next round, once its choices are read.
 * A step is kept only when the job's plan still names it, as the form's select
 * would, or when the job has no plan and any name goes.
 */
export function prefill(choices: readonly ApplicationChoice[], want: NextRound | null | undefined): Prefill {
  if (!want) return NO_PREFILL;
  const app = choices.find((a) => a.applicationId === want.applicationId);
  if (!app) return { ...NO_PREFILL, missing: true };
  const step = want.step && (!app.steps.length || app.steps.includes(want.step)) ? want.step : "";
  return { applicationId: app.applicationId, step, missing: false };
}
