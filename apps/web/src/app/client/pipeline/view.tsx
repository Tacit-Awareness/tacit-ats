import Link from "next/link";
import { Avatar, Empty, Page, PageHeader, Tabs, Toolbar, type Tab } from "@/components/page";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The Pipeline board's markup, props only (page.tsx does the reads):
// department tabs (none for an org without departments), job tabs and a
// filter above design/tats's board, one column per computed stage,
// each a band with its count and up to a dozen cards. A card is the person,
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

function Card({ card }: { card: BoardCard }) {
  return (
    <Link
      href={card.href}
      className="grid gap-1 rounded-lg border border-[color:var(--line)] bg-card p-3 shadow-[var(--shadow)] transition-colors hover:border-[color:var(--line-strong)]"
    >
      <span className="truncate text-[14px] leading-[18px] font-medium">{card.name}</span>
      <span className="truncate text-[12.5px] text-muted-foreground">{card.line}</span>
      <span className="mt-1 flex min-w-0 items-center gap-2 text-[12.5px]">
        <span
          className={cn("min-w-0 flex-1 truncate", card.stalled ? "text-negative" : "text-muted-foreground")}
          title={card.stalled ? "Needs attention: overdue, or untouched for a while" : undefined}
        >
          {card.status}
        </span>
        {card.ownerName ? (
          <span title={card.ownerName}>
            <Avatar name={card.ownerName} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function Column({ column }: { column: BoardColumn }) {
  return (
    <section aria-label={column.label} className="grid w-[184px] shrink-0 content-start gap-2 rounded-lg bg-[color:var(--band)] p-1">
      <h2 className="m-0 flex h-[30px] items-center gap-2 px-1.5 text-[14px] font-medium">
        {column.label}
        <span className="font-normal text-muted-foreground">{column.total}</span>
      </h2>
      {column.cards.length === 0 ? <p className="m-0 px-1.5 pb-2 text-[12.5px] text-faint">Nobody</p> : null}
      {column.cards.map((card) => (
        <Card key={card.applicationId} card={card} />
      ))}
      {column.more ? (
        <Link href={column.more.href} className="rounded-md px-1.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground">
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
  jobs,
  search,
  empty,
}: {
  total: number;
  columns: BoardColumn[];
  /** Empty for an org with no departments: no filter at all. */
  departments: Tab[];
  jobs: Tab[];
  search: { q: string; job: string | null; department: string | null };
  empty: string | null;
}) {
  return (
    <Page>
      <PageHeader title="Pipeline" badge={<span className="text-base font-normal text-muted-foreground">{total}</span>} />
      {departments.length ? <Tabs label="Departments" tabs={departments} /> : null}
      <Toolbar>
        <Tabs label="Jobs" tabs={jobs} />
        {/* A plain GET form: the filter is in the URL, like the tabs. */}
        <form action="/client/pipeline" method="get" role="search" className="w-full sm:w-56">
          {search.department ? <input type="hidden" name="department" value={search.department} /> : null}
          {search.job ? <input type="hidden" name="job" value={search.job} /> : null}
          <Input name="q" defaultValue={search.q} placeholder="Filter by name" aria-label="Filter by name" />
        </form>
      </Toolbar>
      {empty ? (
        <Empty>{empty}</Empty>
      ) : (
        <div data-tour="board" className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
          <div className="flex items-start gap-2">
            {columns.map((column) => (
              <Column key={column.key} column={column} />
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
