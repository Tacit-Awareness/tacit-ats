import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { Avatar, Chip, Chips, Empty, Notice, Page, PageBar, Pill, textLink } from "@/components/page";
import { activityLine } from "@/lib/client/candidate-activity";
import type { CloseReason, OwnerChoice } from "@/lib/client/candidate-edits";
import { stageLabel } from "@/lib/client/crm-views";
import { ago, until } from "@/lib/client/pipeline-columns";
import { cn, safeHttpUrl } from "@/lib/utils";
import { LocalDay } from "../local-day";
import { JobControls } from "./controls";

// The candidate page's markup, props only (page.tsx does the reads), laid
// out like design/tats's ticket page (#t~APP-x, `.detail`) where real data
// exists: the bar with the crumb back to the CRM; then an unboxed main column
// (the `.t-head`: avatar, name, headline and location; a chip per job's stage
// and their tags; each job they are in as a `.plan-row`, with its controls
// under it where the member may edit (can_edit_pipeline, controls.tsx); the
// profile; the activity as a `.story`), beside the 280px `.props` rail
// (contact, files). Everything about the candidate is untrusted text and is
// rendered as text; a LinkedIn link is only a link when it is http(s). Times
// are relative ("3d ago") or a day the browser words in its own zone
// (LocalDay), so the server needs no time zone.

