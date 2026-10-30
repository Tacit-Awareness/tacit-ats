import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { Avatar, Chip, Chips, Empty, KeyValues, Page, PageHeader, Pill, Row, Rows, Section, Split, textLink } from "@/components/page";
import { activityLine } from "@/lib/client/candidate-activity";
import { stageLabel } from "@/lib/client/crm-views";
import { ago, until } from "@/lib/client/pipeline-columns";
import { cn, safeHttpUrl } from "@/lib/utils";

// The candidate page's markup, props only (page.tsx does the reads), laid
// out like design/tats's ticket page (#t~APP-x) where real data exists: the
// person and their headline, their tags, each job they are in, the profile,
// their files and the activity feed in the main column; contact and the rest
// in a side column. Read-only. Everything about the candidate is untrusted
// text and is rendered as text; a LinkedIn link is only a link when it is
// http(s). Times are relative ("3d ago"), so no time zone is needed.

export type CandidateViewProps = {
  candidate: clientTools.CandidateDetail;
  activity: clientTools.ActivityEntry[];
  owners: Record<string, string | null>;
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

function Jobs({ candidate, owners, now }: Pick<CandidateViewProps, "candidate" | "owners" | "now">) {
  if (candidate.applications.length === 0) {
    return <Empty>{candidate.prospect ? "A prospect: in no job yet." : "In no job you can see."}</Empty>;
  }
  return (
    <Rows>
      {candidate.applications.map((a) => {
        const owner = owners[a.applicationId] ?? null;
        const next = a.nextAction ? { text: a.nextAction, due: a.nextActionDue ? due(a.nextActionDue, now) : null } : null;
        return (
          <Row
            key={a.applicationId}
            href={`/client/jobs/${a.jobId}`}
            title={a.jobTitle ?? "Untitled job"}
            sub={[sourceText(a.source, a.sourceDetail), owner ? `Owner ${owner}` : "No owner", `touched ${ago(a.lastTouchAt, now)}`].join(" · ")}
            meta={
              <>
                {a.offer ? <Pill>Offer {a.offer.status}</Pill> : null}
                <Pill tone={a.stage === "hired" ? "green" : "grey"}>{stageLabel(a.stage)}</Pill>
              </>
            }
          >
            {next ? (
              <span className="max-w-full justify-self-start truncate text-xs text-foreground/80">
                Next: {next.text}
                {next.due ? <span className={cn("ml-1.5", next.due.late ? "text-negative" : "text-faint")}>{next.due.text}</span> : null}
              </span>
            ) : null}
            {a.rejectionReason ? <span className="max-w-full justify-self-start truncate text-xs text-faint">Reason: {a.rejectionReason}</span> : null}
          </Row>
        );
      })}
    </Rows>
  );
}

function Activity({ entries, now }: { entries: clientTools.ActivityEntry[]; now: number }) {
  if (entries.length === 0) return <Empty>Nothing yet.</Empty>;
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {entries.map((e, i) => {
        const line = activityLine(e);
        const upcoming = e.kind === "interview.scheduled" && e.startsAt && Date.parse(e.startsAt) > now ? `Interview ${until(e.startsAt, now)}` : null;
        return (
          <li key={`${e.kind}-${e.refId ?? ""}-${e.at}-${i}`} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
            {/* the thread line between avatars */}
            {i < entries.length - 1 ? <span aria-hidden className="absolute top-[26px] bottom-0 left-[10.5px] w-px bg-[color:var(--line)]" /> : null}
            {e.actor ? <Avatar name={e.actor} /> : <span aria-hidden className="mt-[7px] ml-[7px] size-2 rounded-full bg-[color:var(--line-strong)]" />}
            <div className="grid min-w-0 gap-1">
              <p className="m-0 text-[13px] leading-[22px] text-foreground/80">
                {e.actor ? <b className="font-medium text-foreground">{e.actor}</b> : null} {e.actor ? line.what : capital(line.what)}
                <span className="ml-2 text-xs text-faint" title={e.at}>
                  {ago(e.at, now)}
                </span>
              </p>
              {line.body ? <p className="m-0 text-[13px] break-words whitespace-pre-wrap text-foreground">{line.body}</p> : null}
              {upcoming ? <p className="m-0 text-xs text-muted-foreground">{upcoming}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CandidateView({ candidate, activity, owners, now }: CandidateViewProps) {
  const name = candidate.name?.trim() || "Unnamed";
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  const subtitle = [candidate.headline, candidate.location].filter(Boolean).join(" · ") || null;

  const profile: [React.ReactNode, React.ReactNode][] = [];
  if (candidate.full) profile.push(["Email", candidate.email ? <span className="truncate">{candidate.email}</span> : <span className="text-faint">None on file</span>]);
  if (candidate.location) profile.push(["Location", candidate.location]);
  if (candidate.linkedinUrl)
    profile.push([
      "LinkedIn",
      linkedin ? (
        <a href={linkedin} target="_blank" rel="noopener noreferrer nofollow" className={cn(textLink, "truncate")}>
          {linkedin.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : (
        <span className="truncate">{candidate.linkedinUrl}</span>
      ),
    ]);
  if (candidate.prospect && candidate.prospectSource) profile.push(["Came in", sourceText(candidate.prospectSource, candidate.prospectSourceDetail)]);
  if (candidate.pools.length) profile.push(["Pools", candidate.pools.map((p) => `${p.pool} (${p.stage.replace(/_/g, " ")})`).join(", ")]);

  return (
    <Page>
      <PageHeader crumbs={[{ href: "/client/candidates", label: "CRM" }]} lead={<Avatar name={name} size="xl" />} title={name} subtitle={subtitle} />
      {candidate.tags.length ? (
        <Chips aria-label="Tags">
          {candidate.tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </Chips>
      ) : null}
      <Split
        main={
          <>
            {candidate.full ? (
              <Section title="Jobs" count={candidate.applications.length}>
                <Jobs candidate={candidate} owners={owners} now={now} />
              </Section>
            ) : (
              <Section>
                <p className="m-0 text-[13px] text-muted-foreground">
                  You&apos;re interviewing {name}. What you see here is your own interviews and notes; the rest of their record is the hiring
                  team&apos;s. Your interviews are on your{" "}
                  <Link href="/client" className={textLink}>
                    home page
                  </Link>
                  .
                </p>
              </Section>
            )}
            {candidate.summary ? (
              <Section title="Profile">
                <p className="m-0 text-[13px] break-words whitespace-pre-wrap text-foreground/85">{candidate.summary}</p>
              </Section>
            ) : null}
            <Section title="Activity" count={activity.length}>
              <Activity entries={activity} now={now} />
            </Section>
          </>
        }
        side={
          <>
            {profile.length ? (
              <Section title="Contact">
                <KeyValues items={profile} className="grid-cols-[80px_minmax(0,1fr)]" />
              </Section>
            ) : null}
            <Section title="Files" count={candidate.files.length}>
              {candidate.files.length === 0 ? (
                <Empty>No files.</Empty>
              ) : (
                <Rows tight>
                  {candidate.files.map((f) => (
                    <Row
                      key={f.fileId}
                      title={f.filename}
                      sub={[f.kind === "resume" ? "Resume" : "Attachment", size(f.sizeBytes), f.uploadedBy, ago(f.uploadedAt, now)].filter(Boolean).join(" · ")}
                    />
                  ))}
                </Rows>
              )}
            </Section>
          </>
        }
      />
    </Page>
  );
}
