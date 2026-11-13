import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { FlashToast } from "@/components/flash-toast";
import { Chip, Chips, Empty, Notice, Page, PageBar, Pill, STAGE_GLYPH, Section, StatusGlyph, textLink } from "@/components/page";
import { FEED_MAX } from "@/lib/client/candidate";
import { CANDIDATE_NOTE_MAX, noteable } from "@/lib/client/candidate-edit-rules";
import type { CloseReason, LabelChoices, OwnerChoice } from "@/lib/client/candidate-edits";
import { viewerFiles } from "@/lib/client/file-view-rules";
import { stageLabel } from "@/lib/client/crm-views";
import { offerBoard, type Offer } from "@/lib/client/offer-rules";
import type { PastApplication } from "@/lib/client/past-applications";
import { ago } from "@/lib/client/pipeline-columns";

import { FileViewer } from "../../files/viewer";
import { ActivityStory } from "../activity-story";
import { LocalDay } from "../local-day";
import { CandidateCommands } from "./commands";
import { CandidateDashboard, type CandidateJourney } from "./dashboard";
import { CandidateLabels, JobControls } from "./controls";
import { FileUpload } from "./file-upload";
import { NoteComposer } from "./note-composer";
import { OfferBlock } from "./offer-block";
import { CLOSED, CandidateRail, Facts, due, sourceParts, stageGlyph } from "./parts";

// The candidate page's markup, props only (page.tsx does the reads), laid
// out like design/tats's ticket page (#t~APP-x, `.detail`) where real data
// exists, in Testbench's staff design: the bar with the crumb back to the CRM
// and their name, the page's one title (in the Pipeline's and the Inbox's
// pop-ups, the pop-up's head names them instead); then a main column on the
// box's surface (the `.t-head`: headline and location as faint facts, a chip
// per job's stage with its square, and their labels), then white cards: each
// job they are in as a ticket row, with its controls in a well under it where
// the member may edit (can_edit_pipeline, controls.tsx); the offer; the
// applications they came back after, with "Applied before" among the chips, as
// design/tats's past applications (lib/client/past-applications.ts); the
// profile; their files in design/tats's document viewer (files/viewer.tsx),
// with the upload for whoever can change their record (file-upload.tsx); the
// activity as a `.story` under the `.composer` for a note, which is above it
// because this feed runs newest first. Beside it, the `.props` rail as one card
// of facts (application, contact, files), where an email or a profile link
// wraps rather than being cut short, as people copy them. The body draws its
// own surface, so in the pop-ups the cards sit on the same grey as on the page.
// Facts stand apart on spacing, never between dots, and nobody has an avatar.
// Everything about the candidate is untrusted text and is rendered as text; a
// LinkedIn link is only a link when it is http(s). Times are relative ("3d
// ago") or a day the browser words in its own zone (LocalDay), so the server
// needs no time zone.

export type CandidateViewProps = {
  candidate: clientTools.CandidateDetail;
  activity: clientTools.ActivityEntry[];
  owners: Record<string, string | null>;
  /** Applications closed before another began, newest first. These leave the Jobs block for their own. */
  past: PastApplication[];
  /** Null when the member may edit none of this candidate's jobs. */
  editing: {
    /** The applications they may edit, with each one's owner's id. */
    apps: Record<string, { ownerActorId: string | null }>;
    owners: OwnerChoice[];
    reasons: CloseReason[];
  } | null;
  /** The labels the member may put on or take off; null when they may not change this candidate. */
  labels?: LabelChoices | null;
  /** Each application's offers, only for the jobs the member can manage: a job left out shows nothing. */
  offers?: Record<string, Offer[]>;
  /** What the upload takes (core's), when the member may add files to this candidate (can_edit_person); null when not. */
  upload?: { accept: string; extensions: string[]; maxBytes: number } | null;
  notice: string | null;
  error: string | null;
  now: number;
};

/** One job's edit controls, when the member may edit it. */
function Controls({ candidate, applicationId, editing }: Pick<CandidateViewProps, "candidate" | "editing"> & { applicationId: string }) {
  const edit = editing?.apps[applicationId];
  const a = candidate.applications.find((x) => x.applicationId === applicationId);
  if (!edit || !editing || !a) return null;
  return (
    <JobControls
      key={`${applicationId}-${a.stage}`}
      e={{
        candidateId: candidate.candidateId,
        applicationId,
        stage: a.stage,
        ownerActorId: edit.ownerActorId,
        nextAction: a.nextAction,
        nextActionDue: a.nextActionDue,
        owners: editing.owners,
        reasons: editing.reasons,
      }}
    />
  );
}

