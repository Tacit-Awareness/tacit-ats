import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { Chip, Chips, Empty, KeyValues, Pill, StatusGlyph, textLink } from "@/components/page";
import { FEED_MAX } from "@/lib/client/candidate";
import { MOVABLE_STAGES } from "@/lib/client/candidate-edit-rules";
import { stageLabel } from "@/lib/client/crm-views";
import { approvalLine, offerBoard, offerStatusWord, offerTermLines, type Offer } from "@/lib/client/offer-rules";
import { ago } from "@/lib/client/pipeline-columns";
import { cn } from "@/lib/utils";
import { LoopRow } from "../../interviews/loop-row";
import { Feedback, Loop, type FeedbackCard, type LoopProps } from "../../interviews/view";
import { ActivityStory } from "../activity-story";
import { LocalDay } from "../local-day";
import { CandidateCommands } from "./commands";
import { CandidateLabels } from "./controls";
import { CLOSED, CandidateRail, Facts, due, sourceParts, stageGlyph } from "./parts";
import type { CandidateViewProps } from "./view";

// A candidate as the pop-ups over Applicant Tickets and the Inbox show them: a
// profile to read at a glance, laid out like Interview Judgement's reader. The
// pop-up's head names them, so the card doesn't again: it opens on the job in
// Mona Sans (when they are in one) and their facts; then each job they are in
// with its facts (the next action and when it's due, why it closed; the owner
// and the source too when the side card isn't saying them) and the way through
// its stages as a row of steps, where they are now raised off the well, as the
// interview loop draws its rounds; for the job the pop-up was opened from, that
// interview loop and the reads filed on it; the offer, the past applications,
// the profile and the activity, folded after the latest few. Beside it the side
// card of facts the page has (application, contact, files that open), which is
// where the stage, owner and source read, so no part above says them twice;
// their one job is the card's head, so the side card leaves out its role and
// the activity doesn't name it on every line. Under an Inbox ticket that states
// a job's next action (`nextInCall`), that job's Next line isn't said again.
// Nothing here changes anything: the full page (Open as a page) keeps every
// control.

/** The interview loop and the reads for the application a pop-up was opened from (pipeline/page.tsx reads them). */
export type CandidateJourney = { applicationId: string; loop: LoopProps; feedback: FeedbackCard[]; feedbackNote: string | null };

type App = clientTools.CandidateDetail["applications"][number];

/** A part of the card, set off from the one above by a hairline, as the Interviews reader's parts. */
const PART = "grid gap-3 border-t border-[color:var(--line)] px-4 pt-4 pb-5 first:border-t-0 @2xl:px-6";
const HEAD = "m-0 flex min-h-[30px] items-center gap-2 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]";
const COUNT = "font-mono text-[12.5px] font-normal tracking-normal text-faint tabular-nums";
/** The activity shows this many of the latest, the rest folded under "Show all": a long story stays calm until it's wanted. */
const ACTIVITY_FOLD = 5;

type Step = { stage: string; state: "done" | "now" | "later" | "closed"; at: string | null };

/**
 * An application's way through the stages, from what the activity records: each
 * stage it passed (with the day it got there, where the record has it), the one
 * it is at, and those still ahead. A closed one shows the stages up to where it
 * closed, then the close.
 */
function stepsOf(a: App, activity: clientTools.ActivityEntry[]): Step[] {
  const moves = activity.filter((e) => e.applicationId === a.applicationId && (e.kind === "application.added" || e.kind === "application.stage_changed") && e.toStage);
  // The feed runs newest first, so the first move into a stage is the latest.
  const into = (stage: string) => moves.find((e) => e.toStage === stage)?.at ?? null;
  if (CLOSED.has(a.stage)) {
    const close = moves.find((e) => e.toStage === a.stage) ?? null;
    const reached = close?.fromStage ? MOVABLE_STAGES.indexOf(close.fromStage as (typeof MOVABLE_STAGES)[number]) : -1;
    return [...MOVABLE_STAGES.slice(0, reached + 1).map((stage): Step => ({ stage, state: "done", at: into(stage) })), { stage: a.stage, state: "closed", at: close?.at ?? null }];
  }
  const at = MOVABLE_STAGES.indexOf(a.stage as (typeof MOVABLE_STAGES)[number]);
  return MOVABLE_STAGES.map((stage, i): Step => ({ stage, state: i < at ? "done" : i === at ? "now" : "later", at: i <= at ? into(stage) : null }));
}

