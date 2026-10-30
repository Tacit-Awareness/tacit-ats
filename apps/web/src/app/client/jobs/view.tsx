import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Empty, Page, PageHeader, Pill, Section, textLink } from "@/components/page";
import { cn } from "@/lib/utils";

// Job Postings' markup, props only (page.tsx does the reads): design/tats's
// #jobs, the careers page as applicants see it. One list, a folding band per
// department (a <details>, so no script), and a row per job: its title over
// its location, how many applied and are in its pipeline, its post's state,
// and the public link while the post takes applications. The row opens the
// posting; "Board" opens the job's pipeline.

export type PostingRowProps = {
  jobId: string;
  title: string;
  location: string | null;
  /** Shown beside the post's pill when the job itself is not open. */
  jobStatus: string | null;
  post: { label: string; tone: "green" | "grey"; title: string };
  /** The public page's path and absolute URL, only while it takes applications. */
  link: { path: string; url: string } | null;
  applied: number | null;
  inPipeline: number | null;
  /** More than one post on the job. */
  morePosts: number;
};

export type PostingGroupProps = { key: string; name: string | null; rows: PostingRowProps[] };

const icon = "size-3.5 flex-none fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]";

function Row({ row }: { row: PostingRowProps }) {
  const counts = [
    row.applied !== null ? `${row.applied} applied` : null,
    row.inPipeline !== null && row.inPipeline > 0 ? `${row.inPipeline} in pipeline` : null,
  ].filter(Boolean);
  return (
    <li className="relative grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--line)] py-2.5 pr-3 pl-4 transition-colors hover:bg-accent sm:grid-cols-[16px_minmax(0,1fr)_auto_auto_auto] sm:pl-9">
      <svg viewBox="0 0 16 16" className={cn(icon, "text-faint")} aria-hidden>
        <path d="M4 1.75h5.5L12.5 4.75v9.5h-8.5z M9.25 1.75v3.25h3.25" />
      </svg>
      <Link
        href={`/client/jobs/${row.jobId}/post`}
        className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13.5px] after:absolute after:inset-0"
      >
        <b className={cn("truncate font-medium", row.jobStatus && "text-muted-foreground")}>{row.title}</b>
        <span className="truncate text-faint">{row.location ?? "No location"}</span>
        {row.morePosts > 0 ? <span className="text-xs text-faint">+{row.morePosts} more {row.morePosts === 1 ? "post" : "posts"}</span> : null}
      </Link>
      <span className="hidden font-mono text-[12px] text-faint tabular-nums sm:block">{counts.join(" · ")}</span>
      <span className="flex items-center gap-1.5">
        {row.jobStatus ? <Pill title="The job itself, apart from its post">Job {row.jobStatus.replace(/_/g, " ")}</Pill> : null}
        <Pill tone={row.post.tone} title={row.post.title}>
          {row.post.label}
        </Pill>
      </span>
      <span className="relative z-10 hidden items-center gap-1 sm:flex">
        {row.link ? (
          <>
            <a href={row.link.path} target="_blank" rel="noreferrer" className={textLink} title="Open the public page">
              <svg viewBox="0 0 16 16" className={icon} aria-hidden>
                <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
              </svg>
              Public link
            </a>
            <CopyButton value={row.link.url} label="Copy the public link" />
          </>
        ) : null}
        <Link href={`/client/jobs/${row.jobId}`} className={cn(textLink, "ml-2")}>
          Board
        </Link>
      </span>
    </li>
  );
}

export function JobPostingsView({
  orgName,
  total,
  live,
  groups,
  empty,
  connectorNote,
}: {
  orgName: string;
  total: number;
  live: number;
  groups: PostingGroupProps[];
  empty: string;
  /** Whether to say where posts are written: not for an interviewer, who cannot. */
  connectorNote: boolean;
}) {
  return (
    <Page narrow>
      <PageHeader title="Job Postings" subtitle={`${live} taking applications. Each job's post as applicants see it, by department.`} />
      <h2 className="m-0 py-4 text-center text-[32px] leading-tight font-medium tracking-[-0.025em] sm:text-[40px]">Careers at {orgName}</h2>
      <Section title={`${total} ${total === 1 ? "job" : "jobs"}`} flush>
        {groups.length === 0 ? (
          <Empty className="px-4 py-3">{empty}</Empty>
        ) : (
          groups.map((g) =>
            g.name === null ? (
              <ul key={g.key} className="m-0 list-none p-0 [&>li:first-child]:border-t-0">
                {g.rows.map((r) => (
                  <Row key={r.jobId} row={r} />
                ))}
              </ul>
            ) : (
              <details key={g.key} open className="group border-t border-[color:var(--line)] first:border-t-0">
                <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13.5px] select-none hover:bg-accent [&::-webkit-details-marker]:hidden">
                  <svg viewBox="0 0 16 16" className={cn(icon, "size-[11px] -rotate-90 text-faint transition-transform group-open:rotate-0")} aria-hidden>
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                  <svg viewBox="0 0 16 16" className={cn(icon, "text-muted-foreground")} aria-hidden>
                    <path d="M1.75 3.75h4.5l1.5 1.5h6.5v7h-12.5z" />
                  </svg>
                  <b className="font-medium">{g.name}</b>
                  <span className="text-faint">{g.rows.length}</span>
                </summary>
                <ul className="m-0 list-none p-0">
                  {g.rows.map((r) => (
                    <Row key={r.jobId} row={r} />
                  ))}
                </ul>
              </details>
            ),
          )
        )}
      </Section>
      {connectorNote ? (
        <p className="m-0 text-center text-xs text-faint">
        Posts are written and published from your Claude connector for now (<code className="font-mono">create_job_post</code>,{" "}
        <code className="font-mono">update_job_post</code>, <code className="font-mono">set_job_post_status</code>).
        </p>
      ) : null}
    </Page>
  );
}
