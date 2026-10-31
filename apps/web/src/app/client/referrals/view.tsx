import Link from "next/link";
import * as React from "react";
import { FlashToast } from "@/components/flash-toast";
import { Empty, Page, PageBar, Pill, SearchBox, SubBar, Tabs, type Tab } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Referrals' markup, props only (page.tsx does the reads): design/tats's
// crumbs bar (users icon, the total faint, "Add referral" right), the view
// tabs and a search in the strip under it, then its CRM-style table: a ruled
// cell grid, one row per referral, newest first, 50 a page with the range and
// arrows in the footer. A row opens the candidate page. "Referred by" is the
// text someone typed, rendered as text.

export type ReferralViewRow = {
  key: string;
  href: string;
  name: string;
  referredBy: string | null;
  job: string;
  where: string;
  /** Hired green, still in process on the selection tint, closed grey. */
  whereTone: "green" | "sel" | "grey";
  referred: string;
  referredTitle: string;
};

const GRID = "grid grid-cols-[minmax(200px,1.4fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_150px_110px]";
/** Every cell: 14px across, a hairline on its left but the first's (design/tats's `.crm-r > *`). */
const CELL = "flex min-w-0 items-center overflow-hidden px-3.5 whitespace-nowrap [&:not(:first-child)]:border-l [&:not(:first-child)]:border-[color:var(--line)]";

// design/tats's 14px header icons, stroked like the shell's.
const ico = (d: string) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-faint" aria-hidden>
    <path d={d} />
  </svg>
);
const USERS = "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5c.4-2.3 2.2-3.8 4.5-3.8s4.1 1.5 4.5 3.8M10.5 2.7a2.5 2.5 0 0 1 0 4.6M12 9.9c1.3.5 2.2 1.8 2.5 3.6";
const HEADERS: { label: string; icon: string }[] = [
  { label: "Candidate", icon: "M8 7.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.5 14c.5-2.6 2.7-4.2 5.5-4.2s5 1.6 5.5 4.2" },
  { label: "Referred by", icon: USERS },
  { label: "Job", icon: "M2 5.5h12v8H2zM5.5 5.5V3.5h5v2M2 9h12" },
  { label: "Where they are", icon: "M3.5 14V2.5M3.5 3h8l-1.5 2.5L11.5 8h-8" },
  { label: "Referred", icon: "M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3" },
];

const WHERE: Record<ReferralViewRow["whereTone"], { tone: "green" | "grey"; className?: string }> = {
  green: { tone: "green" },
  sel: { tone: "grey", className: "bg-[color:var(--sel)] text-foreground" },
  grey: { tone: "grey" },
};

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

export function ReferralsView({
  tabs,
  tabLabel,
  rows,
  all,
  range,
  prev,
  next,
  search,
  canAdd,
  notice,
  note,
  empty,
  home = false,
}: {
  tabs: Tab[];
  tabLabel: string;
  rows: ReferralViewRow[];
  /** Every referral the member can read, faint beside the title. */
  all: string;
  range: string;
  prev: string | null;
  next: string | null;
  /** The search, and the other params a GET form must carry. */
  search: { q: string; action: string; hidden: Record<string, string> };
  /** Whether "Add referral" is offered: the member may add people to at least one open job. */
  canAdd: boolean;
  notice: string | null;
  /** A line in the footer, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** Inside Home's tab, whose bar says where you are, so "Add referral" moves to the strip. */
  home?: boolean;
}) {
  const addReferral = canAdd ? (
              <Link href="/client/referrals/new" data-tour="refer" className={buttonVariants({ size: "sm" })}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="size-3" aria-hidden>
                  <path d="M8 3v10M3 8h10" />
                </svg>
                Add referral
              </Link>
  ) : null;
  return (
    <Page
      bar={
        <>
          {home ? null : (
            <PageBar
              title="Referrals"
              count={all}
              icon={
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={USERS} />
                </svg>
              }
            >
              {addReferral}
            </PageBar>
          )}
          <SubBar>
            <Tabs strip label="Referrals" tabs={tabs} />
            {home ? <span className="ml-auto">{addReferral}</span> : null}
            <SearchBox action={search.action} defaultValue={search.q} placeholder="Search by name, referrer or job" label="Search referrals" keep={search.hidden} />
          </SubBar>
        </>
      }
    >
      {notice ? <FlashToast text={notice} /> : null}
      <section aria-label={tabLabel} className="grid min-w-0 overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
        {empty ? (
          <Empty className="px-4 py-3">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label={tabLabel} className="grid min-w-[780px]">
              <div role="row" className={cn(GRID, "h-[46px] border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] text-[13.5px] text-muted-foreground")}>
                {HEADERS.map((h) => (
                  <span role="columnheader" key={h.label} className={cn(CELL, "gap-2")}>
                    {ico(h.icon)}
                    {h.label}
                  </span>
                ))}
              </div>
              {rows.map((r) => {
                const where = WHERE[r.whereTone];
                return (
                  <Link
                    role="row"
                    key={r.key}
                    href={r.href}
                    className={cn(GRID, "min-h-[50px] border-b border-[color:var(--line)] text-[14px] transition-colors last:border-b-0 hover:bg-[color:var(--hover)]")}
                  >
                    <span role="cell" className={cn(CELL, "gap-2.5")}>
                      <b className="truncate font-medium">{r.name}</b>
                    </span>
                    <span role="cell" className={CELL} title={r.referredBy ?? undefined}>
                      <span className="truncate">{r.referredBy ?? <span className="text-faint">Not recorded</span>}</span>
                    </span>
                    <span role="cell" className={CELL}>
                      <span className="inline-flex h-6 min-w-0 items-center truncate bg-[color:var(--soft)] px-2 text-[12.5px]">{r.job}</span>
                    </span>
                    <span role="cell" className={CELL}>
                      <Pill tone={where.tone} className={where.className}>
                        {r.where}
                      </Pill>
                    </span>
                    <span role="cell" className={cn(CELL, "text-muted-foreground tabular-nums")} title={r.referredTitle}>
                      {r.referred}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex h-[46px] items-center gap-1 border-t border-[color:var(--line-strong)] pr-3 pl-[18px] text-[13px] text-muted-foreground tabular-nums">
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
