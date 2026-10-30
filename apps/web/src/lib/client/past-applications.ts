// A candidate's past applications (design/tats's "Past applications" block and
// its "Applied before" label), worked out from what is recorded: an
// application counts as past once it closed (rejected, withdrawn or hired)
// before another of theirs began, so two jobs running side by side are not
// "applied before". An application is one per person and job, so coming back
// to the same job reopens it and leaves no past record here. Pure.

const CLOSED: readonly string[] = ["rejected", "withdrawn", "hired"];
/** The way to hired, for how far they got. */
const ORDER: readonly string[] = ["sourced", "contacted", "screening", "interviewing", "offer"];

export const isClosedStage = (stage: string) => CLOSED.includes(stage);

export type PastInput = {
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  rejectionReason: string | null;
  createdAt: string;
  lastTouchAt: string;
};

/** A row of application_events at kind `stage_changed`. */
export type StageEvent = { applicationId: string; fromStage: string | null; toStage: string | null; at: string };

export type PastApplication = {
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  /** The stage it closed at, which is its outcome. */
  stage: string;
  rejectionReason: string | null;
  appliedAt: string;
  /** Null when no event recorded the close. */
  closedAt: string | null;
  /** The furthest stage the events show; null when they show none, or for a hire. */
  reached: string | null;
};

function furthest(events: StageEvent[]): string | null {
  let best = -1;
  for (const e of events) for (const s of [e.fromStage, e.toStage]) best = Math.max(best, s ? ORDER.indexOf(s) : -1);
  return best === -1 ? null : ORDER[best]!;
}

/** Newest close first. Everyone's applications here are the ones the member can read. */
export function pastApplications(apps: readonly PastInput[], events: readonly StageEvent[]): PastApplication[] {
  const past: { p: PastApplication; by: number }[] = [];
  for (const a of apps) {
    if (!isClosedStage(a.stage)) continue;
    const own = events.filter((e) => e.applicationId === a.applicationId);
    const closes = own.filter((e) => e.toStage === a.stage).map((e) => e.at).sort((x, y) => Date.parse(y) - Date.parse(x));
    const closedAt = closes[0] ?? null;
    // With no close on record the last touch stands in: it came at or after the close, so this cannot claim too much.
    const by = Date.parse(closedAt ?? a.lastTouchAt);
    if (!apps.some((o) => o.applicationId !== a.applicationId && Date.parse(o.createdAt) > by)) continue;
    past.push({
      by,
      p: {
        applicationId: a.applicationId,
        jobId: a.jobId,
        jobTitle: a.jobTitle,
        stage: a.stage,
        rejectionReason: a.rejectionReason,
        appliedAt: a.createdAt,
        closedAt,
        reached: a.stage === "hired" ? null : furthest(own),
      },
    });
  }
  return past.sort((x, y) => y.by - x.by).map(({ p }) => p);
}
