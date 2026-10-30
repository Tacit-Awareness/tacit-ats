import Link from "next/link";
import { Avatar, Empty, Notice, Page, PageHeader, Pill, Section, Tabs, Toolbar, type Tab } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Referrals' markup, props only (page.tsx does the reads): tabs and a search
// above design/tats's table, one row per referral, newest first, 50 a page
// with the range and arrows in the footer. A row opens the candidate page.
// "Referred by" is the text someone typed, rendered as text.

export type ReferralViewRow = {
  key: string;
  href: string;
  name: string;
  referredBy: string | null;
  job: string;
  where: string;
  whereTone: "green" | "grey";
  referred: string;
  referredTitle: string;
};

const GRID = "grid grid-cols-[minmax(200px,1.4fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_130px_100px] items-center";
const HEADERS = ["Candidate", "Referred by", "Job", "Where they are", "Referred"];

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

export function ReferralsView({
  tabs,
  tabLabel,
  rows,
  total,
  range,
  prev,
  next,
  search,
  canAdd,
  notice,
  note,
  empty,
}: {
  tabs: Tab[];
  tabLabel: string;
  rows: ReferralViewRow[];
  total: number;
  range: string;
  prev: string | null;
  next: string | null;
  /** The search, and the other params a GET form must carry. */
  search: { q: string; hidden: Record<string, string> };
  /** Whether "Add referral" is offered: the member may add people to at least one open job. */
  canAdd: boolean;
  notice: string | null;
  /** A line in the footer, such as the read stopping short. */
  note: string | null;
  empty: string | null;
}) {
  return (
    <Page>
      <PageHeader
        title="Referrals"
        subtitle="Everyone referred to your jobs, who referred them and where they are now."
        actions={
          canAdd ? (
            <Link href="/client/referrals/new" className={buttonVariants({ size: "sm" })}>
              Add referral
            </Link>
          ) : null
        }
      />
      {notice ? <Notice>{notice}</Notice> : null}
      <Toolbar>
        <Tabs label="Referrals" tabs={tabs} />
        {/* A plain GET form: the search is in the URL, like the tabs. */}
        <form action="/client/referrals" method="get" role="search" className="w-full sm:w-64">
          {Object.entries(search.hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Input name="q" defaultValue={search.q} placeholder="Search by name, referrer or job" aria-label="Search referrals" />
        </form>
      </Toolbar>
      <Section flush title={tabLabel} count={total.toLocaleString("en-US")}>
        {empty ? (
          <Empty className="px-4 py-3">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label={tabLabel} className="grid min-w-[760px]">
              <div role="row" className={cn(GRID, "h-10 border-b border-[color:var(--line)] text-[12.5px] text-muted-foreground")}>
                {HEADERS.map((h) => (
                  <span role="columnheader" key={h} className="min-w-0 px-4">
                    {h}
                  </span>
                ))}
              </div>
              {rows.map((r) => (
                <Link
                  role="row"
                  key={r.key}
                  href={r.href}
                  className={cn(GRID, "min-h-[50px] border-b border-[color:var(--line)] text-[13.5px] transition-colors last:border-b-0 hover:bg-[color:var(--hover)]")}
                >
                  <span role="cell" className="flex min-w-0 items-center gap-2.5 px-4 py-2">
                    <Avatar name={r.name} />
                    <b className="truncate font-medium">{r.name}</b>
                  </span>
                  <span role="cell" className="min-w-0 truncate px-4" title={r.referredBy ?? undefined}>
                    {r.referredBy ?? <span className="text-faint">Not recorded</span>}
                  </span>
                  <span role="cell" className="flex min-w-0 px-4">
                    <span className="inline-flex h-6 min-w-0 items-center truncate rounded-md bg-[color:var(--soft)] px-2 text-[12.5px]">{r.job}</span>
                  </span>
                  <span role="cell" className="px-4">
                    <Pill tone={r.whereTone}>{r.where}</Pill>
                  </span>
                  <span role="cell" className="px-4 text-muted-foreground tabular-nums" title={r.referredTitle}>
                    {r.referred}
                  </span>
                </Link>
              ))}
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
