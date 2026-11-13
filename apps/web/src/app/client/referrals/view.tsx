import Link from "next/link";
import * as React from "react";
import { FlashToast } from "@/components/flash-toast";
import { KeyList } from "@/components/keys";
import { Empty, Page, PageBar, Pill, SearchBox, Section, SubBar, Tabs, type Tab } from "@/components/page";
import { hoverAttr } from "@/lib/hover-card";
import { cn } from "@/lib/utils";
import { IntakeButton, type IntakeProps } from "../applicants/intake-composer";
import { LocalDay } from "../candidates/local-day";
import { addReferralAction } from "./actions";
import { REFERRAL_ERRORS } from "./messages";

// Referrals' markup, props only (page.tsx does the reads), as a CRM of the
// people referred in, drawn as the CRM is (candidates/view.tsx): the title row
// (everyone referred in its tile, "Add referral" right), the view tabs with
// their counts over the corners and the search under it, then the table in one
// white card: a sticky header in faint Geist Mono whose column heads sort by
// link (the URL is the state), 48px rows ruled by hairlines, one per person,
// 50 a page with the range and arrows in the foot. A row opens the candidate
// page: its name is the link, stretched over the row, and raises their hover
// card; J/K move between rows and Enter opens one (components/keys.tsx).
// "Referred by" is the referrer's name out of the text someone typed
// (referral-table.ts's referrerName), rendered as text, the whole as its
// hover when it said more. Then the "Top referrers" card: each referrer's
// name in full over a rounded bar of how many
// they referred, with how many are in process and hired beside it, every count
// labelled; a referrer searches the list for them. The card sits beside the
// table in a wide window and under it otherwise, where its referrers take two
// columns. "Add referral" opens the intake composer
// (applicants/intake-composer.tsx), which posts the same fields the referral
// form always did.

export type ReferralViewRow = {
  key: string;
  candidateId: string;
  href: string;
  name: string;
  /** The referrer's name, under a head that already says "Referred by". */
  referredBy: string | null;
  /** How the referral was recorded when it said more than the name ("Backchannel from Daniel"): the cell's hover. */
  referredByWords: string | null;
  /** The jobs they were referred to, the lead one first. */
  jobs: string[];
  where: string;
  /** Hired green, everything else grey, as the CRM's stage. */
  whereTone: "green" | "grey";
  referredAt: string;
  /** Shown until the browser knows its time zone: "3d ago". */
  referred: string;
};

export type ReferrerViewRow = {
  name: string;
  /** The table searched for them. */
  href: string;
  referred: number;
  inProcess: number;
  hired: number;
};

export type ReferralColumn = { key: string; label: string; href: string; sorted: "asc" | "desc" | null };

