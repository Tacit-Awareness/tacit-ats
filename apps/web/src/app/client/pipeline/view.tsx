import Link from "next/link";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { Empty, Page, PageBar, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import { Board, FilterKeys } from "./board";
import type { BoardColumn } from "./board-state";
import { ListZero, PipelineList, StageBar, type ListGroup, type StageCard } from "./list";
import { ViewName } from "./view-name";

// The Pipeline's markup, props only (page.tsx does the reads), as design/tats's
// Pipeline: the bar (people icon, "Pipeline", the count faint, Stuck / Everyone),
// then one sub-bar with the department tabs on the left (none for an org
// without departments) and the job chip and the name filter on the right. Under
// that, across jobs, the stage bar and one row per person (list.tsx). A board
// only reads for one job, so once one is picked it is the board (board.tsx):
// one column per computed stage filling the width, each a band with its count
// and up to a dozen calm cards. A card is the person, their headline, one status
// line and the owner. Colour only for meaning: a stalled person reads red. On a
// saved view the crumb is Views, then its name; the bar's Views link goes there.

/** Under the sub-bar when no job is picked. `zero` when nobody is left to list. */
export type PipelineListProps = {
  modes: Tab[];
  stages: StageCard[];
  groups: ListGroup[];
  zero: { title: string; note: string; action: { href: string; label: string } | null } | null;
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8" />
    </svg>
  );
}

export function PipelineView({
  total,
  columns,
  list,
  departments,
  job,
  search,
  view,
  empty,
  capped,
}: {
  total: number;
  /** The board, for one job. */
  columns: BoardColumn[];
  /** The list, across jobs; null once a job is picked. */
  list: PipelineListProps | null;
  /** Empty for an org with no departments: no filter at all. */
  departments: Tab[];
  /** The job chip; null when there is no open job to pick. */
  job: { value: string; on: boolean; options: FilterOption[] } | null;
  search: { q: string; keep: Record<string, string | null> };
  /** A saved view is on: its id, and what the URL's filters say for a view this browser does not have. */
  view: { id: string | null; fallback: string } | null;
  empty: string | null;
  /** A job is past what the board can read (`PipelineRead`). */
  capped: boolean;
}) {
  return (
    <Page
      bar={
        <>
          <PageBar
            title={view ? <ViewName id={view.id} fallback={view.fallback} /> : "Pipeline"}
            icon={view ? undefined : <PeopleIcon />}
            crumbs={view ? [{ href: "/client/views", label: "Views" }] : undefined}
            count={total.toLocaleString("en-US")}
          >
            {list && !empty ? <Tabs label="Show" tabs={list.modes} /> : null}
            <Link
              href="/client/views"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[14px]" aria-hidden>
                <path d="M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3" />
              </svg>
              Views
            </Link>
          </PageBar>
          <SubBar>
            {departments.length ? <Tabs label="Departments" tabs={departments} /> : <span />}
            <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full">
              {job ? <FilterMenu label="Job" {...job} /> : null}
              <SearchBox
                action="/client/pipeline"
                defaultValue={search.q}
                placeholder="Filter by name"
                label="Filter by name"
                keep={search.keep}
              />
            </div>
          </SubBar>
        </>
      }
    >
      {capped ? <p className="m-0 mb-3 text-[12.5px] text-faint">A job has more than 1,000 applications, so this board may stop short of the people touched most recently.</p> : null}
      <FilterKeys />
      {empty ? (
        <Empty>{empty}</Empty>
      ) : list ? (
        <>
          <StageBar stages={list.stages} />
          {list.zero ? <ListZero {...list.zero} /> : <PipelineList groups={list.groups} />}
        </>
      ) : (
        <Board columns={columns} />
      )}
    </Page>
  );
}
