import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { FlashToast } from "@/components/flash-toast";
import { Chip, Chips, Empty, Notice, Page, PageBar, Pill, textLink } from "@/components/page";
import { FEED_MAX } from "@/lib/client/candidate";
import { CANDIDATE_NOTE_MAX, noteable } from "@/lib/client/candidate-edit-rules";
import type { CloseReason, LabelChoices, OwnerChoice } from "@/lib/client/candidate-edits";
import { stageLabel } from "@/lib/client/crm-views";
import { offerBoard, type Offer } from "@/lib/client/offer-rules";
import type { PastApplication } from "@/lib/client/past-applications";
import { ago, until } from "@/lib/client/pipeline-columns";
import { cn, safeHttpUrl } from "@/lib/utils";
import { ActivityStory } from "../activity-story";
import { LocalDay } from "../local-day";
import { CandidateCommands } from "./commands";
import { CandidateLabels, JobControls } from "./controls";
import { NoteComposer } from "./note-composer";
import { OfferBlock } from "./offer-block";

// The candidate page's markup, props only (page.tsx does the reads), laid
// out like design/tats's ticket page (#t~APP-x, `.detail`) where real data
// exists: the bar with the crumb back to the CRM; then an unboxed main column
// (the `.t-head`: avatar, name, headline and location; a chip per job's stage
// and their tags; each job they are in as a `.plan-row`, with its controls
// under it where the member may edit (can_edit_pipeline, controls.tsx); the
// applications they came back after, with "Applied before" among the chips,
// as design/tats's past applications (lib/client/past-applications.ts); the
// profile; the activity as a `.story` under the `.composer` for a note, which
// is above it because this feed runs newest first), beside the 280px `.props`
// rail (contact, files). Everything about the candidate is untrusted text and is
// rendered as text; a LinkedIn link is only a link when it is http(s). Times
// are relative ("3d ago") or a day the browser words in its own zone
// (LocalDay), so the server needs no time zone.

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
  notice: string | null;
  error: string | null;
  now: number;
};

const DAY = 86_400_000;

/** A next action's due date ("YYYY-MM-DD"), relative, and whether it has passed. */
function due(iso: string, now: number): { text: string; late: boolean } {
  const day = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Math.floor(now / DAY) * DAY;
  const days = Math.round((day - today) / DAY);
  if (Number.isNaN(days)) return { text: iso, late: false };
  if (days === 0) return { text: "due today", late: false };
  if (days < 0) return { text: `${-days}d overdue`, late: true };
  return { text: `due in ${days}d`, late: false };
}

const size = (bytes: number | null) =>
  bytes === null ? null : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const sourceText = (source: string, detail: string | null) => [source.replace(/_/g, " "), detail].filter(Boolean).join(" · ");

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const CLOSED = new Set(["rejected", "withdrawn"]);

/** design/tats's `.block-head`: a plain 500-weight label, its count faint. */
function BlockHead({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="m-0 mb-2 flex items-center gap-2 text-[14px] font-medium">
      {children}
      {count !== undefined ? <span className="font-normal text-faint tabular-nums">{count}</span> : null}
    </h2>
  );
}

/** design/tats's `.prop`: an 84px faint label and the value, 30px high. */
function Prop({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[84px_minmax(0,1fr)] items-center gap-2 px-2 text-[13.5px]">
      <span className="text-[12.5px] text-faint">{k}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  );
}

function PropGroup({ title, ruled = false, children }: { title: string; ruled?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={cn("grid gap-px", ruled && "border-t border-[color:var(--line)] pt-3")}>
      <h2 className="m-0 px-2 pb-1 text-[12px] font-medium text-faint">{title}</h2>
      {children}
    </section>
  );
}

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

