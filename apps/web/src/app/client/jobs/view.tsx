import Link from "next/link";
import { ChevronDown, FileText, Plus, Target } from "lucide-react";
import { Header } from "@/components/tickets/header";
import { CareersLink } from "./careers-link";

// Listings & Asks (design/tacit-tickets's Asks), props only (page.tsx does the
// reads): the careers page as applicants see it, "Careers at <org>", a band per
// department that folds (a <details>, no script) with a + on hover to add a role
// to it, and a row per job: its title, its post's state when it is not live, how
// many are in its pipeline and where it is. The row opens the posting, where
// whoever manages the job edits it (and shares its link); "Add A Role" and each
// band's + open the empty editor for an admin. Hy's rule: no stray stats on a
// post, so how many applied lives in Insights.

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

function Row({ row }: { row: PostingRowProps }) {
  // Live and taking applications says nothing; anything else says so, as the prototype's chip.
  const live = row.post.tone === "green" && !row.jobStatus;
  const state = row.jobStatus ? `Job ${row.jobStatus.replace(/_/g, " ")}` : row.post.label;
  return (
    <Link href={`/client/jobs/${row.jobId}/post`} className="flex h-[52px] w-full items-center gap-3 border-b border-line pr-2 pl-8 text-left transition-colors hover:bg-hover">
      <FileText size={15} className="shrink-0 text-dim" />
      <span className={`min-w-0 flex-1 truncate font-medium ${row.title ? "text-ink" : "text-dim"}`}>
        {row.title || "Untitled"}
        {row.morePosts > 0 && <span className="ml-2 text-xs font-normal text-dim">+{row.morePosts} more {row.morePosts === 1 ? "post" : "posts"}</span>}
      </span>
      {!live && (
        <span title={row.post.title} className="shrink-0 rounded-md bg-sel px-1.5 py-px text-xs text-mute capitalize">
          {state}
        </span>
      )}
      <span className="w-[120px] shrink-0 text-mute tabular-nums @max-2xl:hidden">{row.inPipeline ? `${row.inPipeline} in pipeline` : ""}</span>
      <span className="w-[120px] shrink-0 truncate text-mute @max-xl:hidden">{row.location ?? ""}</span>
    </Link>
  );
}

export function JobPostingsView({
  orgName,
  careersUrl,
  total,
  live,
  groups,
  empty,
  canAdd,
  team = null,
}: {
  orgName: string;
  /** The public board's address, while it has a live post to show. */
  careersUrl: string | null;
  total: number;
  live: number;
  groups: PostingGroupProps[];
  empty: string;
  /** "Add A Role": making a job is an admin's. */
  canAdd: boolean;
  /** The team picked in the sidebar, by name. */
  team?: string | null;
}) {
  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
        <Header scope={team} title="Listings & Asks" right={careersUrl ? <CareersLink url={careersUrl} /> : null} />
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-8 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
                <Target size={18} />
              </span>
              <div className="mt-4 font-medium text-ink">No roles yet</div>
              <p className="mt-1.5 max-w-[320px] text-mute">{empty}</p>
              {canAdd && (
                <Link href="/client/jobs/new" data-tour="add-role" className="mt-4 flex h-7 items-center gap-1.5 rounded-md bg-ink px-2.5 font-medium text-well transition hover:opacity-90">
                  <Plus size={14} /> Add A Role
                </Link>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-[820px] px-8 pt-14 pb-16 @max-2xl:px-5 @max-2xl:pt-9">
              <h2 className="text-center text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink @max-2xl:text-[26px]" title={`${total} ${total === 1 ? "role" : "roles"}, ${live} live`}>
                Careers at {orgName}
              </h2>
              <div className="mt-10 flex justify-end">
                {canAdd && (
                  <Link href="/client/jobs/new" data-tour="add-role" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-mute transition-colors hover:bg-hover hover:text-ink">
                    <Plus size={14} /> Add A Role
                  </Link>
                )}
              </div>
              <div className="mt-1 border-t border-line">
                {groups.map((g) =>
                  g.name === null ? (
                    <div key={g.key}>
                      {g.rows.map((r) => (
                        <Row key={r.jobId} row={r} />
                      ))}
                    </div>
                  ) : (
                    <details key={g.key} open className="group">
                      <summary className="flex h-12 cursor-default list-none items-center border-b border-line pr-1 [&::-webkit-details-marker]:hidden">
                        <span className="-ml-1 flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md pl-1 text-left">
                          <ChevronDown size={14} className="shrink-0 text-dim transition-transform group-[:not([open])]:-rotate-90" />
                          <span className="truncate font-medium text-ink">{g.name}</span>
                          <span className="text-dim tabular-nums">{g.rows.length}</span>
                        </span>
                        {canAdd && g.key !== "other" && (
                          <Link
                            href={`/client/jobs/new?department=${g.key}`}
                            aria-label={`Add a role to ${g.name}`}
                            title="Add A Role"
                            className="flex size-7 items-center justify-center rounded-md text-mute opacity-0 transition group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
                          >
                            <Plus size={15} />
                          </Link>
                        )}
                      </summary>
                      {g.rows.map((r) => (
                        <Row key={r.jobId} row={r} />
                      ))}
                    </details>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
