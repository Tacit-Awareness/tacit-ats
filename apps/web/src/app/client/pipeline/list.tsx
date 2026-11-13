import Link from "next/link";
import { KeyList } from "@/components/keys";
import { StatusGlyph } from "@/components/page";
import type { PipelineRow, RowGroup, StageCount } from "@/lib/client/pipeline-list";
import { hoverAttr } from "@/lib/hover-card";
import { cn } from "@/lib/utils";
import type { CardMoves } from "@/lib/client/pipeline-moves";
import { buttonVariants } from "@/components/ui/button";
import { columnGlyph } from "./column-glyph";
import { RowMenus, type RowCard } from "./row-menu";

// The Pipeline's list, design/tats's "Pipeline at scale" drawn as Testbench's
// staff ticket list: a stage bar that filters, then one white card with a band
// per stage and a 48px line per person under it. Links, so the URL holds the
// state and J / K / Enter work through KeyList. Rows carry no buttons: a row
// opens the candidate in a pop-up (popup.tsx, `?open=`), and a right-click or S
// is the board's stage menu on a job the member may edit (row-menu.tsx). Over
// the list J and K move focus and Enter opens; in the pop-up they walk the
// rows, as the Inbox's do. Each stage has its square (column-glyph.ts); a stuck
// person's is the red alert square instead.

export type StageCard = StageCount & { href: string; active: boolean };
/** What a fact in a row is, for its tone and its place in the line (page.tsx's rowFacts). */
export type FactKind = "job" | "stuck" | "owner" | "source" | "stage" | "more";
export type ListFact = { text: string; kind: FactKind };
export type ListRow = PipelineRow & {
  openHref: string;
  active: boolean;
  /** The facts one by one, in the order they read; without them the row splits `facts`. */
  parts?: ListFact[];
  /** The team (department) the job is with, when the list spans more than one. */
  team?: string;
  /** What a move needs, on a job the member may edit: the same check as a board card's. */
  menu?: { stage: string; stageLabel: string; moves: CardMoves } | null;
};
export type ListGroup = Omit<RowGroup, "rows"> & { rows: ListRow[]; moreHref: string | null };

/**
 * Testbench's stats card: one white card, a ruled cell per stage. The cells
 * share the width equally, and one whose label needs more takes it, so a label
 * never truncates; past the card's width it scrolls sideways. Under each count,
 * the stuck share as a rounded meter.
 */
export function StageBar({ stages }: { stages: StageCard[] }) {
  return (
    <nav
      aria-label="Filter by stage"
      className="grid auto-cols-[minmax(max-content,1fr)] grid-flow-col overflow-x-auto rounded-[14px] bg-card shadow-[var(--shadow)] [scrollbar-width:none]"
    >
      {stages.map((s) => {
        const glyph = columnGlyph(s.key);
        return (
          <Link
            key={s.key}
            href={s.href}
            scroll={false}
            aria-current={s.active ? "true" : undefined}
            title={`${s.label}: ${s.total} in this stage, ${s.stuck} stuck`}
            className={cn(
              "grid content-start gap-3 px-4 pt-3.5 pb-4 whitespace-nowrap shadow-[1px_0_0_var(--line)] transition-colors hover:bg-[color:var(--surface)]",
              s.active && "bg-[color:var(--sel)] shadow-[inset_0_-2px_0_var(--ink),1px_0_0_var(--line)] hover:bg-[color:var(--sel)]",
            )}
          >
            <span className={cn("flex items-center gap-2 text-[12.5px]", s.active ? "text-foreground" : "text-muted-foreground")}>
              <StatusGlyph kind={glyph.kind} color={glyph.color} />
              {s.label}
            </span>
            <span className="flex h-[26px] items-center gap-3">
              <b className="font-mono text-[26px] leading-none font-normal tracking-[-0.03em] tabular-nums">{s.total}</b>
              {s.stuck > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-negative">
                  <StatusGlyph kind="alert" className="size-3" />
                  {s.stuck} stuck
                </span>
              ) : null}
            </span>
            {/* The stuck share of the stage. */}
            <i aria-hidden className="block h-1 overflow-hidden rounded-full bg-[color:var(--soft-strong)]">
              {s.share > 0 ? <i className="block h-full rounded-full bg-[color:var(--red)]" style={{ width: `${s.share}%` }} /> : null}
            </i>
          </Link>
        );
      })}
    </nav>
  );
}

/** A fact's tone: the job in the second grey, why they're stuck in red, the rest in the faint grey. Tone and the gap between keep two facts from reading as one. */
const FACT_TONE: Record<FactKind, string> = {
  job: "text-muted-foreground",
  stuck: "text-negative",
  owner: "text-muted-foreground",
  source: "text-faint",
  stage: "text-faint",
  more: "text-faint",
};

/**
 * Testbench's `.ticket`: 48px, the square, the name in 500, then one line: what
 * is happening in ink, and the facts after it in the order page.tsx put them,
 * 20px apart. Every fact but the last shows whole: the line is one row of a
 * wrapping flex box, clipped to its height, so a fact that won't fit wraps out
 * of sight with everything after it, and the last fact alone shortens with an
 * ellipsis. A fact that only repeats the status is left out. The whole line is
 * the hover title. When the list spans several teams, the team the person is
 * interviewing with has a column of its own before the time, so it reads down
 * the list. The time is right. Two lines on a phone.
 */
