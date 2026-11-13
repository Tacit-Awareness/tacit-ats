import Link from "next/link";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { LiveRefresh } from "@/components/live-refresh";
import { Empty, Notice, Page, PageBar, SearchBox, Section, SubBar, Tabs, pillOption, pillTrack, type Tab } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Board, FilterKeys, LayoutKey } from "./board";
import type { BoardColumn } from "./board-state";
import { ListZero, PipelineList, StageBar, type ListGroup, type StageCard } from "./list";
import { ViewName } from "./view-name";

// The Pipeline's markup, props only (page.tsx does the reads), as design/tats's
// Pipeline drawn in Testbench's staff design: the title row ("Applicant
// Tickets", the count in a tile, Stuck / Everyone with their counts over the
// corners, the List / Board switch, Views), then one sub-bar with the department
// tabs on the left (none for an org without departments) and the job chip and
// the name filter on the right. Under that, the stage bar and one white card of
// tickets (list.tsx), a row opening the candidate in a pop-up (popup.tsx). A
// board only reads for one job, so once one is picked the bar's List / Board
// switch (B) has both, and it opens on the board (board.tsx): one well per
// computed stage filling the width, each with its count and up to a dozen calm
// cards. A card is the person, their headline, one status line and the owner.
// Colour only for meaning: a stalled person reads red. On a saved view the crumb
// is Views, then its name; the bar's Views link goes there. A name filter that
// finds closed applications says how many, under the sub-bar, and leads to the
// CRM, where they live.

/** Under the sub-bar when no job is picked. `zero` when nobody is left to list. */
export type PipelineListProps = {
  modes: Tab[];
  stages: StageCard[];
  groups: ListGroup[];
  /** The rows span more than one team, so each says its team in a column of its own. */
  teams?: boolean;
  zero: { title: string; note: string; action: { href: string; label: string } | null } | null;
};

/** The bar's switch (Testbench's `.seg`). `board` is null across jobs, where there is nothing to draw one of. */
export type LayoutSwitch = { on: "list" | "board"; list: string; board: string | null };

const LAYOUT_ICONS = {
  list: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  board: "M2.5 3h3v10h-3ZM6.5 3h3v7h-3ZM10.5 3h3v5h-3Z",
};

function LayoutIcon({ name }: { name: keyof typeof LAYOUT_ICONS }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[15px]" aria-hidden>
      <path d={LAYOUT_ICONS[name]} />
    </svg>
  );
}

const NO_BOARD = "Pick one job to see it as a board";

function LayoutSwitcher({ layout }: { layout: LayoutSwitch }) {
  const option = (on: boolean) => cn(pillOption(on), "px-2.5");
  return (
    <nav aria-label="Layout" className={pillTrack}>
      <Link href={layout.list} aria-label="List" title="List" aria-current={layout.on === "list" ? "page" : undefined} className={option(layout.on === "list")}>
        <LayoutIcon name="list" />
      </Link>
      {layout.board ? (
        <Link href={layout.board} aria-label="Board" title="Board (B)" aria-keyshortcuts="B" aria-current={layout.on === "board" ? "page" : undefined} className={option(layout.on === "board")}>
          <LayoutIcon name="board" />
        </Link>
      ) : (
        <button type="button" disabled aria-label="Board" title={NO_BOARD} className={cn(option(false), "cursor-not-allowed opacity-35 hover:text-muted-foreground")}>
          <LayoutIcon name="board" />
        </button>
      )}
    </nav>
  );
}

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
  layout,
  popup,
  past,
}: {
  total: number;
  /** The board, for one job. */
  columns: BoardColumn[];
  /** The list: across jobs, or a job with the switch on List. Null on the board. */
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
  layout: LayoutSwitch;
  /** A row's pop-up, when `?open=` names one on the list. */
  popup?: React.ReactNode;
  /** A name filter's closed applications; null with none, or no filter. */
  past?: { href: string; label: string } | null;
}) {
  return (
    <Page
      bar={
        <>
          <PageBar
            title={view ? <ViewName id={view.id} fallback={view.fallback} /> : "Applicant Tickets"}
            icon={view ? undefined : <PeopleIcon />}
            crumbs={view ? [{ href: "/client/views", label: "Views" }] : undefined}
            count={total.toLocaleString("en-US")}
          >
            {list && !empty ? <Tabs label="Show" tabs={list.modes} /> : null}
            {empty ? null : <LayoutSwitcher layout={layout} />}
            <Link href="/client/views" className={buttonVariants({ variant: "ghost", size: "sm" })}>
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
      {capped ? <Notice>A job has more than 1,000 applications, so this board may stop short of the people touched most recently.</Notice> : null}
      {past ? (
        <Link
          href={past.href}
          className="flex items-center gap-2.5 rounded-[10px] bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-[var(--shadow-sm)] transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[14px] shrink-0" aria-hidden>
            <path d="M2.5 4c0-1 2.5-1.5 5.5-1.5s5.5.5 5.5 1.5-2.5 1.5-5.5 1.5S2.5 5 2.5 4ZM2.5 4v8c0 1 2.5 1.5 5.5 1.5s5.5-.5 5.5-1.5V4M2.5 8c0 1 2.5 1.5 5.5 1.5s5.5-.5 5.5-1.5" />
          </svg>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{past.label}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-[13px] shrink-0" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      ) : null}
      <LiveRefresh />
      <FilterKeys enabled={!popup} />
      {empty ? null : <LayoutKey to={layout.on === "list" ? layout.board : layout.list} refusal={NO_BOARD} enabled={!popup} />}
      {empty ? (
        <Section>
          <Empty className="m-0">{empty}</Empty>
        </Section>
      ) : list ? (
        <>
          <StageBar stages={list.stages} />
          {list.zero ? <ListZero {...list.zero} /> : <PipelineList groups={list.groups} popup={!!popup} teams={!!list.teams} />}
        </>
      ) : (
        <Board columns={columns} />
      )}
      {popup}
    </Page>
  );
}
