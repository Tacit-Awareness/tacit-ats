import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { ShareLinks } from "./share-links";
import { Empty, Page, PageBar, textLink } from "@/components/page";
import { cn } from "@/lib/utils";

// Job Postings' markup, props only (page.tsx does the reads): design/tats's
// #jobs, the careers page as applicants see it. One list, a folding band per
// department (a <details>, so no script), and a row per job: its title over
// its location, how many are in its pipeline, its post's state when it is
// not live, and (on hover) the public link while the post takes applications. The row opens the
// posting, where whoever manages the job edits it; "Board" opens the job's
// pipeline. "Add a role" and each band's + open the empty editor for an admin.

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

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className={cn(icon, "size-[13px]")} aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** design/tats's `.jp-row`: 48px, ruled underneath, the actions only on hover. */
function Row({ row }: { row: PostingRowProps }) {
  // Live and taking applications says nothing; anything else says so, muted, as the prototype's "Paused".
  const live = row.post.tone === "green" && !row.jobStatus;
  const state = row.jobStatus ? `Job ${row.jobStatus.replace(/_/g, " ")}` : row.post.label;
  const counted = row.applied !== null ? `${row.applied} applied through the post` : undefined;
  return (
    <li className="group/row relative grid h-12 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--line)] pr-2.5 pl-[26px] transition-colors hover:bg-[color:var(--hover)] sm:grid-cols-[16px_minmax(0,1fr)_auto_auto_auto] sm:pl-[34px]">
      <svg viewBox="0 0 16 16" className={cn(icon, "text-faint")} aria-hidden>
        <path d="M4 1.75h5.5L12.5 4.75v9.5h-8.5z M9.25 1.75v3.25h3.25" />
      </svg>
      <Link href={`/client/jobs/${row.jobId}/post`} className="flex min-w-0 items-baseline gap-2 text-[13.5px] after:absolute after:inset-0">
        <b className={cn("truncate font-medium", !live && "text-muted-foreground")}>{row.title}</b>
        {!live ? (
          <span className="whitespace-nowrap text-faint" title={row.post.title}>
            {state}
          </span>
        ) : null}
        {row.morePosts > 0 ? <span className="text-xs whitespace-nowrap text-faint">+{row.morePosts} more {row.morePosts === 1 ? "post" : "posts"}</span> : null}
      </Link>
      <span className="hidden text-[12.5px] text-faint tabular-nums sm:block" title={counted}>
        {row.inPipeline ? `${row.inPipeline} in pipeline` : ""}
      </span>
      <span className="truncate text-[13px] text-muted-foreground">{row.location ?? ""}</span>
      <span className="relative z-10 hidden items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 sm:flex">
        {row.link ? (
          <>
            <a href={row.link.path} target="_blank" rel="noreferrer" className={textLink} title="Open the public page">
              <svg viewBox="0 0 16 16" className={icon} aria-hidden>
                <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
              </svg>
              Public link
            </a>
            <CopyButton value={row.link.url} label="Copy the public link" />
            <ShareLinks url={row.link.url} />
          </>
        ) : null}
        <Link href={`/client/jobs/${row.jobId}`} className={cn(textLink, "ml-2 font-medium")}>
          Board
        </Link>
      </span>
    </li>
  );
}

export function JobPostingsView({
  orgName,
  careersPath,
  total,
  live,
  groups,
  empty,
  canAdd,
}: {
  orgName: string;
  /** The public board, while it has a live post to show. */
  careersPath: string | null;
  total: number;
  live: number;
  groups: PostingGroupProps[];
  empty: string;
  /** "Add a role": making a job is an admin's. */
  canAdd: boolean;
}) {
  return (
    <Page narrow bar={(
        <PageBar title="Job Postings" count={`${live} live`}>
          {careersPath ? (
            <Link href={careersPath} target="_blank" className={textLink}>
              Careers page
            </Link>
          ) : null}
        </PageBar>
      )} className="gap-0 px-4 pt-8 pb-16 sm:px-6 sm:pt-14 sm:pb-20 md:px-6">
      <h2 className="m-0 mb-7 text-center text-[30px] leading-[1.1] font-medium tracking-[-0.025em] sm:mb-11 sm:text-[40px]">Careers at {orgName}</h2>
      <div>
        <div className="flex h-11 items-center gap-2 border-b border-[color:var(--line)] px-2.5 text-[13px] text-faint">
          {total} {total === 1 ? "role" : "roles"}
          {canAdd ? (
            <Link
              href="/client/jobs/new"
              data-tour="add-role"
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
            >
              <PlusIcon />
              Add a role
            </Link>
          ) : null}
        </div>
        {groups.length === 0 ? (
          <Empty className="px-2.5 py-3">{empty}</Empty>
        ) : (
          groups.map((g) =>
            g.name === null ? (
              <ul key={g.key} className="m-0 list-none p-0">
                {g.rows.map((r) => (
                  <Row key={r.jobId} row={r} />
                ))}
              </ul>
            ) : (
              <details key={g.key} open className="group">
                <summary className="flex h-11 cursor-pointer list-none items-center gap-2 border-b border-[color:var(--line)] px-2.5 text-[13.5px] select-none hover:bg-[color:var(--hover)] [&::-webkit-details-marker]:hidden">
                  <svg viewBox="0 0 16 16" className={cn(icon, "size-[11px] -rotate-90 text-faint transition-transform group-open:rotate-0")} aria-hidden>
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                  <svg viewBox="0 0 16 16" className={cn(icon, "text-muted-foreground")} aria-hidden>
                    <path d="M1.75 3.75h4.5l1.5 1.5h6.5v7h-12.5z" />
                  </svg>
                  <b className="font-medium">{g.name}</b>
                  <span className="text-faint">{g.rows.length}</span>
                  {canAdd && g.key !== "other" ? (
                    <Link
                      href={`/client/jobs/new?department=${g.key}`}
                      aria-label={`Add a role to ${g.name}`}
                      title={`Add a role to ${g.name}`}
                      className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
                    >
                      <PlusIcon />
                    </Link>
                  ) : null}
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
      </div>
    </Page>
  );
}
