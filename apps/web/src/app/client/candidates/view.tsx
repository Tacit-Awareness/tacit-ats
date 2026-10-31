import Link from "next/link";
import { KeyList } from "@/components/keys";
import { Avatar, Empty, Page, PageBar, Pill, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import type { BulkItem } from "@/lib/client/crm-bulk-rules";
import { cn } from "@/lib/utils";
import { BulkBar, BulkKeys, PageCheck, RowCheck, type BulkOptions } from "./bulk";
import { Icon, type IconName } from "./icons";
import { LocalDay } from "./local-day";

// The CRM's markup, props only (page.tsx does the reads), as design/tats's
// CRM: the bar (database icon, "CRM", the count faint), department tabs under
// it when the org has departments, then the views as strip tabs with the
// search on the right, then the table (`.crm-*`): every cell ruled from the
// next, a sticky header with an icon per column, the column headers sorting
// by link (the URL is the state), 50 rows a page with the range and arrows in
// the footer. A row opens the candidate page: its name is the link, stretched
// over the row, so the row can hold a checkbox too. J/K move between rows,
// Enter opens one (components/keys.tsx) and X selects one; the bulk actions
// are bulk.tsx, which keeps the selection in the browser.

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

export type CrmColumn = { key: string; label: string; icon: IconName; href: string | null; sorted: "asc" | "desc" | null };

// design/tats's `.crm-r` columns, less its Testbench one.
const GRID = "grid grid-cols-[44px_minmax(190px,1.5fr)_minmax(150px,1.2fr)_minmax(120px,1fr)_128px_minmax(150px,1fr)_124px]";
// `.crm-r > *`: 14px in, a hairline to the left of every cell but the first.
const CELL = "flex h-full min-w-0 items-center overflow-hidden border-l border-[color:var(--line)] px-3.5 whitespace-nowrap first:border-l-0";

function Arrow({ href, label, dir }: { href: string | null; label: string; dir: "prev" | "next" }) {
  const d = dir === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5";
  const icon = (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d={d} />
    </svg>
  );
  const cls = "grid size-7 place-items-center rounded-full";
  return href ? (
    <Link href={href} aria-label={label} className={cn(cls, "text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground")}>
      {icon}
    </Link>
  ) : (
    <span aria-hidden className={cn(cls, "text-faint opacity-40")}>
      {icon}
    </span>
  );
}

function HeadCell({ c }: { c: CrmColumn }) {
  const body = (
    <>
      <Icon name={c.icon} className="size-3.5 text-faint" />
      {c.label}
      {c.sorted ? <span aria-hidden>{c.sorted === "asc" ? "↑" : "↓"}</span> : null}
    </>
  );
  return (
    <span role="columnheader" aria-sort={c.sorted === "asc" ? "ascending" : c.sorted === "desc" ? "descending" : "none"} className={CELL}>
      {c.href ? (
        <Link href={c.href} className={cn("inline-flex min-w-0 items-center gap-2 transition-colors hover:text-foreground", c.sorted && "text-foreground")}>
          {body}
        </Link>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-2">{body}</span>
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
      <section aria-label={viewLabel} className="min-w-0 border border-[color:var(--line)] bg-[color:var(--paper)]">
        {empty ? (
          <Empty className="px-4 py-3">{empty}</Empty>
        ) : (
          // Wide enough panels show the whole table, so its header can stick to the page as it scrolls.
          <div data-tour="crm" className="overflow-x-auto min-[1180px]:overflow-x-visible">
            <div role="table" aria-label={viewLabel} className="grid min-w-[900px]">
              <div
                role="row"
                className={cn(
                  GRID,
                  "sticky top-0 z-[1] min-h-[46px] items-stretch border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] text-[13.5px] text-muted-foreground",
                )}
              >
                <span role="columnheader" className={cn(CELL, "px-0")}>
                  <PageCheck items={items} />
                </span>
                {columns.map((c) => (
                  <HeadCell key={c.key} c={c} />
                ))}
              </div>
              <KeyList title="CRM" next="Next candidate" mode="focus" role="rowgroup">
                <BulkKeys items={items} />
                {rows.map((r) => (
                  <div
                    role="row"
                    key={r.href}
                    data-bulk-row={r.bulk.candidateId}
                    className={cn(
                      GRID,
                      "relative min-h-[50px] items-stretch border-b border-[color:var(--line)] text-[14px] transition-colors last:border-b-0 hover:bg-[color:var(--hover)] has-[a:focus-visible]:bg-[color:var(--sel)] has-[[aria-checked=true]]:bg-[color:var(--sel)]",
                    )}
                  >
                    {/* Above the name's stretched link, so the box is the box and the rest of the row opens them. */}
                    <span role="cell" className={cn(CELL, "relative z-[1] px-0")}>
                      <RowCheck item={r.bulk} />
                    </span>
                    <span role="cell" className={cn(CELL, "gap-2.5")}>
                      <Link href={r.href} data-key-item className="min-w-0 truncate font-medium after:absolute after:inset-0">
                        {r.name}
                      </Link>
                    </span>
                    <span role="cell" className={cn(CELL, "gap-1.5")}>
                      {r.jobs.length ? (
                        <>
                          <span className="inline-flex h-6 min-w-0 items-center truncate bg-[color:var(--soft)] px-[9px] text-[12.5px]">{r.jobs[0]}</span>
                          {r.jobs.length > 1 ? (
                            <span className="text-xs text-faint" title={r.jobs.slice(1).join(", ")}>
                              +{r.jobs.length - 1}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-faint">None</span>
                      )}
                    </span>
                    <span role="cell" className={CELL}>
                      {r.profile ? (
                        <span className="truncate underline decoration-[color:var(--line-strong)] underline-offset-[3px]">{r.profile}</span>
                      ) : (
                        <span className="text-faint">None</span>
                      )}
                    </span>
                    <span role="cell" className={CELL}>
                      <Pill tone={r.stageTone}>{r.stage}</Pill>
                    </span>
                    <span role="cell" className={cn(CELL, "gap-2")}>
                      {r.ownerName ? (
                        <>
                          <Avatar name={r.ownerName} />
                          <span className="truncate">{r.ownerName}</span>
                        </>
                      ) : (
                        <span className="text-faint">Nobody</span>
                      )}
                    </span>
                    <span role="cell" className={cn(CELL, "tabular-nums")} title={r.lastTouchAt.slice(0, 10)}>
                      <LocalDay iso={r.lastTouchAt} fallback={r.lastTouch} />
                    </span>
                  </div>
                ))}
              </KeyList>
            </div>
          </div>
        )}
        <BulkBar options={bulk} />
        <div className="flex h-[46px] items-center gap-1 border-t border-[color:var(--line-strong)] pr-3 pl-5 text-[13px] text-muted-foreground tabular-nums">
          {note ? <span className="text-faint">{note}</span> : null}
          <span className="flex-1" />
          <span className="mr-2">{range}</span>
          <Arrow href={prev} label="Previous page" dir="prev" />
          <Arrow href={next} label="Next page" dir="next" />
        </div>
      </section>
    </Page>
  );
}