const STEP_LOOK: Record<Step["state"], string> = {
  done: "border-[color:var(--line-strong)]",
  now: "border-transparent bg-[color:var(--raised)] shadow-[var(--shadow)]",
  closed: "border-transparent bg-[color:var(--raised)] shadow-[var(--shadow)]",
  later: "border-dashed border-[color:var(--line-strong)] text-muted-foreground",
};

/** Before a step: a quiet chevron in the gap, as the loop's. */
function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="absolute top-1/2 -left-[16px] size-3.5 -translate-y-1/2 text-[color:var(--ink-4)]">
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  );
}

/**
 * A step as the loop's round card: the stage, then where it stands on one line,
 * its square, a word and the day. The day is a date ("Nov 11"), never a word
 * like "yesterday", so the line fits six steps across at 1280 and reads alike
 * on every step. The step they are at, raised off the well, says only since
 * when, in the accent: its card is the "now".
 */
function StepCard({ step, now }: { step: Step; now: number }) {
  const hired = step.stage === "hired" && step.state === "now";
  const here = step.state === "now" && !hired;
  const day = step.at ? <LocalDay iso={step.at} fallback={ago(step.at, now)} dated /> : null;
  const said = hired
    ? { glyph: <StatusGlyph kind="done" className="size-3" />, word: "Hired" }
    : step.state === "done"
      ? { glyph: <StatusGlyph kind="done" className="size-3" />, word: "Done" }
      : step.state === "closed"
        ? { glyph: <StatusGlyph kind={step.stage === "rejected" ? "closed" : "lapsed"} className="size-3" />, word: "Closed" }
        : step.state === "later"
          ? { glyph: <StatusGlyph kind="empty" className="size-3" />, word: "Not yet" }
          : null;
  return (
    // 8px sides (a little under the loop's cards) give "Done Nov 11" its one line in a sixth of the well at 1280.
    <div className={cn("grid min-w-0 flex-1 content-start gap-1.5 rounded-[10px] border px-2 py-2.5", STEP_LOOK[step.state])}>
      {/* A stage is one word, so it never breaks inside one: 12.5px lets "Interviewing" fit six steps across. */}
      <b className="min-w-0 text-[12.5px] leading-5 font-medium whitespace-nowrap">{stageLabel(step.stage)}</b>
      {/* Nothing breaks inside a piece; only a "Closed" or "Hired" with its day may put the day under it in a narrow well. */}
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4">
        {here ? <em className="font-medium whitespace-nowrap text-[color:var(--accent)] not-italic">{day ? <>Since {day}</> : "Now"}</em> : null}
        {said ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-faint">
            {said.glyph}
            {said.word}
          </span>
        ) : null}
        {day && !here ? <span className="whitespace-nowrap text-faint">{day}</span> : null}
      </span>
    </div>
  );
}

/**
 * One job: its title and tags, its facts, and its steps in the loop's well.
 * Their one job (`titled` false) is the head's and the side card's: that card
 * says its stage, owner and source, so this part keeps to what it alone has.
 * `nextSaid`: the ticket over the card already states this job's next action
 * and how late it is, so the Next line isn't said again under it.
 */
