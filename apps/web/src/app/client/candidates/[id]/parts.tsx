import { Fragment } from "react";
import type { clientTools } from "@tacit-ats/core";
import { Count, Empty, KeyValues, STAGE_GLYPH, StatusGlyph, textLink } from "@/components/page";
import { stageLabel } from "@/lib/client/crm-views";
import { fileHref, fileSize } from "@/lib/client/file-view-rules";
import { ago } from "@/lib/client/pipeline-columns";
import { cn, safeHttpUrl } from "@/lib/utils";

// What the candidate page (view.tsx) and its read-only pop-up form
// (dashboard.tsx) draw alike: the facts on a line, a next action's due date,
// where they came from, and the side card of facts (application, contact,
// files) that both keep. Server markup, no state.

const DAY = 86_400_000;

/** A next action's due date ("YYYY-MM-DD"), relative, and whether it has passed. */
export function due(iso: string, now: number): { text: string; late: boolean } {
  const day = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const today = Math.floor(now / DAY) * DAY;
  const days = Math.round((day - today) / DAY);
  if (Number.isNaN(days)) return { text: iso, late: false };
  if (days === 0) return { text: "Due today", late: false };
  if (days < 0) return { text: `${-days}d overdue`, late: true };
  return { text: `Due in ${days}d`, late: false };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where they came from, as separate facts: the channel ("Job board") and its detail (the posting, the referrer). */
export const sourceParts = (source: string, detail: string | null) => [capital(source.replace(/_/g, " ")), detail].filter((p): p is string => !!p);

export const CLOSED = new Set(["rejected", "withdrawn"]);

/** A stage's square, the one the Pipeline and the CRM draw for it. */
export const stageGlyph = (stage: string) => <StatusGlyph kind={STAGE_GLYPH[stage] ?? "empty"} />;

/** Facts on one line, apart on spacing; they wrap rather than run together or cut short. */
export function Facts({ items, className }: { items: React.ReactNode[]; className?: string }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  if (!shown.length) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px] text-faint", className)}>
      {shown.map((item, i) => (
        <span key={i} className="min-w-0 [overflow-wrap:anywhere]">
          {item}
        </span>
      ))}
    </span>
  );
}

/** A group of the rail's facts: a Mona Sans heading, then label and value pairs. */
function Facet({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3 border-t border-[color:var(--line)] px-5 pt-4 pb-5 first:border-t-0">
      <h2 className="m-0 flex items-center gap-2 font-sans text-[14px] leading-5 font-semibold tracking-[-0.01em]">
        {title}
        {count ? <Count>{count}</Count> : null}
      </h2>
      {children}
    </section>
  );
}

/** One line in the rail: cut short when it must, and the whole of it on hover. */
const one = (text: string) => (
  <span className="min-w-0 truncate" title={text}>
    {text}
  </span>
);

/** A value that wraps rather than cut short: a role, a source. */
const whole = (text: string) => <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>;

/**
 * What people copy (an email, a profile link) shows whole: it wraps, first where
 * it reads best (before the @, before a slash), and anywhere only past that.
 */
const copyable = (text: string) => (
  <span className="min-w-0 [overflow-wrap:anywhere]">
    {text.split(/(?=[@/])/).map((part, i) => (
      <Fragment key={i}>
        {i ? <wbr /> : null}
        {part}
      </Fragment>
    ))}
  </span>
);

const PAIRS = "grid-cols-[80px_minmax(0,1fr)] gap-x-3";

/**
 * design/tats's `.props`: the side card, one card of facts. Application when
 * they are in one job, Contact, and Files as links that open each file. An
 * email or a profile link wraps rather than being cut short, as people copy them.
 */
export function CandidateRail({
  candidate,
  sole,
  owners,
  now,
  named = false,
}: {
  candidate: clientTools.CandidateDetail;
  /** Their one current application, when they have exactly one and the member reads the whole record. */
  sole: clientTools.CandidateDetail["applications"][number] | null;
  owners: Record<string, string | null>;
  now: number;
  /**
   * The card beside it already heads with their one job (the pop-ups'
   * dashboard): Application leaves out the role, and a source detail that is
   * only the job's title (a job board's posting) is the channel alone.
   */
  named?: boolean;
}) {
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  const contact: [string, React.ReactNode][] = [];
  if (candidate.full) contact.push(["Email", candidate.email ? copyable(candidate.email) : <span className="text-faint">None on file</span>]);
  if (candidate.location) contact.push(["Location", whole(candidate.location)]);
  if (candidate.linkedinUrl)
    contact.push([
      "LinkedIn",
      linkedin ? (
        <a href={linkedin} target="_blank" rel="noopener noreferrer nofollow" title={linkedin} className={cn(textLink, "inline min-w-0 text-[13px] text-foreground")}>
          {copyable(linkedin.replace(/^https?:\/\/(www\.)?/, ""))}
        </a>
      ) : (
        copyable(candidate.linkedinUrl)
      ),
    ]);
  if (candidate.prospect && candidate.prospectSource)
    contact.push(["Came in", <Facts className="text-[13px] text-foreground" items={sourceParts(candidate.prospectSource, candidate.prospectSourceDetail)} />]);
  if (candidate.pools.length)
    contact.push(["Pools", <span className="min-w-0 [overflow-wrap:anywhere]">{candidate.pools.map((p) => `${p.pool} (${p.stage.replace(/_/g, " ")})`).join(", ")}</span>]);

  return (
    <aside className="grid min-w-0 content-start overflow-hidden rounded-[14px] bg-card text-[13px] shadow-[var(--shadow)] min-[1100px]:sticky min-[1100px]:top-4">
      {sole ? (
        <Facet title="Application">
          <KeyValues
            className={PAIRS}
            items={[
              [
                "Status",
                <>
                  {stageGlyph(sole.stage)}
                  {one(stageLabel(sole.stage))}
                </>,
              ],
              ["Owner", owners[sole.applicationId] ? whole(owners[sole.applicationId]!) : <span className="text-faint">No owner</span>],
              ...(named ? [] : [["Role", whole(sole.jobTitle ?? "Untitled job")] as [string, React.ReactNode]]),
              [
                "Source",
                <Facts
                  className="text-[13px] text-foreground"
                  items={sourceParts(sole.source, named && sole.sourceDetail?.trim() === sole.jobTitle?.trim() ? null : sole.sourceDetail)}
                />,
              ],
            ]}
          />
        </Facet>
      ) : null}
      {contact.length ? (
        <Facet title="Contact">
          <KeyValues className={PAIRS} items={contact} />
        </Facet>
      ) : null}
      <Facet title="Files" count={candidate.files.length}>
        {candidate.files.length === 0 ? (
          <Empty className="m-0">No files.</Empty>
        ) : (
          <KeyValues
            className={PAIRS}
            items={candidate.files.map((f) => [
              f.kind === "resume" ? "Resume" : "Attachment",
              <a
                key={f.fileId}
                href={fileHref(f.fileId)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(textLink, "min-w-0 text-[13px] text-foreground")}
                title={[f.filename, fileSize(f.sizeBytes), f.uploadedBy, ago(f.uploadedAt, now)].filter(Boolean).join(", ")}
              >
                <span className="truncate">{f.filename}</span>
              </a>,
            ])}
          />
        )}
      </Facet>
    </aside>
  );
}