function Row({ row, group, teams }: { row: ListRow; group: string; teams: boolean }) {
  const glyph = columnGlyph(group);
  const all: ListFact[] = row.parts ?? (row.facts ? row.facts.split(" · ").map((text) => ({ text, kind: "more" as const })) : []);
  // A new person's status is often their posting's title, the job again: it reads once.
  const parts = all.filter((p) => p.text !== row.status);
  return (
    <Link
      href={row.openHref}
      scroll={false}
      data-key-item
      data-pop-row={row.applicationId}
      aria-current={row.active ? "true" : undefined}
      aria-haspopup="dialog"
      aria-label={`${row.name}: ${row.status}. ${row.facts}. ${row.time} since last touched${row.stuck ? ", stuck" : ""}.`}
      className={cn(
        "grid h-12 items-center gap-3.5 border-t border-[color:var(--line)] px-4 text-[13px] transition-colors hover:bg-[color:var(--surface)]",
        teams ? "grid-cols-[16px_minmax(120px,176px)_minmax(0,1fr)_96px_52px]" : "grid-cols-[16px_minmax(120px,176px)_minmax(0,1fr)_52px]",
        "[&[aria-current]]:bg-[color:var(--sel)] [&[aria-current]]:shadow-[inset_2px_0_0_var(--ink)]",
        "max-sm:h-auto max-sm:grid-cols-[16px_minmax(0,1fr)_44px] max-sm:gap-y-0.5 max-sm:py-2.5",
      )}
    >
      {row.stuck ? <StatusGlyph kind="alert" title="Stuck" /> : <StatusGlyph kind={glyph.kind} color={glyph.color} />}
      <span data-hc={hoverAttr("candidate", row.personId)} className="min-w-0 justify-self-start truncate font-medium">
        {row.name}
      </span>
      <span
        title={[row.status, ...parts.map((p) => p.text), row.team ? `Team: ${row.team}` : null].filter(Boolean).join("\n")}
        className="flex h-5 min-w-0 flex-wrap items-center gap-x-5 overflow-hidden whitespace-nowrap max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 max-sm:text-[12.5px]"
      >
        <span className="max-w-full flex-none truncate text-foreground">{row.status}</span>
        {parts.map((p, i) =>
          i === parts.length - 1 ? (
            <span key={i} className={cn("max-w-full min-w-16 flex-1 truncate", FACT_TONE[p.kind])}>
              {p.text}
            </span>
          ) : (
            <span key={i} className={cn("max-w-full flex-none truncate", FACT_TONE[p.kind])}>
              {p.text}
            </span>
          ),
        )}
      </span>
      {teams ? (
        <span title={row.team ? `Team: ${row.team}` : undefined} className="min-w-0 truncate text-[12.5px] text-muted-foreground max-sm:hidden">
          {row.team}
        </span>
      ) : null}
      <span
        title="Since their last stage move or logged touch"
        className={cn("text-right text-[12px] tabular-nums max-sm:col-start-3 max-sm:row-start-1", row.stuck ? "text-negative" : "text-faint")}
      >
        {row.time}
      </span>
    </Link>
  );
}

const CHEVRON = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[13px] shrink-0" aria-hidden>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export function PipelineList({ groups, popup, teams = false }: { groups: ListGroup[]; popup: boolean; teams?: boolean }) {
  const cards = groups.flatMap((g) =>
    g.rows.flatMap((r): RowCard[] =>
      r.menu
        ? [{ applicationId: r.applicationId, personId: r.personId, name: r.name, href: r.href, openHref: r.openHref, stage: r.menu.stage, stageLabel: r.menu.stageLabel, moves: r.menu.moves }]
        : [],
    ),
  );
  return (
    <RowMenus cards={cards} popup={popup}>
      <KeyList
        title="Applicant Tickets"
        next="Next person"
        mode={popup ? "select" : "focus"}
        data-tour="board"
        rows
        className="overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]"
      >
        {groups.map((g) => {
          const glyph = columnGlyph(g.key);
          return (
            <section key={g.key} aria-label={g.label} className="border-t border-[color:var(--line)] first:border-t-0">
              {/* Testbench's `.group-head`: a 40px band, the stage's square, its name and the count faint. */}
              <h2 className="m-0 flex h-10 items-center gap-2.5 bg-[color:var(--band)] px-4 font-mono text-[13px] font-medium tracking-normal">
                <StatusGlyph kind={glyph.kind} color={glyph.color} />
                {g.label}
                <span className="font-normal text-faint tabular-nums">{g.total}</span>
              </h2>
              {g.rows.map((row) => (
                <Row key={row.applicationId} row={row} group={g.key} teams={teams} />
              ))}
              {g.more && g.moreHref ? (
                <Link
                  href={g.moreHref}
                  scroll={false}
                  className="flex h-10 items-center gap-2 border-t border-[color:var(--line)] pr-4 pl-[46px] text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--surface)] hover:text-foreground max-sm:pl-4"
                >
                  {g.more.label}
                  <span className={cn(g.more.all === null && "rotate-180")}>{CHEVRON}</span>
                </Link>
              ) : null}
            </section>
          );
        })}
      </KeyList>
    </RowMenus>
  );
}

/** `.pl-zero`, in Testbench's `.inbox-empty`: a good result, said kindly, with the way on. */
export function ListZero({ title, note, action }: { title: string; note: string; action: { href: string; label: string } | null }) {
  return (
    <div className="grid justify-items-center gap-2.5 rounded-[14px] bg-card px-6 py-16 text-center shadow-[var(--shadow)]">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-5 text-muted-foreground" aria-hidden>
        <path d="m3 8.5 3.2 3.2L13 4.8" />
      </svg>
      <b className="font-sans text-[18px] leading-6 font-semibold tracking-[-0.01em]">{title}</b>
      <span className="text-[13px] text-faint">{note}</span>
      {action ? (
        <Link href={action.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1.5")}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
