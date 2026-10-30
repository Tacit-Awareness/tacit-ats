import Link from "next/link";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { Avatar, Empty, Page, PageBar, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import { cn } from "@/lib/utils";

// The Pipeline board's markup, props only (page.tsx does the reads), as
// design/tats's Pipeline: the bar (people icon, "Pipeline", the count faint),
// then one sub-bar with the department tabs on the left (none for an org
// without departments) and the job chip and the name filter on the right,
// then the board, one column per computed stage filling the width, each a
// band with its count and up to a dozen calm cards. A card is the person,
// their job (or headline, once one job is picked), one status line and the
// owner. Colour only for meaning: a stalled card's status reads red.

export type BoardCard = {
  applicationId: string;
  href: string;
  name: string;
  line: string;
  status: string;
  ownerName: string | null;
  stalled: boolean;
};

export type BoardColumn = {
  key: string;
  label: string;
  total: number;
  cards: BoardCard[];
  more: { href: string; label: string } | null;
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8" />
    </svg>
  );
}

/** design/tats's `.card.calm`: 12px padding, 4px between lines, the footer 4px further down with a 20px owner. */
function Card({ card }: { card: BoardCard }) {
  return (
    <Link
      href={card.href}
      className="grid gap-1 rounded-lg border border-[color:var(--line)] bg-[color:var(--paper)] p-3 shadow-[var(--shadow)] transition-colors hover:border-[color:var(--line-strong)]"
    >
      <span className="truncate text-[14px] leading-[1.3] font-medium">{card.name}</span>
      <span className="truncate text-[12.5px] text-muted-foreground">{card.line}</span>
      <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12.5px]">
        <span
          className={cn("min-w-0 truncate", card.stalled ? "text-negative" : "text-muted-foreground")}
          title={card.stalled ? "Needs attention: overdue, or untouched for a while" : undefined}
        >
          {card.status}
        </span>
        {card.ownerName ? (
          <span title={card.ownerName} className="shrink-0">
            <Avatar name={card.ownerName} size="xs" />
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** design/tats's `.col`: `flex: 1 1 0`, at least 184px wide and 300px high, so an empty one is a blank band. */
function Column({ column }: { column: BoardColumn }) {
  return (
    <section aria-label={column.label} className="flex min-h-[300px] min-w-[184px] flex-[1_1_0] flex-col gap-2 rounded-lg bg-[color:var(--band)] p-1">
      <h2 className="m-0 flex h-[30px] shrink-0 items-center gap-2 px-1.5 text-[14px] font-medium">
        {column.label}
        <span className="font-normal text-faint tabular-nums">{column.total}</span>
      </h2>
      {column.cards.map((card) => (
        <Card key={card.applicationId} card={card} />
      ))}
      {column.more ? (
        <Link
          href={column.more.href}
          className="grid h-[30px] place-items-center rounded-md text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          {column.more.label}
        </Link>
      ) : null}
    </section>
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
      {empty ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
          <div className="flex min-w-full items-start gap-2">
            {columns.map((column) => (
              <Column key={column.key} column={column} />
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