function JobPart({ a, owner, activity, now, titled, nextSaid }: { a: App; owner: string | null; activity: clientTools.ActivityEntry[]; now: number; titled: boolean; nextSaid: boolean }) {
  const steps = stepsOf(a, activity);
  const current = steps.find((s) => s.state === "now" || s.state === "closed");
  const next = a.nextAction && !nextSaid ? { text: a.nextAction, due: a.nextActionDue ? due(a.nextActionDue, now) : null } : null;
  const facts = titled
    ? [
        ...sourceParts(a.source, a.sourceDetail),
        owner ? (
          <>
            Owner <span className="text-muted-foreground">{owner}</span>
          </>
        ) : (
          "No owner"
        ),
      ]
    : [];
  return (
    <section aria-label={a.jobTitle ?? "Untitled job"} className={PART}>
      {titled ? (
        <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className={HEAD}>
            <Link href={`/client/jobs/${a.jobId}`} className="underline-offset-[3px] hover:underline [overflow-wrap:anywhere]">
              {a.jobTitle ?? "Untitled job"}
            </Link>
          </h2>
          <span className="flex flex-none items-center gap-2">
            {a.offer ? <Pill>Offer {a.offer.status}</Pill> : null}
            <Pill tone={a.stage === "hired" ? "green" : "grey"}>{stageLabel(a.stage)}</Pill>
          </span>
        </div>
      ) : null}
      <div className="grid gap-1">
        <Facts items={[...facts, `Touched ${ago(a.lastTouchAt, now)}`]} />
        {next ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px]">
            <span className="text-faint">Next:</span>
            <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{next.text}</span>
            {next.due ? <span className={next.due.late ? "text-negative" : "text-faint"}>{next.due.text}</span> : null}
          </span>
        ) : null}
        {a.rejectionReason ? (
          <span className="text-[12.5px] text-faint">
            Reason: <span className="text-muted-foreground">{a.rejectionReason}</span>
          </span>
        ) : null}
        {/* Someone's words on the close: prose, on a line of its own rather than in the facts' voice. */}
        {a.rejectionNote ? <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-muted-foreground">{a.rejectionNote}</p> : null}
      </div>
      <LoopRow current={current?.stage ?? null} label="Stages, in order">
        {steps.map((s, i) => (
          <li key={s.stage} aria-current={s === current ? "step" : undefined} className={cn("relative flex max-w-[300px] min-w-[104px] flex-[1_1_0] items-stretch", i > 0 && "ml-[18px]")}>
            {i > 0 ? <Arrow /> : null}
            <StepCard step={s} now={now} />
          </li>
        ))}
      </LoopRow>
    </section>
  );
}

