import Link from "next/link";
import { KeyList } from "@/components/keys";
import { Avatar, Empty, Page, PageHeader, Pill, Section, Tabs, Toolbar, type Tab } from "@/components/page";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The CRM's markup, props only (page.tsx does the reads): department tabs
// (none for an org without departments), view tabs and a search above
// design/tats's table, one row per candidate, the column
// headers sorting by link (the URL is the state), 50 rows a page with the
// range and arrows in the footer. A row opens the candidate page; J/K move
// between rows and Enter opens one (components/keys.tsx).

export type CrmViewRow = {
  href: string;
  name: string;
  headline: string | null;
  jobs: string[];
  stage: string;
  stageTone: "green" | "grey";
  ownerName: string | null;
  lastTouch: string;
  lastTouchTitle: string;
};

export type CrmColumn = { key: string; label: string; href: string; sorted: "asc" | "desc" | null };

const GRID = "grid grid-cols-[minmax(220px,1.6fr)_minmax(170px,1.3fr)_120px_minmax(130px,1fr)_110px] items-center";

function Arrow({ href, label, dir }: { href: string | null; label: string; dir: "prev" | "next" }) {
  const d = dir === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5";
  const icon = (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
      <path d={d} />
    </svg>
  );
  const cls = "grid size-7 place-items-center rounded-md";
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
}) {
  return (
    <Page>
      <PageHeader title="CRM" subtitle="Everyone you can see: in process, and everyone the funnel has closed, hired or not." />
      {departments.length ? <Tabs label="Departments" tabs={departments} /> : null}
      <Toolbar>
        <Tabs label="Views" tabs={views} />
        {/* A plain GET form: the search is in the URL, like the tabs and the sort. */}
        <form action="/client/candidates" method="get" role="search" className="w-full sm:w-64">
          {Object.entries(search.hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Input name="q" defaultValue={search.q} placeholder="Search by name, email or job" aria-label="Search candidates" />
        </form>
      </Toolbar>
      <Section flush title={viewLabel} count={total.toLocaleString("en-US")}>
        {empty ? (
          <Empty className="px-4 py-3">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label={viewLabel} className="grid min-w-[760px]">
              <div role="row" className={cn(GRID, "h-10 border-b border-[color:var(--line)] text-[12.5px] text-muted-foreground")}>
                {columns.map((c) => (
                  <span role="columnheader" key={c.key} aria-sort={c.sorted === "asc" ? "ascending" : c.sorted === "desc" ? "descending" : "none"} className="min-w-0 px-4">
                    <Link href={c.href} className={cn("inline-flex items-center gap-1 transition-colors hover:text-foreground", c.sorted && "font-medium text-foreground")}>
                      {c.label}
                      {c.sorted ? <span aria-hidden>{c.sorted === "asc" ? "↑" : "↓"}</span> : null}
                    </Link>
                  </span>
                ))}
              </div>
              <KeyList title="CRM" next="Next candidate" mode="focus" items=":scope > a" role="rowgroup">
                {rows.map((r) => (
                  <Link
                    role="row"
                    key={r.href}
                    href={r.href}
                    className={cn(GRID, "min-h-[50px] border-b border-[color:var(--line)] text-[13.5px] transition-colors last:border-b-0 hover:bg-[color:var(--hover)]")}
                  >
                    <span role="cell" className="flex min-w-0 items-center gap-2.5 px-4 py-2">
                      <Avatar name={r.name} />
                      <span className="grid min-w-0">
                        <b className="truncate font-medium">{r.name}</b>
                        {r.headline ? <span className="truncate text-xs text-muted-foreground">{r.headline}</span> : null}
                      </span>
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-1.5 px-4">
                      {r.jobs.length ? (
                        <>
                          <span className="inline-flex h-6 min-w-0 items-center truncate rounded-md bg-[color:var(--soft)] px-2 text-[12.5px]">{r.jobs[0]}</span>
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
                    <span role="cell" className="px-4">
                      <Pill tone={r.stageTone}>{r.stage}</Pill>
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-2 px-4">
                      {r.ownerName ? (
                        <>
                          <Avatar name={r.ownerName} />
                          <span className="truncate">{r.ownerName}</span>
                        </>
                      ) : (
                        <span className="text-faint">Nobody</span>
                      )}
                    </span>
                    <span role="cell" className="px-4 text-muted-foreground tabular-nums" title={r.lastTouchTitle}>
                      {r.lastTouch}
                    </span>
                  </Link>
                ))}
              </KeyList>
            </div>
          </div>
        )}
        <div className="flex h-[46px] items-center gap-1 border-t border-[color:var(--line)] px-4 text-[13px] text-muted-foreground tabular-nums">
          {note ? <span className="text-faint">{note}</span> : null}
          <span className="flex-1" />
          <span className="mr-2">{range}</span>
          <Arrow href={prev} label="Previous page" dir="prev" />
          <Arrow href={next} label="Next page" dir="next" />
        </div>
      </Section>
    </Page>
  );
}
