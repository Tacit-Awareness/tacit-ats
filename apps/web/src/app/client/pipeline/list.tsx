import Link from "next/link";
import { KeyList } from "@/components/keys";
import type { PipelineRow, RowGroup, StageCount } from "@/lib/client/pipeline-list";
import { hoverAttr } from "@/lib/hover-card";
import { cn } from "@/lib/utils";
import type { CardMoves } from "@/lib/client/pipeline-moves";
import { RowMenus, type RowCard } from "./row-menu";

// The Pipeline's list, design/tats's "Pipeline at scale": a stage bar that
// filters, then one email-like line per person, grouped by stage. Links, so the
// URL holds the state and J / K / Enter work through KeyList. Rows carry no
// buttons: a row opens the candidate in a pop-up (popup.tsx, `?open=`), and a
// right-click or S is the board's stage menu on a job the member may edit
// (row-menu.tsx). Over the list J and K move focus and Enter opens; in the
// pop-up they walk the rows, as the Inbox's do.
// The soft reds are the prototype's `.pl-sc em`.

export type StageCard = StageCount & { href: string; active: boolean };
export type ListRow = PipelineRow & {
  openHref: string;
  active: boolean;
  /** What a move needs, on a job the member may edit: the same check as a board card's. */
  menu?: { stage: string; stageLabel: string; moves: CardMoves } | null;
};
export type ListGroup = Omit<RowGroup, "rows"> & { rows: ListRow[]; moreHref: string | null };

const SOFT_RED =
  "border border-[color:color-mix(in_oklch,var(--red)_22%,transparent)] bg-[color:color-mix(in_oklch,var(--red)_8%,var(--paper))] group-hover:border-[color:color-mix(in_oklch,var(--red)_32%,transparent)] group-hover:bg-[color:color-mix(in_oklch,var(--red)_13%,var(--paper))]";

/** `.pl-fun`: each card as wide as its headcount asks for; it scrolls sideways before it squashes. */
export function StageBar({ stages }: { stages: StageCard[] }) {
  return (
    <nav aria-label="Filter by stage" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
      {stages.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          scroll={false}
          aria-current={s.active ? "true" : undefined}
          title={`${s.label}: ${s.total} in this stage, ${s.stuck} stuck`}
          style={{ flexGrow: Math.max(s.total, 1) }}
          className={cn(
            "group grid min-w-[112px] flex-[1_1_0] gap-1.5 overflow-hidden border bg-[color:var(--paper)] px-3.5 pt-3 shadow-[var(--shadow)] transition-colors hover:bg-[color:var(--hover)]",
            s.stuck > 0 && "min-w-[156px]",
            s.active ? "border-foreground" : "border-[color:var(--line)]",
          )}
        >
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">{s.label}</span>
          <span className="flex items-center gap-2">
            <b className="text-[20px] font-semibold tracking-[-0.01em] tabular-nums">{s.total}</b>
            {s.stuck > 0 ? (
              <span className={cn("inline-flex h-5 items-center gap-[5px] rounded-full px-2 text-[12px] font-medium whitespace-nowrap text-negative transition-colors", SOFT_RED)}>
                <i aria-hidden className="size-[5px] rounded-full bg-current" />
                {s.stuck} stuck
              </span>
            ) : null}
          </span>
          <i aria-hidden className="-mx-3.5 mt-1.5 block h-[3px] bg-[color:var(--line)]">
            <i className="block h-full bg-negative" style={{ width: `${s.share}%` }} />
          </i>
        </Link>
      ))}
    </nav>
  );
}

/** `.pl-r`: 40px, name, status in bold, facts in grey, time at the end. Two lines on a phone. */
function Row({ row }: { row: ListRow }) {
  return (
    <Link
      href={row.openHref}
      scroll={false}
      data-key-item
      data-pop-row={row.applicationId}
      aria-current={row.active ? "true" : undefined}
      aria-haspopup="dialog"
      aria-label={`${row.name}: ${row.status}. ${row.facts}. ${row.time} since last touched${row.stuck ? ", stuck" : ""}.`}
      className="grid h-10 grid-cols-[8px_minmax(120px,170px)_minmax(0,1fr)_44px] items-center gap-3 px-3 text-[14px] transition-colors hover:bg-[color:var(--hover)] hover:shadow-[inset_0_0_0_1px_var(--line)] focus-visible:bg-[color:var(--sel)] max-sm:h-auto max-sm:grid-cols-[8px_minmax(0,1fr)_44px] max-sm:gap-y-0.5 max-sm:py-2"
    >
      <i aria-hidden className={cn("size-[7px] rounded-full", row.stuck && "bg-negative")} />
      <span data-hc={hoverAttr("candidate", row.personId)} className={cn("truncate", row.stuck ? "font-semibold" : "font-medium")}>
        {row.name}
      </span>
      <span className="min-w-0 truncate max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 max-sm:text-[13px]">
        <b className="font-semibold">{row.status}</b>
        <span className="ml-2.5 text-muted-foreground">{row.facts}</span>
      </span>
      <span
        title="Since their last stage move or logged touch"
        className={cn("text-right text-[12.5px] tabular-nums max-sm:col-start-3 max-sm:row-start-1", row.stuck ? "text-negative" : "text-faint")}
      >
        {row.time}
      </span>
    </Link>
  );
}

export function PipelineList({ groups, popup }: { groups: ListGroup[]; popup: boolean }) {
  const cards = groups.flatMap((g) =>
    g.rows.flatMap((r): RowCard[] =>
      r.menu
        ? [{ applicationId: r.applicationId, personId: r.personId, name: r.name, href: r.href, openHref: r.openHref, stage: r.menu.stage, stageLabel: r.menu.stageLabel, moves: r.menu.moves }]
        : [],
    ),
  );
  return (
    <RowMenus cards={cards} popup={popup}>
      <KeyList title="Pipeline" next="Next person" mode={popup ? "select" : "focus"} data-tour="board">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h2 className="m-0 flex items-center gap-2 px-3 pt-5 pb-1 text-[13px] font-medium text-muted-foreground">
              {g.label}
              <span className="font-normal text-faint tabular-nums">{g.total}</span>
            </h2>
            {g.rows.map((row) => (
              <Row key={row.applicationId} row={row} />
            ))}
            {g.more && g.moreHref ? (
              <Link
                href={g.moreHref}
                scroll={false}
                className="mt-2 ml-3 inline-flex h-8 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--paper)] px-4 text-[13px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
              >
                {g.more.label}
              </Link>
            ) : null}
          </section>
        ))}
      </KeyList>
    </RowMenus>
  );
}

/** `.pl-zero`: a good result, said kindly, with the way on. */
export function ListZero({ title, note, action }: { title: string; note: string; action: { href: string; label: string } | null }) {
  return (
    <div className="grid justify-items-center gap-1.5 py-16 text-center text-[13.5px] text-muted-foreground">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
        <path d="m3 8.5 3.2 3.2L13 4.8" />
      </svg>
      <b className="font-semibold text-foreground">{title}</b>
      <span>{note}</span>
      {action ? (
        <Link
          href={action.href}
          className="mt-2 inline-flex h-8 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--paper)] px-4 text-[13px] transition-colors hover:bg-[color:var(--hover)]"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
