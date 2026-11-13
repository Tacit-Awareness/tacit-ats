import Link from "next/link";
import { KeyList } from "@/components/keys";
import { Empty, Page, PageBar, Pill, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import { hoverAttr } from "@/lib/hover-card";
import type { BulkItem } from "@/lib/client/crm-bulk-rules";
import { cn } from "@/lib/utils";
import { BulkBar, BulkKeys, PageCheck, RowCheck, type BulkOptions } from "./bulk";
import { Icon, type IconName } from "./icons";
import { LocalDay } from "./local-day";

// The CRM's markup, props only (page.tsx does the reads), as design/tats's
// CRM drawn in Testbench's staff design: the title row ("CRM", the count in a
// tile), department tabs under it when the org has departments, then the views
// as a segmented control with their counts over the corners and the search on
// the right, then the table in one white card: a sticky header in faint Geist
// Mono, 48px rows ruled by hairlines (no rules between cells), the column
// headers sorting by link (the URL is the state), 50 rows a page with the range
// and arrows in the footer. It fits the panel at 1280px and up, every column
// kept: a long value truncates and says itself in full on hover. A row opens
// the candidate page: its name is the link, stretched over the row, so the row
// can hold a checkbox too. J/K move between rows, Enter opens one
// (components/keys.tsx) and X selects one; the bulk actions are bulk.tsx, which
// keeps the selection in the browser.

export type CrmViewRow = {
  href: string;
  name: string;
  jobs: string[];
  /** "in/handle" from their LinkedIn URL, or the URL as typed; text, never a link (the row is the link). */
  profile: string | null;
  stage: string;
  stageTone: "green" | "grey";
  ownerName: string | null;
  lastTouchAt: string;
  /** Shown until the browser knows its time zone: "3d ago". */
  lastTouch: string;
  /** The row as a selection keeps it. */
  bulk: BulkItem;
};

/** `icon` is design/tats's column icon; Testbench's table heads carry none, so it isn't drawn. */
export type CrmColumn = { key: string; label: string; icon: IconName; href: string | null; sorted: "asc" | "desc" | null };

// design/tats's `.crm-r` columns, less its Testbench one, tightened for Geist
// Mono so all of them fit a 1280px window: a 786px floor, the spare width going
// to the text columns.
const GRID = "grid grid-cols-[40px_minmax(130px,1fr)_minmax(140px,1.5fr)_minmax(110px,0.9fr)_128px_minmax(110px,0.8fr)_128px]";
// A cell: 12px in, one line, the overflow cut with an ellipsis by the text inside it.
const CELL = "flex h-full min-w-0 items-center overflow-hidden px-3 whitespace-nowrap";

function Arrow({ href, label, dir }: { href: string | null; label: string; dir: "prev" | "next" }) {
  const d = dir === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5";
  const icon = (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d={d} />
    </svg>
  );
  const cls = "grid size-[30px] place-items-center rounded-[7px]";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={cn(cls, "text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground")}>
      {icon}
    </Link>
  ) : (
    <span aria-hidden className={cn(cls, "text-[color:var(--ink-4)] opacity-50")}>
      {icon}
    </span>
  );
}

/** A column head: its label, the sort's arrow when it sorts by it. A sortable one is a link with a hover, so it reads as one. */
function HeadCell({ c, end }: { c: CrmColumn; end?: boolean }) {
  const body = (
    <>
      {c.label}
      {c.sorted ? <span aria-hidden>{c.sorted === "asc" ? "↑" : "↓"}</span> : null}
    </>
  );
  return (
    <span role="columnheader" aria-sort={c.sorted === "asc" ? "ascending" : c.sorted === "desc" ? "descending" : "none"} className={cn(CELL, "px-1.5", end && "justify-end")}>
      {c.href ? (
        <Link
          href={c.href}
          title={`Sort by ${c.label.toLowerCase()}`}
          className={cn("inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 transition-colors hover:bg-[color:var(--hover)] hover:text-foreground", c.sorted && "text-foreground")}
        >
          {body}
        </Link>
      ) : (
        <span className="inline-flex h-7 min-w-0 items-center gap-1.5 px-1.5">{body}</span>
      )}
    </span>
  );
}