/** design/tats's `.plan-row` as a Testbench ticket: the stage's square, the job in 500, its facts faint under it, the tags right. */
function Jobs({
  candidate,
  apps,
  owners,
  editing,
  now,
}: Pick<CandidateViewProps, "candidate" | "owners" | "editing" | "now"> & { apps: CandidateViewProps["candidate"]["applications"] }) {
  if (apps.length === 0) {
    return <Empty className="m-0 px-5 py-4">{candidate.prospect ? "A prospect: in no job yet." : "In no job you can see."}</Empty>;
  }
  return (
    <div>
      {apps.map((a) => {
        const owner = owners[a.applicationId] ?? null;
        const next = a.nextAction ? { text: a.nextAction, due: a.nextActionDue ? due(a.nextActionDue, now) : null } : null;
        return (
          <div key={a.applicationId} className="border-t border-[color:var(--line)] first:border-t-0">
            <Link
              href={`/client/jobs/${a.jobId}`}
              className="grid min-h-14 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3.5 px-5 py-3.5 transition-colors hover:bg-[color:var(--surface)]"
            >
              <span className="pt-[3px]">{stageGlyph(a.stage)}</span>
              <span className="grid min-w-0 gap-1">
                <b className="font-medium [overflow-wrap:anywhere]">{a.jobTitle ?? "Untitled job"}</b>
                <Facts
                  items={[
                    ...sourceParts(a.source, a.sourceDetail),
                    owner ? (
                      <>
                        Owner <span className="text-muted-foreground">{owner}</span>
                      </>
                    ) : (
                      "No owner"
                    ),
                    `Touched ${ago(a.lastTouchAt, now)}`,
                  ]}
                />
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
              </span>
              <span className="flex items-center gap-1.5">
                {a.offer ? <Pill>Offer {a.offer.status}</Pill> : null}
                <Pill tone={a.stage === "hired" ? "green" : "grey"}>{stageLabel(a.stage)}</Pill>
              </span>
            </Link>
            <Controls candidate={candidate} applicationId={a.applicationId} editing={editing} />
          </div>
        );
      })}
    </div>
  );
}

const CHEVRON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-90" aria-hidden>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

