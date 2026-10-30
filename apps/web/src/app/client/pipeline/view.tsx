import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { Empty, Page, PageBar, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import { Board, FilterKeys } from "./board";
import type { BoardColumn } from "./board-state";

// The Pipeline board's markup, props only (page.tsx does the reads), as
// design/tats's Pipeline: the bar (people icon, "Pipeline", the count faint),
// then one sub-bar with the department tabs on the left (none for an org
// without departments) and the job chip and the name filter on the right,
// then the board (board.tsx), one column per computed stage filling the width,
// each a band with its count and up to a dozen calm cards. A card is the
// person, their job (or headline, once one job is picked), one status line and
// the owner. Colour only for meaning: a stalled card's status reads red.

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
  departments,
  job,
  search,
  empty,
}: {
  total: number;
  columns: BoardColumn[];
  /** Empty for an org with no departments: no filter at all. */
  departments: Tab[];
  /** The job chip; null when there is no open job to pick. */
  job: { value: string; on: boolean; options: FilterOption[] } | null;
  search: { q: string; job: string | null; department: string | null };
  empty: string | null;
}) {
  return (
    <Page
      bar={
        <>
          <PageBar title="Pipeline" icon={<PeopleIcon />} count={total.toLocaleString("en-US")} />
          <SubBar>
            {departments.length ? <Tabs label="Departments" tabs={departments} /> : <span />}
            <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full">
              {job ? <FilterMenu label="Job" {...job} /> : null}
              <SearchBox
                action="/client/pipeline"
                defaultValue={search.q}
                placeholder="Filter by name"
                label="Filter by name"
                keep={{ department: search.department, job: search.job }}
              />
            </div>
          </SubBar>
        </>
      }
    >
      <FilterKeys />
      {empty ? <Empty>{empty}</Empty> : <Board columns={columns} />}
    </Page>
  );
}