export function CrmView({
  departments,
  views,
  viewLabel,
  columns,
  rows,
  total,
  range,
  prev,
  next,
  search,
  note,
  empty,
  bulk,
}: {
  /** Empty for an org with no departments: no filter at all. */
  departments: Tab[];
  views: Tab[];
  viewLabel: string;
  columns: CrmColumn[];
  rows: CrmViewRow[];
  total: number;
  range: string;
  prev: string | null;
  next: string | null;
  /** The search, and the other params a GET form must carry. */
  search: { q: string; hidden: Record<string, string> };
  /** A line in the footer, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** What the bulk actions offer: the org's rejection reasons, tags and pools. */
  bulk: BulkOptions;
}) {
  const items = rows.map((r) => r.bulk);
  return (
    <Page
      bar={
        <>
          <PageBar title="CRM" icon={<Icon name="db" />} count={total.toLocaleString("en-US")} />
          {departments.length ? (
            <SubBar>
              <Tabs label="Departments" tabs={departments} />
            </SubBar>
          ) : null}
          <SubBar>
            <Tabs strip label="Views" tabs={views} />
            <SearchBox action="/client/candidates" defaultValue={search.q} placeholder="Search by name" label="Search candidates" keep={search.hidden} />
          </SubBar>
        </>
      }
    >
      {/* Testbench's card, not clipped: the header sticks to the page as it scrolls, so it takes the card's top corners itself,
          and sits above the rows' raised names and boxes (z-1) and the bulk bar (z-2) as they pass under it. */}
      <section aria-label={viewLabel} className="min-w-0 rounded-[14px] bg-card shadow-[var(--shadow)]">
        {empty ? (
          <Empty className="m-0 px-5 py-4">{empty}</Empty>
        ) : (
          // Wide enough panels show the whole table, so its header can stick to the page as it scrolls.
          <div data-tour="crm" className="overflow-x-auto min-[1180px]:overflow-x-visible">
            <div role="table" aria-label={viewLabel} className="grid min-w-[786px]">
              <div
                role="row"
                className={cn(
                  GRID,
                  "sticky top-0 z-[3] h-10 items-stretch rounded-t-[14px] border-b border-[color:var(--line)] bg-card font-mono text-[12px] text-faint",
                )}
              >
                <span role="columnheader" className={cn(CELL, "px-0")}>
                  <PageCheck items={items} />
                </span>
                {columns.map((c, i) => (
                  <HeadCell key={c.key} c={c} end={i === columns.length - 1} />
                ))}
              </div>
              <KeyList title="CRM" next="Next candidate" mode="focus" role="rowgroup" rows>
                <BulkKeys items={items} />
                {rows.map((r) => (
                  <div
                    role="row"
                    key={r.href}
                    data-bulk-row={r.bulk.candidateId}
                    className={cn(
                      GRID,
                      "relative h-12 items-stretch border-b border-[color:var(--line)] text-[13px] transition-colors last:border-b-0 hover:bg-[color:var(--surface)]",
                      "has-[[aria-checked=true]]:bg-[color:var(--sel)] has-[a:focus-visible]:bg-[color:var(--sel)] has-[a:focus-visible]:shadow-[inset_2px_0_0_var(--ink)]",
                    )}
                  >
                    {/* Above the name's stretched link, so the box is the box and the rest of the row opens them. */}
                    <span role="cell" className={cn(CELL, "relative z-[1] px-0")}>
                      <RowCheck item={r.bulk} />
                    </span>
                    <span role="cell" className={CELL}>
                      <Link href={r.href} data-key-item title={r.name} className="min-w-0 truncate font-medium after:absolute after:inset-0">
                        {/* Above the link's stretch, so only the name raises a card; a click still lands on the link. */}
                        <span data-hc={hoverAttr("candidate", r.bulk.candidateId)} className="relative z-[1]">
                          {r.name}
                        </span>
                      </Link>
                    </span>
                    <span role="cell" className={cn(CELL, "gap-2")} title={r.jobs.length ? r.jobs.join(", ") : undefined}>
                      {r.jobs.length ? (
                        <>
                          <span className="min-w-0 truncate text-muted-foreground">{r.jobs[0]}</span>
                          {r.jobs.length > 1 ? <span className="flex-none text-[12px] text-faint">+{r.jobs.length - 1}</span> : null}
                        </>
                      ) : (
                        <span className="text-faint">None</span>
                      )}
                    </span>
                    <span role="cell" className={CELL} title={r.profile ?? undefined}>
                      {r.profile ? <span className="min-w-0 truncate text-faint">{r.profile}</span> : <span className="text-faint">None</span>}
                    </span>
                    <span role="cell" className={CELL}>
                      <Pill tone={r.stageTone} title={r.stage} className="max-w-full">
                        <span className="min-w-0 truncate">{r.stage}</span>
                      </Pill>
                    </span>
                    <span role="cell" className={CELL} title={r.ownerName ?? undefined}>
                      {r.ownerName ? <span className="min-w-0 truncate">{r.ownerName}</span> : <span className="text-faint">Nobody</span>}
                    </span>
                    <span role="cell" className={cn(CELL, "justify-end text-muted-foreground tabular-nums")} title={r.lastTouchAt.slice(0, 10)}>
                      <LocalDay iso={r.lastTouchAt} fallback={r.lastTouch} />
                    </span>
                  </div>
                ))}
              </KeyList>
            </div>
          </div>
        )}
        <BulkBar options={bulk} />
        <div className="flex h-12 items-center gap-1 border-t border-[color:var(--line)] pr-2.5 pl-5 text-[12.5px] text-faint tabular-nums">
          {note ? <span>{note}</span> : null}
          <span className="flex-1" />
          <span className="mr-2 text-muted-foreground">{range}</span>
          <Arrow href={prev} label="Previous page" dir="prev" />
          <Arrow href={next} label="Next page" dir="next" />
        </div>
      </section>
    </Page>
  );
}