/** An offer to read: its status, who drafted it, its terms, notes and where approval stands; earlier ones as a line each. */
function OfferPart({ apps, offers, many }: { apps: App[]; offers: Record<string, Offer[]>; many: boolean }) {
  return (
    <section aria-label="Offers" className={PART}>
      <h2 className={HEAD}>Offer</h2>
      {apps.map((a) => {
        const { open, closed } = offerBoard(a.stage, offers[a.applicationId] ?? []);
        const line = open ? approvalLine(open) : null;
        return (
          <div key={a.applicationId} className="grid gap-3">
            {many ? <span className="text-[12.5px] text-muted-foreground">{a.jobTitle ?? "Untitled job"}</span> : null}
            {open ? (
              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <Pill tone={open.status === "extended" ? "green" : "grey"}>{offerStatusWord(open.status)}</Pill>
                  {open.createdBy ? <span className="truncate text-[12.5px] text-faint">by {open.createdBy}</span> : null}
                </div>
                {offerTermLines(open).length ? (
                  <KeyValues className="grid-cols-[96px_minmax(0,1fr)] gap-y-2" items={offerTermLines(open).map((l) => [l.label, <span className="min-w-0 break-words">{l.value}</span>])} />
                ) : (
                  <Empty className="m-0">No terms on this offer yet.</Empty>
                )}
                {open.notes ? <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-foreground/85">{open.notes}</p> : null}
                {line ? <p className="m-0 text-[12.5px] text-muted-foreground">{line}</p> : null}
              </div>
            ) : null}
            {closed.map((o) => (
              <div key={o.offerId} className="flex min-w-0 items-center gap-2.5 text-[13px] text-muted-foreground" title={offerTermLines(o).map((l) => `${l.label}: ${l.value}`).join("\n") || undefined}>
                <Pill tone={o.status === "accepted" ? "green" : "grey"}>{offerStatusWord(o.status)}</Pill>
                <span className="truncate">{offerTermLines(o)[0]?.value ?? "No terms"}</span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

export function CandidateDashboard({
  candidate,
  activity,
  owners,
  past,
  labels = null,
  offers = {},
  now,
  call = null,
  journey = null,
  nextInCall = null,
}: CandidateViewProps & { call?: React.ReactNode; journey?: CandidateJourney | null; nextInCall?: string | null }) {
  const name = candidate.name?.trim() || "Unnamed";
  const pastIds = new Set(past.map((p) => p.applicationId));
  const current = candidate.applications.filter((a) => !pastIds.has(a.applicationId));
  const sole = candidate.full && current.length === 1 ? current[0]! : null;
  const offerApps = current.filter((a) => (offers[a.applicationId] ?? []).length > 0);
  const tags = candidate.tags.length > 0 || past.length > 0 || current.length > 1;
  const headed = !!sole || !!candidate.headline || !!candidate.location || tags || !!labels?.length;

  return (
    <div className="grid content-start items-start gap-5 bg-[color:var(--surface)] px-[var(--page-gutter)] pt-4 pb-12 min-[1100px]:grid-cols-[minmax(0,1fr)_320px]">
      {/* ⌘K still knows who this is; it offers nothing to change here. */}
      <CandidateCommands name={name} note={false} labels={false} stage={false} close={false} />
      <div className="grid min-w-0 content-start gap-5">
        {call}
        <article aria-label={name} className="@container grid min-w-0 content-start overflow-hidden rounded-[14px] bg-card text-[13px] shadow-[var(--shadow)]">
          {/* The Interviews reader's head under a pop-up head that already names them: the job in Mona Sans (its stage is the side card's and the steps'), their facts under in one voice, then the chips. */}
          {headed ? (
            <header className={cn(PART, "gap-2 pt-5")}>
              {sole ? (
                <h2 className="m-0 min-w-0 font-sans text-[20px] leading-[28px] font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]">
                  <Link href={`/client/jobs/${sole.jobId}`} className="underline-offset-4 transition-colors hover:underline">
                    {sole.jobTitle ?? "Untitled job"}
                  </Link>
                </h2>
              ) : null}
              <Facts className="text-[13px] text-muted-foreground" items={[candidate.headline, candidate.location]} />
              {tags || labels?.length ? (
                <Chips aria-label="Stage and tags" className="mt-1">
                  {current.length > 1
                    ? current.map((a) => (
                        <Chip key={a.applicationId} title={a.jobTitle ?? undefined}>
                          {stageGlyph(a.stage)}
                          <span className="text-foreground">{stageLabel(a.stage)}</span>
                          <span className="max-w-[160px] truncate text-faint">{a.jobTitle ?? "Untitled job"}</span>
                        </Chip>
                      ))
                    : null}
                  {past.length ? (
                    <Chip title="They applied here before: their past applications are below">
                      <StatusGlyph kind="lapsed" className="size-3" />
                      Applied before
                    </Chip>
                  ) : null}
                  <CandidateLabels candidateId={candidate.candidateId} labels={candidate.tags} choices={null} />
                </Chips>
              ) : null}
            </header>
          ) : null}

          {candidate.full ? (
            current.length ? (
              current.map((a) => (
                <JobAndLoop
                  key={a.applicationId}
                  a={a}
                  owner={owners[a.applicationId] ?? null}
                  activity={activity}
                  journey={journey}
                  name={name}
                  now={now}
                  titled={!sole}
                  nextSaid={nextInCall === a.applicationId}
                />
              ))
            ) : (
              <div className={PART}>
                <Empty className="m-0">{candidate.prospect ? "A prospect: in no job yet." : "In no job you can see."}</Empty>
              </div>
            )
          ) : (
            <div className={PART}>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                You&apos;re interviewing {name}. What you see here is your own interviews and notes; the rest of their record is the hiring team&apos;s. Your
                interviews are on your{" "}
                <Link href="/client" className={textLink}>
                  home page
                </Link>
                .
              </p>
            </div>
          )}

          {offerApps.length ? <OfferPart apps={offerApps} offers={offers} many={offerApps.length > 1} /> : null}

          {past.length ? (
            <section aria-label="Past applications" className={PART}>
              <h2 className={HEAD}>
                Past applications <span className={COUNT}>{past.length}</span>
              </h2>
              <div className="grid">
                {past.map((p) => (
                  <Link
                    key={p.applicationId}
                    href={`/client/jobs/${p.jobId}`}
                    className="-mx-2 grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-[color:var(--surface)]"
                  >
                    <span className="pt-[3px]">{stageGlyph(p.stage)}</span>
                    <span className="grid min-w-0 gap-1">
                      <b className="font-medium [overflow-wrap:anywhere]">{p.jobTitle ?? "Untitled job"}</b>
                      <Facts
                        items={[
                          <>
                            <LocalDay iso={p.appliedAt} fallback={ago(p.appliedAt, now)} />
                            {p.closedAt ? (
                              <>
                                {" to "}
                                <LocalDay iso={p.closedAt} fallback={ago(p.closedAt, now)} />
                              </>
                            ) : null}
                          </>,
                          p.reached ? `Got to ${stageLabel(p.reached).toLowerCase()}` : null,
                          p.rejectionReason ? (
                            <>
                              Reason: <span className="text-muted-foreground">{p.rejectionReason}</span>
                            </>
                          ) : null,
                        ]}
                      />
                    </span>
                    <Pill tone={p.stage === "hired" ? "green" : "grey"}>{stageLabel(p.stage)}</Pill>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {candidate.summary ? (
            <section aria-label="Profile" className={PART}>
              <h2 className={HEAD}>Profile</h2>
              <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-foreground/85">{candidate.summary}</p>
            </section>
          ) : null}

          <section aria-label="Activity" className={PART}>
            <h2 className={HEAD}>
              Activity{" "}
              <span className={COUNT} title={activity.length >= FEED_MAX ? `The latest ${FEED_MAX}; older activity isn't shown here` : undefined}>
                {activity.length}
              </span>
            </h2>
            <ActivityStory entries={activity} now={now} fold={ACTIVITY_FOLD} about={sole?.applicationId ?? null} />
          </section>
        </article>
      </div>
      <CandidateRail candidate={candidate} sole={sole} owners={owners} now={now} named />
    </div>
  );
}

/** A job's part, and for the job the pop-up was opened from, its interview loop and the reads under it. */
function JobAndLoop({
  a,
  owner,
  activity,
  journey,
  name,
  now,
  titled,
  nextSaid,
}: {
  a: App;
  owner: string | null;
  activity: clientTools.ActivityEntry[];
  journey: CandidateJourney | null;
  name: string;
  now: number;
  titled: boolean;
  nextSaid: boolean;
}) {
  const mine = journey && journey.applicationId === a.applicationId ? journey : null;
  return (
    <>
      <JobPart a={a} owner={owner} activity={activity} now={now} titled={titled} nextSaid={nextSaid} />
      {mine ? (
        <>
          <div className="border-t border-[color:var(--line)]">
            <Loop reader={mine.loop} />
          </div>
          {/* No round held and nothing to say about it: no Feedback part to read nothing in. */}
          {mine.feedback.length || mine.feedbackNote ? (
            <div className="border-t border-[color:var(--line)]">
              <Feedback reader={{ candidate: name, feedback: mine.feedback, feedbackNote: mine.feedbackNote }} />
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