export type CandidateViewProps = {
  candidate: clientTools.CandidateDetail;
  activity: clientTools.ActivityEntry[];
  owners: Record<string, string | null>;
  /** Null when the member may edit none of this candidate's jobs. */
  editing: {
    /** The applications they may edit, with each one's owner's id. */
    apps: Record<string, { ownerActorId: string | null }>;
    owners: OwnerChoice[];
    reasons: CloseReason[];
  } | null;
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
    <div className="grid min-h-[30px] grid-cols-[84px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-[13.5px]">
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

function Jobs({ candidate, owners, editing, now }: Pick<CandidateViewProps, "candidate" | "owners" | "editing" | "now">) {
  if (candidate.applications.length === 0) {
    return <Empty>{candidate.prospect ? "A prospect: in no job yet." : "In no job you can see."}</Empty>;
  }
  return (
    <div className="border-t border-[color:var(--line)]">
      {candidate.applications.map((a) => {
        const owner = owners[a.applicationId] ?? null;
        const next = a.nextAction ? { text: a.nextAction, due: a.nextActionDue ? due(a.nextActionDue, now) : null } : null;
        const edit = editing?.apps[a.applicationId];
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
            {edit && editing ? (
              <JobControls
                e={{
                  candidateId: candidate.candidateId,
                  applicationId: a.applicationId,
                  stage: a.stage,
                  ownerActorId: edit.ownerActorId,
                  nextAction: a.nextAction,
                  nextActionDue: a.nextActionDue,
                  owners: editing.owners,
                  reasons: editing.reasons,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type Mark = "done" | "fail" | "next" | "plain";

/** The story's status mark: ticked for a move forward, "!" for a close or a cancel, dashed accent for an interview still to come. */
function markOf(e: clientTools.ActivityEntry, now: number): Mark {
  if (e.kind === "interview.scheduled" && e.startsAt && Date.parse(e.startsAt) > now) return "next";
  if (e.kind === "interview.cancelled" || e.kind === "offer.declined" || e.kind === "offer.withdrawn" || e.kind === "approval.rejected") return "fail";
  if ((e.kind === "application.stage_changed" || e.kind === "application.added") && e.toStage && CLOSED.has(e.toStage)) return "fail";
  if (e.kind === "application.stage_changed" || e.kind === "application.added" || e.kind === "interview.done" || e.kind === "offer.accepted" || e.kind === "approval.approved")
    return "done";
  return "plain";
}

function StoryMark({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[9px] left-0 z-[1] grid size-[18px] place-items-center rounded-full text-[10px] leading-none font-bold",
        mark === "done"
          ? "bg-[color:var(--soft)] text-muted-foreground"
          : mark === "fail"
            ? "bg-[color:var(--red)] text-white"
            : mark === "next"
              ? "border border-dashed border-[color:var(--accent)] bg-[color:var(--paper)] text-[color:var(--accent)]"
              : "bg-[color:var(--paper)] text-faint shadow-[inset_0_0_0_1px_var(--line-strong)]",
      )}
    >
      {mark === "done" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5">
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      ) : mark === "fail" ? (
        "!"
      ) : mark === "next" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5">
          <path d="M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3" />
        </svg>
      ) : null}
    </span>
  );
}

/** design/tats's `.story`: a mark on a thread line, then who, what and the day. */
function Activity({ entries, now }: { entries: clientTools.ActivityEntry[]; now: number }) {
  if (entries.length === 0) return <Empty>Nothing yet.</Empty>;
  return (
    <ol className="relative m-0 mt-1 list-none p-0">
      {entries.map((e, i) => {
        const line = activityLine(e);
        const mark = markOf(e, now);
        const upcoming = mark === "next" && e.startsAt ? `Interview ${until(e.startsAt, now)}` : null;
        const first = i === 0;
        const last = i === entries.length - 1;
        return (
          <li key={`${e.kind}-${e.refId ?? ""}-${e.at}-${i}`} className="relative pl-7">
            {entries.length > 1 ? (
              <span
                aria-hidden
                className={cn("absolute left-[8.5px] w-px bg-[color:var(--line-strong)]", first ? "top-[18px]" : "top-0", last ? "h-[18px]" : "bottom-0")}
              />
            ) : null}
            <StoryMark mark={mark} />
            <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg px-2 pt-2 pb-[9px]">
              <span className="pt-px">{e.actor ? <Avatar name={e.actor} size="xs" /> : null}</span>
              <span className="grid min-w-0 gap-0.5">
                <span className={cn("text-[13.5px]", mark === "fail" ? "text-negative" : mark === "next" ? "text-[color:var(--accent)]" : "text-foreground")}>
                  {e.actor ? <b className="font-medium">{e.actor}</b> : null} {e.actor ? line.what : capital(line.what)}
                </span>
                {line.body ? <span className="text-[13px] leading-[1.45] break-words whitespace-pre-wrap text-muted-foreground">{line.body}</span> : null}
                {upcoming ? <span className="text-[13px] text-muted-foreground">{upcoming}</span> : null}
              </span>
              <span className="pt-0.5 text-[12px] whitespace-nowrap text-faint tabular-nums" title={e.at.slice(0, 10)}>
                <LocalDay iso={e.at} fallback={ago(e.at, now)} />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CandidateView({ candidate, activity, owners, editing, notice, error, now }: CandidateViewProps) {
  const name = candidate.name?.trim() || "Unnamed";
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  const subtitle = [candidate.headline, candidate.location].filter(Boolean).join(" · ") || null;
  const multi = candidate.applications.length > 1;

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
    <Page bleed bar={<PageBar title={name} crumbs={[{ href: "/client/candidates", label: "CRM" }]} />}>
      <div className="grid min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
        {/* design/tats's `.detail .body`: unboxed, at most 840px, 24px between blocks */}
        <div className="mx-auto grid w-full max-w-[840px] min-w-0 content-start gap-6 px-4 pt-8 pb-20 md:px-12">
          {error ? <Notice tone="error">{error}</Notice> : notice ? <Notice>{notice}</Notice> : null}
          <div className="grid gap-5">
            <div className="flex items-center gap-3">
              <Avatar name={name} size="ticket" candidate />
              <div className="min-w-0">
                <h1 className="m-0 text-[22px] leading-[1.25] font-semibold tracking-[-0.012em] text-balance">{name}</h1>
                {subtitle ? <p className="m-0 mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p> : null}
              </div>
            </div>
            {candidate.applications.length || candidate.tags.length ? (
              <Chips aria-label="Stage and tags">
                {candidate.applications.map((a) => (
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
                {candidate.tags.map((t) => (
                  <Chip key={`tag-${t}`}>{t}</Chip>
                ))}
              </Chips>
            ) : null}
          </div>

          {candidate.full ? (
            <section aria-label="Jobs">
              <BlockHead count={candidate.applications.length}>Jobs</BlockHead>
              <Jobs candidate={candidate} owners={owners} editing={editing} now={now} />
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

          {candidate.summary ? (
            <section aria-label="Profile">
              <BlockHead>Profile</BlockHead>
              <p className="m-0 text-[14px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85">{candidate.summary}</p>
            </section>
          ) : null}

          <section aria-label="Activity">
            <BlockHead count={activity.length}>Activity</BlockHead>
            <Activity entries={activity} now={now} />
          </section>
        </div>

        {/* design/tats's `.props`: the rail, ruled off on the left */}
        <aside className="grid content-start gap-4 border-t border-[color:var(--line)] px-3 pt-3.5 pb-10 min-[1100px]:border-t-0 min-[1100px]:border-l">
          {contact.length ? (
            <PropGroup title="Contact">
              {contact.map(([k, v]) => (
                <Prop key={k} k={k}>
                  {v}
                </Prop>
              ))}
            </PropGroup>
          ) : null}
          <PropGroup ruled={contact.length > 0} title={`Files${candidate.files.length ? ` · ${candidate.files.length}` : ""}`}>
            {candidate.files.length === 0 ? (
              <p className="m-0 px-2 text-[12.5px] text-faint">No files.</p>
            ) : (
              candidate.files.map((f) => (
                <Prop key={f.fileId} k={f.kind === "resume" ? "Resume" : "Attachment"}>
                  <span
                    className="truncate"
                    title={[f.filename, size(f.sizeBytes), f.uploadedBy, ago(f.uploadedAt, now)].filter(Boolean).join(" · ")}
                  >
                    {f.filename}
                  </span>
                </Prop>
              ))
            )}
          </PropGroup>
        </aside>
      </div>
    </Page>
  );
}