function Jobs({
  candidate,
  apps,
  owners,
  editing,
  now,
}: Pick<CandidateViewProps, "candidate" | "owners" | "editing" | "now"> & { apps: CandidateViewProps["candidate"]["applications"] }) {
  if (apps.length === 0) {
    return <Empty>{candidate.prospect ? "A prospect: in no job yet." : "In no job you can see."}</Empty>;
  }
  return (
    <div className="border-t border-[color:var(--line)]">
      {apps.map((a) => {
        const owner = owners[a.applicationId] ?? null;
        const next = a.nextAction ? { text: a.nextAction, due: a.nextActionDue ? due(a.nextActionDue, now) : null } : null;
        return (
          <div key={a.applicationId} className="border-b border-[color:var(--line)]">
            {/* design/tats's `.plan-row`: a mark, the job and a faint line, its pills right */}
            <Link
              href={`/client/jobs/${a.jobId}`}
              className="grid min-h-[38px] grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 transition-colors hover:bg-[color:var(--hover)]"
            >
              <span aria-hidden className="grid place-items-center">
                <i
                  className={cn(
                    "size-2 rounded-full",
                    a.stage === "hired" ? "bg-positive" : CLOSED.has(a.stage) ? "bg-[color:var(--line-strong)]" : "bg-foreground/55",
                  )}
                />
              </span>
              <span className="grid min-w-0">
                <span className="flex min-w-0 items-baseline gap-2">
                  <b className="font-medium whitespace-nowrap">{a.jobTitle ?? "Untitled job"}</b>
                  <span className="truncate text-[12.5px] text-faint">
                    {[sourceText(a.source, a.sourceDetail), owner ? `Owner ${owner}` : "No owner", `touched ${ago(a.lastTouchAt, now)}`].join(" · ")}
                  </span>
                </span>
                {next ? (
                  <span className="truncate text-[12.5px] text-foreground/80">
                    Next: {next.text}
                    {next.due ? <span className={cn("ml-1.5", next.due.late ? "text-negative" : "text-faint")}>{next.due.text}</span> : null}
                  </span>
                ) : null}
                {a.rejectionReason ? <span className="truncate text-[12.5px] text-faint">Reason: {a.rejectionReason}</span> : null}
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

/** design/tats's `.past-row`: the job, its dates and how far they got, the outcome right. The controls stay, folded away. */
function PastApplications({ candidate, past, editing, now }: Pick<CandidateViewProps, "candidate" | "past" | "editing" | "now">) {
  return (
    <div className="border-t border-[color:var(--line)]">
      {past.map((p) => (
        <div key={p.applicationId} className="border-b border-[color:var(--line)]">
          <Link
            href={`/client/jobs/${p.jobId}`}
            className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 transition-colors hover:bg-[color:var(--hover)]"
          >
            <span className="grid min-w-0">
              <b className="truncate font-medium">{p.jobTitle ?? "Untitled job"}</b>
              <span className="truncate text-[12.5px] text-faint">
                <LocalDay iso={p.appliedAt} fallback={ago(p.appliedAt, now)} />
                {p.closedAt ? (
                  <>
                    {" to "}
                    <LocalDay iso={p.closedAt} fallback={ago(p.closedAt, now)} />
                  </>
                ) : null}
                {p.reached ? ` · got to ${stageLabel(p.reached).toLowerCase()}` : null}
              </span>
              {p.rejectionReason ? <span className="truncate text-[12.5px] text-faint">Reason: {p.rejectionReason}</span> : null}
            </span>
            <Pill tone={p.stage === "hired" ? "green" : "grey"}>{stageLabel(p.stage)}</Pill>
          </Link>
          {editing?.apps[p.applicationId] ? (
            <details className="pb-2">
              <summary className="cursor-pointer px-2 text-xs text-muted-foreground select-none hover:text-foreground">Reopen or edit…</summary>
              <div className="mt-2">
                <Controls candidate={candidate} applicationId={p.applicationId} editing={editing} />
              </div>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The page's content, also what the Pipeline's and the Inbox's pop-ups hold. `call`: what a pop-up wants decided, under the chips (design/tats's `nowPanel`). */
export function CandidateBody({ candidate, activity, owners, past, editing, labels = null, offers = {}, notice, error, now, call = null }: CandidateViewProps & { call?: React.ReactNode }) {
  const name = candidate.name?.trim() || "Unnamed";
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  const subtitle = [candidate.headline, candidate.location].filter(Boolean).join(" · ") || null;
  const pastIds = new Set(past.map((p) => p.applicationId));
  const current = candidate.applications.filter((a) => !pastIds.has(a.applicationId));
  const multi = current.length > 1;
  const sole = candidate.full && current.length === 1 ? current[0] : null;
  // A job the member can't manage isn't in `offers`. A closed one with no offers has nothing to show.
  const offerApps = current.filter((a) => {
    const list = offers[a.applicationId];
    return list && (list.length > 0 || offerBoard(a.stage, list).canDraft);
  });

  const contact: [string, React.ReactNode][] = [];
  if (candidate.full) contact.push(["Email", candidate.email ? <span className="truncate">{candidate.email}</span> : <span className="text-faint">None on file</span>]);
  if (candidate.location) contact.push(["Location", <span className="truncate">{candidate.location}</span>]);
  if (candidate.linkedinUrl)
    contact.push([
      "LinkedIn",
      linkedin ? (
        <a href={linkedin} target="_blank" rel="noopener noreferrer nofollow" className={cn(textLink, "min-w-0 truncate text-[13.5px]")}>
          {linkedin.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : (
        <span className="truncate">{candidate.linkedinUrl}</span>
      ),
    ]);
  if (candidate.prospect && candidate.prospectSource)
    contact.push(["Came in", <span className="truncate">{sourceText(candidate.prospectSource, candidate.prospectSourceDetail)}</span>]);
  if (candidate.pools.length)
    contact.push(["Pools", <span className="truncate">{candidate.pools.map((p) => `${p.pool} (${p.stage.replace(/_/g, " ")})`).join(", ")}</span>]);

  return (
    <div className="grid min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
      <CandidateCommands
        name={name}
        note={noteable(candidate.name)}
        labels={!!labels?.length}
        stage={current.some((a) => editing?.apps[a.applicationId])}
        close={current.some((a) => editing?.apps[a.applicationId] && !CLOSED.has(a.stage))}
      />
      {/* design/tats's `.detail .body`: unboxed, at most 840px, 24px between blocks */}
      <div className="mx-auto grid w-full max-w-[840px] min-w-0 content-start gap-6 px-4 pt-8 pb-20 md:px-12">
        {error ? <Notice tone="error">{error}</Notice> : notice ? <FlashToast text={notice} /> : null}
        <div className="grid gap-5">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <h1 className="m-0 text-[22px] leading-[1.25] font-semibold tracking-[-0.012em] text-balance">{name}</h1>
              {subtitle ? <p className="m-0 mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>
          {current.length || candidate.tags.length || labels?.length ? (
            <Chips aria-label="Stage and tags">
              {current.map((a) => (
                <Chip key={a.applicationId} title={a.jobTitle ?? undefined}>
                  <i
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      a.stage === "hired" ? "bg-positive" : CLOSED.has(a.stage) ? "bg-[color:var(--line-strong)]" : "bg-foreground/55",
                    )}
                  />
                  {stageLabel(a.stage)}
                  {multi ? <span className="max-w-[160px] truncate text-faint">{a.jobTitle ?? "Untitled job"}</span> : null}
                </Chip>
              ))}
              {past.length ? (
                <Chip>
                  <i aria-hidden className="size-1.5 rounded-full bg-[color:var(--closed)]" />
                  Applied before
                </Chip>
              ) : null}
              <CandidateLabels candidateId={candidate.candidateId} labels={candidate.tags} choices={labels} />
            </Chips>
          ) : null}
        </div>

        {call}

        {candidate.full ? (
          <section aria-label="Jobs">
            <BlockHead count={current.length}>Jobs</BlockHead>
            <Jobs candidate={candidate} apps={current} owners={owners} editing={editing} now={now} />
          </section>
        ) : (
          <p className="m-0 text-[14px] text-muted-foreground">
            You&apos;re interviewing {name}. What you see here is your own interviews and notes; the rest of their record is the hiring team&apos;s.
            Your interviews are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        )}

        {offerApps.length ? (
          <section aria-label="Offers">
            <BlockHead>Offer</BlockHead>
            <div className="grid gap-4">
              {offerApps.map((a) => (
                <div key={a.applicationId} className="grid gap-1.5">
                  {offerApps.length > 1 ? <span className="text-[12.5px] text-faint">{a.jobTitle ?? "Untitled job"}</span> : null}
                  <OfferBlock
                    target={{ candidateId: candidate.candidateId, applicationId: a.applicationId, name }}
                    stage={a.stage}
                    offers={offers[a.applicationId] ?? []}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {past.length ? (
          <section aria-label="Past applications">
            <BlockHead count={past.length}>Past applications</BlockHead>
            <PastApplications candidate={candidate} past={past} editing={editing} now={now} />
          </section>
        ) : null}

        {candidate.summary ? (
          <section aria-label="Profile">
            <BlockHead>Profile</BlockHead>
            <p className="m-0 text-[14px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85">{candidate.summary}</p>
          </section>
        ) : null}

        <section aria-label="Activity">
          <BlockHead count={activity.length}>Activity</BlockHead>
          <div className="grid gap-3">
            {noteable(candidate.name) ? <NoteComposer key={candidate.candidateId} candidateId={candidate.candidateId} max={CANDIDATE_NOTE_MAX} /> : null}
            <ActivityStory entries={activity} now={now} />
            {activity.length >= FEED_MAX ? <p className="m-0 text-[12.5px] text-faint">The latest {FEED_MAX}. Older activity isn&apos;t shown here.</p> : null}
          </div>
        </section>
      </div>

      {/* design/tats's `.props`: the rail, ruled off on the left */}
      <aside className="grid content-start gap-4 border-t border-[color:var(--line)] px-3 pt-3.5 pb-10 min-[1100px]:border-t-0 min-[1100px]:border-l">
        {sole ? (
          <PropGroup title="Application">
            <Prop k="Status">
              <span className="truncate">{stageLabel(sole.stage)}</span>
            </Prop>
            <Prop k="Owner">
              {owners[sole.applicationId] ? <span className="truncate">{owners[sole.applicationId]}</span> : <span className="text-faint">No owner</span>}
            </Prop>
            <Prop k="Role">
              <span className="truncate">{sole.jobTitle ?? "Untitled job"}</span>
            </Prop>
            <Prop k="Source">
              <span className="truncate">{sourceText(sole.source, sole.sourceDetail)}</span>
            </Prop>
          </PropGroup>
        ) : null}
        {contact.length ? (
          <PropGroup ruled={sole !== null} title="Contact">
            {contact.map(([k, v]) => (
              <Prop key={k} k={k}>
                {v}
              </Prop>
            ))}
          </PropGroup>
        ) : null}
        <PropGroup ruled={sole !== null || contact.length > 0} title={`Files${candidate.files.length ? ` · ${candidate.files.length}` : ""}`}>
          {candidate.files.length === 0 ? (
            <p className="m-0 px-2 text-[12.5px] text-faint">No files.</p>
          ) : (
            candidate.files.map((f) => (
              <Prop key={f.fileId} k={f.kind === "resume" ? "Resume" : "Attachment"}>
                <a
                  href={`/client/files/${f.fileId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate underline decoration-[color:var(--n300)] underline-offset-2"
                  title={[f.filename, size(f.sizeBytes), f.uploadedBy, ago(f.uploadedAt, now)].filter(Boolean).join(" · ")}
                >
                  {f.filename}
                </a>
              </Prop>
            ))
          )}
        </PropGroup>
      </aside>
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