function TopReferrers({ rows, more }: { rows: ReferrerViewRow[]; more: string | null }) {
  const most = Math.max(1, ...rows.map((r) => r.referred));
  return (
    <Section title="Top referrers" aria-label="Top referrers" className="gap-2 px-3 pt-4 pb-3 [&>div:first-child]:px-2">
      <ul className="m-0 grid list-none gap-x-4 p-0 md:max-[1679px]:grid-cols-2">
        {rows.map((r) => (
          <li key={r.name}>
            <Link href={r.href} title={`Show ${r.name}'s referrals`} className="grid gap-2 rounded-[8px] px-2 py-2.5 transition-colors duration-150 hover:bg-[color:var(--surface)]">
              <span className="flex items-baseline justify-between gap-3">
                <b className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.name}</b>
                <span className="whitespace-nowrap tabular-nums">
                  {r.referred} <span className="text-faint">referred</span>
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span aria-hidden className="relative h-1.5 min-w-10 flex-1 overflow-hidden rounded-[3px] bg-[color:var(--soft-strong)]">
                  <i className="absolute inset-y-0 left-0 rounded-[3px] bg-[color:var(--ink)]" style={{ width: `${(r.referred / most) * 100}%` }} />
                </span>
                <span className="flex gap-3 text-[12px] whitespace-nowrap text-faint tabular-nums">
                  <span>{r.inProcess} in process</span>
                  <span className={r.hired ? "font-medium text-[color:var(--green)]" : undefined}>{r.hired} hired</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more ? <p className="m-0 px-2 text-[12px] text-faint">{more}</p> : null}
    </Section>
  );
}

// The CRM's table, less its checkbox column: Candidate, Referred by, Job, Where they are, Referred. A 720px floor, the
// spare width going to the text columns, most to Job, whose titles are the longest ("Research Scientist, Post-training"
// fits whole at 1280).
const GRID = "grid grid-cols-[minmax(140px,1fr)_minmax(150px,1fr)_minmax(170px,1.6fr)_136px_112px] pl-2 pr-1";
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

/** A column head: its label, the sort's arrow when it sorts by it, a link with a hover so it reads as one. */
function HeadCell({ c, end }: { c: ReferralColumn; end?: boolean }) {
  return (
    <span role="columnheader" aria-sort={c.sorted === "asc" ? "ascending" : c.sorted === "desc" ? "descending" : "none"} className={cn(CELL, "px-1.5", end && "justify-end")}>
      <Link
        href={c.href}
        title={`Sort by ${c.label.toLowerCase()}`}
        className={cn("inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 transition-colors hover:bg-[color:var(--hover)] hover:text-foreground", c.sorted && "text-foreground")}
      >
        {c.label}
        {c.sorted ? <span aria-hidden>{c.sorted === "asc" ? "↑" : "↓"}</span> : null}
      </Link>
    </span>
  );
}

export function ReferralsView({
  tabs,
  tabLabel,
  columns,
  rows,
  referrers,
  all,
  range,
  prev,
  next,
  search,
  intake,
  compose = false,
  notice,
  note,
  empty,
  home = false,
}: {
  tabs: Tab[];
  tabLabel: string;
  columns: ReferralColumn[];
  rows: ReferralViewRow[];
  /** The board, over every referral the member can read (not the tab or the search); null with nobody named. */
  referrers: { rows: ReferrerViewRow[]; more: string | null } | null;
  /** Everyone referred that the member can read, in the title's count tile. */
  all: string;
  range: string;
  prev: string | null;
  next: string | null;
  /** The search, and the other params a GET form must carry. */
  search: { q: string; action: string; hidden: Record<string, string> };
  /** What "Add referral" needs; null when the member may not add people, and there is no button. */
  intake: Omit<IntakeProps, "kind" | "action" | "errors"> | null;
  /** /client/referrals/new: the composer open on arrival, closing back to the list. */
  compose?: boolean;
  notice: string | null;
  /** A line in the footer, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** Inside Home's tab, whose bar says where you are, so "Add referral" moves to the strip. */
  home?: boolean;
}) {
  const addReferral = intake ? (
    <IntakeButton
      kind="referral"
      label="Add referral"
      tour="refer"
      action={addReferralAction}
      errors={REFERRAL_ERRORS}
      startOpen={compose}
      closeTo={compose ? "/client/referrals" : undefined}
      {...intake}
    />
  ) : null;
  return (
    <Page
      bar={
        <>
          {home ? null : (
            <PageBar title="Referrals" count={all}>
              {addReferral}
            </PageBar>
          )}
          <SubBar>
            <Tabs strip label="Referrals" tabs={tabs} />
            {/* The search a little wider than the shared box, so its placeholder reads whole. */}
            <span className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:[&>form]:w-[300px]">
              {home ? addReferral : null}
              <SearchBox action={search.action} defaultValue={search.q} placeholder="Search by name, referrer or job" label="Search referrals" keep={search.hidden} />
            </span>
          </SubBar>
        </>
      }
    >
      {notice ? <FlashToast text={notice} /> : null}
      <div className={cn("grid items-start gap-5", referrers && "min-[1680px]:grid-cols-[minmax(0,1fr)_380px]")}>
        {/* Not clipped: the header sticks to the page as it scrolls, so it takes the card's top corners itself. */}
        <section aria-label={tabLabel} className="min-w-0 rounded-[14px] bg-card shadow-[var(--shadow)]">
          {empty ? (
            <Empty className="m-0 px-5 py-4">{empty}</Empty>
          ) : (
            <div className="overflow-x-auto min-[1180px]:overflow-x-visible">
              <div role="table" aria-label={tabLabel} className="grid min-w-[720px]">
                <div role="row" className={cn(GRID, "sticky top-0 z-[3] h-10 items-stretch rounded-t-[14px] border-b border-[color:var(--line)] bg-card font-mono text-[12px] text-faint")}>
                  {columns.map((c, i) => (
                    <HeadCell key={c.key} c={c} end={i === columns.length - 1} />
                  ))}
                </div>
                <KeyList title="Referrals" next="Next referral" mode="focus" role="rowgroup" rows>
                  {rows.map((r) => (
                    <div
                      role="row"
                      key={r.key}
                      className={cn(
                        GRID,
                        "relative h-12 items-stretch border-b border-[color:var(--line)] text-[13px] transition-colors last:border-b-0 hover:bg-[color:var(--surface)]",
                        "has-[a:focus-visible]:bg-[color:var(--sel)] has-[a:focus-visible]:shadow-[inset_2px_0_0_var(--ink)]",
                      )}
                    >
                      <span role="cell" className={CELL}>
                        <Link href={r.href} data-key-item title={r.name} className="min-w-0 truncate font-medium after:absolute after:inset-0">
                          {/* Above the link's stretch, so only the name raises a card; a click still lands on the link. */}
                          <span data-hc={hoverAttr("candidate", r.candidateId)} className="relative z-[1]">
                            {r.name}
                          </span>
                        </Link>
                      </span>
                      <span role="cell" className={CELL} title={r.referredByWords ?? r.referredBy ?? undefined}>
                        {r.referredBy ? <span className="min-w-0 truncate">{r.referredBy}</span> : <span className="text-faint">Not recorded</span>}
                      </span>
                      <span role="cell" className={cn(CELL, "gap-2")} title={r.jobs.join(", ")}>
                        <span className="min-w-0 truncate text-muted-foreground">{r.jobs[0]}</span>
                        {r.jobs.length > 1 ? <span className="flex-none text-[12px] text-faint">+{r.jobs.length - 1}</span> : null}
                      </span>
                      <span role="cell" className={CELL}>
                        <Pill tone={r.whereTone} title={r.where} className="max-w-full">
                          <span className="min-w-0 truncate">{r.where}</span>
                        </Pill>
                      </span>
                      <span role="cell" className={cn(CELL, "justify-end text-muted-foreground tabular-nums")} title={r.referredAt.slice(0, 10)}>
                        <LocalDay iso={r.referredAt} fallback={r.referred} />
                      </span>
                    </div>
                  ))}
                </KeyList>
              </div>
            </div>
          )}
          <div className="flex h-12 items-center gap-1 border-t border-[color:var(--line)] pr-2.5 pl-5 text-[12.5px] text-faint tabular-nums">
            {note ? <span>{note}</span> : null}
            <span className="flex-1" />
            <span className="mr-2 text-muted-foreground">{range}</span>
            <Arrow href={prev} label="Previous page" dir="prev" />
            <Arrow href={next} label="Next page" dir="next" />
          </div>
        </section>
        {referrers ? <TopReferrers {...referrers} /> : null}
      </div>
    </Page>
  );
}