/** design/tats's `.past-row`: the job, its dates and how far they got, the outcome right. The controls stay, folded away. */
function PastApplications({ candidate, past, editing, now }: Pick<CandidateViewProps, "candidate" | "past" | "editing" | "now">) {
  return (
    <div>
      {past.map((p) => (
        <div key={p.applicationId} className="border-t border-[color:var(--line)] first:border-t-0">
          <Link
            href={`/client/jobs/${p.jobId}`}
            className="grid min-h-14 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3.5 px-5 py-3.5 transition-colors hover:bg-[color:var(--surface)]"
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
                ]}
              />
              {p.rejectionReason ? (
                <span className="text-[12.5px] text-faint">
                  Reason: <span className="text-muted-foreground">{p.rejectionReason}</span>
                </span>
              ) : null}
            </span>
            <Pill tone={p.stage === "hired" ? "green" : "grey"}>{stageLabel(p.stage)}</Pill>
          </Link>
          {editing?.apps[p.applicationId] ? (
            <details className="group pb-1">
              <summary className="mx-5 mb-3 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[12.5px] text-muted-foreground transition-colors select-none hover:bg-[color:var(--hover)] hover:text-foreground [&::-webkit-details-marker]:hidden">
                {CHEVRON}
                Reopen or edit…
              </summary>
              <Controls candidate={candidate} applicationId={p.applicationId} editing={editing} />
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The page's content, also what the Pipeline's and the Inbox's pop-ups hold.
 * `call`: what a pop-up wants decided, under the chips (design/tats's
 * `nowPanel`). `dashboard` is the pop-ups' form, a profile to read at a glance
 * with nothing to change in it (dashboard.tsx); the page itself keeps every
 * control. `journey` is the interview loop and the reads for the application a
 * pop-up was opened from, which only the dashboard draws. `nextInCall` is the
 * application whose next action `call` already states (an overdue next
 * action's ticket): the dashboard doesn't say it again under it.
 */
export function CandidateBody(props: CandidateViewProps & { call?: React.ReactNode; dashboard?: boolean; journey?: CandidateJourney | null; nextInCall?: string | null }) {
  if (props.dashboard) return <CandidateDashboard {...props} />;
  const { candidate, activity, owners, past, editing, labels = null, offers = {}, upload = null, notice, error, now, call = null } = props;
  const name = candidate.name?.trim() || "Unnamed";
  const pastIds = new Set(past.map((p) => p.applicationId));
  const current = candidate.applications.filter((a) => !pastIds.has(a.applicationId));
  const multi = current.length > 1;
  const sole = candidate.full && current.length === 1 ? current[0] : null;
  // A job the member can't manage isn't in `offers`. A closed one with no offers has nothing to show.
  const offerApps = current.filter((a) => {
    const list = offers[a.applicationId];
    return list && (list.length > 0 || offerBoard(a.stage, list).canDraft);
  });

  const chips = !!(current.length || candidate.tags.length || labels?.length);
  const head = chips || !!candidate.headline || !!candidate.location;

  return (
    <div className="grid content-start items-start gap-5 bg-[color:var(--surface)] px-[var(--page-gutter)] pt-3 pb-12 min-[1100px]:grid-cols-[minmax(0,1fr)_320px]">
      <CandidateCommands
        name={name}
        note={noteable(candidate.name)}
        labels={!!labels?.length}
        stage={current.some((a) => editing?.apps[a.applicationId])}
        close={current.some((a) => editing?.apps[a.applicationId] && !CLOSED.has(a.stage))}
      />
      <div className="grid min-w-0 content-start gap-5">
        {error ? <Notice tone="error">{error}</Notice> : notice ? <FlashToast text={notice} /> : null}
        {/* design/tats's `.t-head`, on the surface, under the title that names them (the page bar, or a pop-up's head): their facts faint, then the chips. No second heading. */}
        {head ? (
          <header aria-label={name} className="grid gap-3">
            <Facts className="text-[13px]" items={[candidate.headline ? <span className="text-muted-foreground">{candidate.headline}</span> : null, candidate.location]} />
            {chips ? (
              <Chips aria-label="Stage and tags">
                {current.map((a) => (
                  <Chip key={a.applicationId} title={a.jobTitle ?? undefined}>
                    <StatusGlyph kind={STAGE_GLYPH[a.stage] ?? "empty"} className="size-3" />
                    <span className="text-foreground">{stageLabel(a.stage)}</span>
                    {multi ? <span className="max-w-[160px] truncate text-faint">{a.jobTitle ?? "Untitled job"}</span> : null}
                  </Chip>
                ))}
                {past.length ? (
                  <Chip title="They applied here before: their past applications are below">
                    <StatusGlyph kind="lapsed" className="size-3" />
                    Applied before
                  </Chip>
                ) : null}
                <CandidateLabels candidateId={candidate.candidateId} labels={candidate.tags} choices={labels} />
              </Chips>
            ) : null}
          </header>
        ) : null}

        {call}

        {candidate.full ? (
          <Section aria-label="Jobs" title="Jobs" count={current.length} flush>
            <Jobs candidate={candidate} apps={current} owners={owners} editing={editing} now={now} />
          </Section>
        ) : (
          <Section>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">
              You&apos;re interviewing {name}. What you see here is your own interviews and notes; the rest of their record is the hiring team&apos;s. Your
              interviews are on your{" "}
              <Link href="/client" className={textLink}>
                home page
              </Link>
              .
            </p>
          </Section>
        )}

        {offerApps.length ? (
          <Section aria-label="Offers" title="Offer">
            <div className="grid gap-4">
              {offerApps.map((a) => (
                <div key={a.applicationId} className="grid gap-2">
                  {offerApps.length > 1 ? <span className="text-[12.5px] text-muted-foreground">{a.jobTitle ?? "Untitled job"}</span> : null}
                  <OfferBlock
                    target={{ candidateId: candidate.candidateId, applicationId: a.applicationId, name }}
                    stage={a.stage}
                    offers={offers[a.applicationId] ?? []}
                  />
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {past.length ? (
          <Section aria-label="Past applications" title="Past applications" count={past.length} flush>
            <PastApplications candidate={candidate} past={past} editing={editing} now={now} />
          </Section>
        ) : null}

        {candidate.summary ? (
          <Section aria-label="Profile" title="Profile">
            <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap text-foreground/85">{candidate.summary}</p>
          </Section>
        ) : null}

        {candidate.files.length || upload ? (
          <Section aria-label="Files" title="Files" count={candidate.files.length || undefined}>
            <div className="grid gap-3">
              {candidate.files.length ? <FileViewer files={viewerFiles(candidate.files, (iso) => ago(iso, now))} label={`${name}'s files`} /> : null}
              {upload ? <FileUpload key={candidate.candidateId} candidateId={candidate.candidateId} {...upload} /> : null}
            </div>
          </Section>
        ) : null}

        <Section aria-label="Activity" title="Activity" count={activity.length}>
          <div className="grid gap-4">
            {noteable(candidate.name) ? <NoteComposer key={candidate.candidateId} candidateId={candidate.candidateId} max={CANDIDATE_NOTE_MAX} /> : null}
            <ActivityStory entries={activity} now={now} />
            {activity.length >= FEED_MAX ? <p className="m-0 text-[12.5px] text-faint">The latest {FEED_MAX}. Older activity isn&apos;t shown here.</p> : null}
          </div>
        </Section>
      </div>

      <CandidateRail candidate={candidate} sole={sole} owners={owners} now={now} />
    </div>
  );
}

export function CandidateView(props: CandidateViewProps) {
  const name = props.candidate.name?.trim() || "Unnamed";
  return (
    <Page bleed bar={<PageBar title={name} crumbs={[{ href: "/client/candidates", label: "CRM" }]} />}>
      <CandidateBody {...props} />
    </Page>
  );
}
