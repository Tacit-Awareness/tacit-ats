import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Kbd as KeyCap } from "./keys";

// The page grammar, in Tacit Testbench's staff design (its mockups/staff-portal):
// a page title in Mona Sans on the box's grey surface with the actions on the
// same row and no line under it; soft white cards (14px, a ring and a soft drop
// shadow, no border) with a Mona Sans heading; a KPI strip of Geist Mono
// numbers; Linear-style list rows; tags that only take colour when it means
// something (green ok or done, red broken or overdue, amber waiting). Options are
// Testbench's segmented control, the picked one raised, with any count in a
// small tile over its corner. Text stays minimal: no subtitles or grey lines
// beside a title; detail goes in a hover title or the thing it opens.
// Server components, no state: every page composes these instead of restating
// the classes, so the pages cannot drift apart.

/**
 * The page column: up to 1600px with a gutter that grows with the window
 * (`--page-gutter`), as other dashboards fill the panel; 16px between blocks. With a
 * `bar` (a `PageBar`, and a `SubBar` under it), the bar runs edge to edge
 * across the panel and the column sits under it (the shell drops its own
 * padding around it, `.shell-page:has(> .page-top)` in globals.css), as
 * design/tats's `.bar` over its `.page`.
 */
export function Page({
  narrow = false,
  bleed = false,
  bar,
  stickyBar = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  narrow?: boolean;
  bar?: React.ReactNode;
  /** Fill the panel under the bar, no column (design/tats's `.calpage.fit`). */
  bleed?: boolean;
  /** Keep the bar on screen, from a tablet up (it wraps to several rows on a phone): for a long page whose actions are in it (the posting editor). */
  stickyBar?: boolean;
}) {
  const column = (
    <div
      className={cn(
        "mx-auto grid w-full content-start",
        bleed ? "gap-0" : cn("gap-5", narrow ? "max-w-[760px]" : "max-w-[1600px]", bar ? "px-[var(--page-gutter)] pt-1 pb-10" : ""),
        className,
      )}
      {...props}
    />
  );
  if (!bar) return column;
  return (
    <>
      <div className={cn("page-top", stickyBar && "md:sticky md:top-0 md:z-20 md:bg-background md:shadow-[0_1px_0_var(--line)]")}>{bar}</div>
      {column}
    </>
  );
}

/**
 * The page's title row, Testbench's `.page-head`: the title in Mona Sans (and
 * its count in a small tile) on the left, the page's filters or actions on the
 * same row on the right, on the box's surface with no rule under it. `crumbs`
 * lead the title with links back. `icon` is kept for callers; the sidebar
 * already carries each page's icon, so the title shows none.
 */
export function PageBar({
  title,
  icon,
  count,
  crumbs,
  lead,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  count?: React.ReactNode;
  crumbs?: Crumb[];
  /** Beside the title, left of the spacer: the Inbox's Open / Done. */
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-bar flex min-h-[72px] flex-wrap items-center gap-x-3 gap-y-2 px-[var(--page-gutter)] pt-5 pb-3">
      {/* A page's count ("43", "5 live") is a small extra fact Hy counts as eyebrow text: it is the title's hover and is read out, never drawn beside it. */}
      <h1
        className="m-0 flex min-w-0 items-center gap-2.5 font-sans text-[22px] leading-[30px] font-semibold tracking-[-0.02em]"
        title={typeof count === "string" || typeof count === "number" ? String(count) : undefined}
      >
        {icon ? <span className="sr-only">{/* the sidebar draws the icon */}</span> : null}
        {crumbs?.map((c) => (
          <React.Fragment key={c.href}>
            <Link href={c.href} className="truncate text-faint transition-colors hover:text-foreground">
              {c.label}
            </Link>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-[color:var(--ink-4)]" aria-hidden>
              <path d="M6 3.5l4.5 4.5L6 12.5" />
            </svg>
          </React.Fragment>
        ))}
        <span className="truncate">{title}</span>
        {count !== undefined && count !== null ? <span className="sr-only">{count}</span> : null}
      </h1>
      {lead}
      <span className="flex-1" />
      {/* ml-auto keeps the actions at the right when they wrap under the title */}
      {children ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div> : null}
    </header>
  );
}

/** The row under a `PageBar`: view tabs on the left, a search or switches on the right, on the surface with no rule. */
export function SubBar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("sub-bar flex min-h-[48px] flex-wrap items-center justify-between gap-2 px-[var(--page-gutter)] pt-1 pb-3", className)} {...props} />;
}

/** A count in a small tile, Testbench's inbox count: beside a title, never cramped into it. */
export function CountTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-grid h-6 min-w-6 flex-none place-items-center rounded-[6px] bg-[color:var(--paper)] px-1.5 font-mono text-[12px] leading-none font-medium tracking-normal text-muted-foreground tabular-nums shadow-[var(--btn-ring)]", className)}>
      {children}
    </span>
  );
}

/**
 * Testbench's search field: a GET form, 34px high, a magnifier, the query as
 * `name`. `keep` rides along as hidden fields so the other filters stay put.
 */
export function SearchBox({
  action,
  name = "q",
  defaultValue,
  placeholder,
  label,
  keep,
  className,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
  keep?: Record<string, string | null | undefined>;
  /** The field's width from a tablet up, when a placeholder needs more than 240px. */
  className?: string;
}) {
  return (
    <form action={action} method="get" role="search" className={cn("w-full sm:w-[240px]", className)}>
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="flex h-[34px] items-center gap-2 rounded-[7px] bg-[color:var(--paper)] pr-2 pl-3 text-faint shadow-[var(--shadow-sm)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.1)]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-[14px] shrink-0" aria-hidden>
          <path d="M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3" />
        </svg>
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={label}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:outline-none"
        />
      </label>
    </form>
  );
}

export type Crumb = { href: string; label: string };

/**
 * Title, actions right, Testbench's `.page-head`. A `subtitle` is not drawn under
 * the title (Testbench pages carry none); it stays as the heading's hover title
 * and for screen readers. `lead` is a glyph before the title.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  lead,
  badge,
  crumbs,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  lead?: React.ReactNode;
  badge?: React.ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="grid gap-2 pt-1 pb-2">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.href}>
              {i > 0 && <span aria-hidden>/</span>}
              <Link href={c.href} className="text-muted-foreground transition-colors hover:text-foreground">
                {c.label}
              </Link>
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {lead}
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-2.5 font-sans text-[26px] leading-[34px] font-semibold tracking-[-0.02em]" title={typeof subtitle === "string" ? subtitle : undefined}>
              {title}
              {badge}
            </h1>
            {subtitle && <span className="sr-only">{subtitle}</span>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export type Stat = { label: string; value: React.ReactNode; href?: string; tone?: "bad" };

/**
 * The KPI strip, Testbench's `.stats`: small labels over big numbers, one card
 * with ruled cells, each cell in one voice. The app's one number style
 * (app/client/stat-number.tsx draws the same for Home and Analytics): Mona Sans
 * in its proportional figures (its tabular ones bring a slashed zero and a footed
 * one, a code font's look), at weight 400 with normal tracking; a trailing ".0"
 * goes and a short unit (%, h, d, pts) sits
 * at half size in the muted ink beside the digits. A value that is not a plain
 * figure is drawn as it is, in the same face. The label names the number, so it
 * is Mona Sans too.
 */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  const figure = (value: React.ReactNode) => {
    if (typeof value !== "string" && typeof value !== "number") return value;
    const m = /^([+-]?)(\d[\d,]*)(?:\.(\d+))?(\s?)([a-z%]{1,3})?$/i.exec(String(value).trim());
    if (!m) return value;
    const [, sign, whole, decimals, , unit] = m;
    const frac = decimals && /[1-9]/.test(decimals) ? decimals : null;
    return (
      <>
        {sign}
        {whole}
        {frac ? `.${frac}` : null}
        {unit ? <small className="ml-[0.06em] text-[0.5em] text-muted-foreground">{unit}</small> : null}
      </>
    );
  };
  return (
    <div
      className={cn(
        // Each cell rules its own left and top edge, outside its box; the first
        // column's and row's fall outside the clipped card. So the strip stays
        // ruled when it wraps onto a second row in a narrow column, a short last
        // row leaves card rather than a grey hole, and a hovered cell (painted
        // before the cells after it) never covers a rule.
        "grid overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]",
        className,
      )}
    >
      {stats.map((s) => {
        const body = (
          <>
            <span className="font-sans text-[13px] leading-[18px] text-faint">{s.label}</span>
            <b className={cn("font-sans text-[30px] leading-none font-normal tracking-normal proportional-nums", s.tone === "bad" ? "text-negative" : "text-foreground")}>
              {figure(s.value)}
            </b>
          </>
        );
        const cls = "grid content-start gap-3.5 px-6 pt-5 pb-6 text-left shadow-[-1px_0_0_var(--line),0_-1px_0_var(--line)]";
        return s.href ? (
          <Link key={s.label} href={s.href} className={cn(cls, "transition-colors hover:bg-[color:var(--surface)]")}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** A faint count beside a heading. */
export function Count({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12.5px] font-normal tracking-normal text-faint tabular-nums">{children}</span>;
}

/** The heading row of a card: 13.5px title (+ count), anything on the right. */
export function SectionHead({
  title,
  count,
  aside,
  icon,
  className,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  aside?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[26px] flex-wrap items-center justify-between gap-2.5", className)}>
      <h2 className="m-0 flex items-center gap-2 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">
        {icon}
        {title}
        {count !== undefined && count !== null && <Count>{count}</Count>}
      </h2>
      {aside && <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-faint">{aside}</div>}
    </div>
  );
}

/** A card, Testbench's `.card`: white, 14px, a ring and a soft shadow, no border. `flush` puts the body edge to edge (tables, ruled rows) under the heading's own ruled row. */
export function Section({
  title,
  count,
  aside,
  icon,
  flush = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  count?: React.ReactNode;
  aside?: React.ReactNode;
  icon?: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 content-start rounded-[14px] bg-card text-[13px] shadow-[var(--shadow)]",
        flush ? "grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden" : "gap-3 px-5 pt-4 pb-5",
        className,
      )}
      {...props}
    >
      {title !== undefined && (
        <SectionHead
          title={title}
          count={count}
          aside={aside}
          icon={icon}
          className={flush ? "min-h-[52px] border-b border-[color:var(--line)] px-5 py-3" : undefined}
        />
      )}
      {children}
    </section>
  );
}

/** Two equal columns that fall to one on a phone. */
export function Grid2({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid items-start gap-5 md:grid-cols-2", className)} {...props} />;
}

/** Main column plus a 340px side column, stacked under 1100px. */
export function Split({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-5">{main}</div>
      <aside className="grid min-w-0 gap-5">{side}</aside>
    </div>
  );
}

/**
 * The list-and-reader page (Inbox, New Applicants, Interviews), Linear-style:
 * the title row on the box's surface, then one white card holding the list on
 * the left and the open item in a reader one shade down. Render it as the page
 * itself, not inside `Page`: it fills the box under the title (the shell drops
 * its padding around it, `.shell-page:has(> .list-reader)` in globals.css) and
 * each side scrolls on its own. On a phone it shows the list, or the reader
 * once something is `open`.
 */
export function ListReader({
  list,
  reader,
  open,
  listLabel,
  readerLabel,
  bar,
  narrowList = false,
  interviewList = false,
  flushReader = false,
}: {
  list: React.ReactNode;
  reader: React.ReactNode;
  open: boolean;
  listLabel: string;
  readerLabel: string;
  /** A `PageBar` across both panes. */
  bar?: React.ReactNode;
  /** design/tats's fixed 340px list (New Applicants) instead of 42%. */
  narrowList?: boolean;
  /** design/tats's `.ivw-list`: 360px, 280px in a window up to 1280px. */
  interviewList?: boolean;
  /** The reader with no padding of its own, for a reader that draws its own surface edge to edge. */
  flushReader?: boolean;
}) {
  const panes = (
    <div
      className={cn(
        "list-reader-card grid min-h-0 flex-1 overflow-hidden bg-card md:mx-[var(--page-gutter)] md:mb-[var(--page-gutter)] md:rounded-[14px] md:shadow-[var(--shadow)]",
        narrowList ? "md:grid-cols-[340px_minmax(0,1fr)]" : interviewList ? "md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]" : "md:grid-cols-[minmax(320px,42%)_minmax(0,1fr)]",
      )}
    >
      <section
        aria-label={listLabel}
        className={cn(
          "min-h-0 overflow-y-auto px-2 pt-2 pb-6 md:border-r md:border-[color:var(--line)]",
          narrowList && "bg-[color:var(--paper)]",
          open && "max-md:hidden",
        )}
      >
        {list}
      </section>
      <section aria-label={readerLabel} className={cn("min-h-0 overflow-y-auto bg-[color:var(--pane)]", !flushReader && "p-4", !open && "max-md:hidden")}>
        {reader}
      </section>
    </div>
  );
  return (
    <div className="list-reader flex min-h-0 flex-1 flex-col">
      {bar}
      {panes}
    </div>
  );
}

/** The list-row container; rows bleed 8px so their hover reaches the card padding. */
/** `ruled` is design/tats's `.lrow.pol`, for a `flush` Section: 56px rows edge to edge with a line between, the meta under the text on a phone. */
export function Rows({ tight = false, ruled = false, className, ...props }: React.ComponentProps<"div"> & { tight?: boolean; ruled?: boolean }) {
  return (
    <div
      data-tight={tight || undefined}
      data-ruled={ruled || undefined}
      className={cn("group/rows grid", ruled ? "divide-y divide-[color:var(--line)]" : "-mx-2 gap-px", className)}
      {...props}
    />
  );
}

/** One compact row: icon, a bold line over a muted one, meta right-aligned. */
export function Row({
  href,
  icon,
  title,
  sub,
  meta,
  metaTone,
  className,
  children,
}: {
  href?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  metaTone?: "late";
  className?: string;
  children?: React.ReactNode;
}) {
  const cls = cn(
    "flex min-w-0 items-center gap-3 rounded-[8px] px-2.5 py-2 text-left group-data-[tight]/rows:py-1.5",
    "group-data-[ruled]/rows:min-h-14 group-data-[ruled]/rows:rounded-none group-data-[ruled]/rows:px-5 max-sm:group-data-[ruled]/rows:flex-wrap",
    href && "transition-colors hover:bg-[color:var(--surface)]",
    className,
  );
  const body = (
    <>
      {icon}
      <span className="grid min-w-0 flex-1 max-sm:group-data-[ruled]/rows:basis-[calc(100%-41px)]">
        <b className="max-w-full justify-self-start truncate text-[13px] font-medium text-foreground">{title}</b>
        {sub && <span className="max-w-full justify-self-start truncate text-xs text-muted-foreground">{sub}</span>}
        {children}
      </span>
      {meta && (
        <span className={cn("flex flex-none items-center gap-2.5 text-[12px] max-sm:group-data-[ruled]/rows:max-w-full max-sm:group-data-[ruled]/rows:flex-wrap", metaTone === "late" ? "text-negative" : "text-faint")}>
          {meta}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const PILL_TONES = {
  green: "text-positive bg-[color:var(--green-soft)]",
  red: "text-negative bg-[color:var(--red-soft)]",
  grey: "text-muted-foreground bg-[color:var(--soft-strong)]",
  amber: "text-[color:var(--amber)] bg-[color:var(--amber-soft)]",
  blue: "text-[color:var(--accent)] bg-[color:var(--accent-soft)]",
} as const;

/** A status tag, Testbench's `.tag`: 12px Geist Mono on a flat fill, 6px corners, colour only for meaning. */
export function Pill({ tone = "grey", className, ...props }: React.ComponentProps<"span"> & { tone?: keyof typeof PILL_TONES }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-[5px] rounded-[6px] px-2 font-mono text-[12px] leading-none font-medium whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Testbench's `.chip`: an outlined label for tags, names, filters. `muted` is the dashed "not in Tacit yet" one. */
export function Chip({
  href,
  muted = false,
  active = false,
  className,
  children,
  title,
}: {
  href?: string;
  muted?: boolean;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const cls = cn(
    "inline-flex h-[26px] items-center gap-1.5 rounded-[6px] border px-[9px] font-mono text-[12.5px] leading-none whitespace-nowrap",
    muted ? "border-dashed border-[color:var(--line-strong)] text-faint" : "border-[color:var(--line-strong)] text-muted-foreground",
    active && "border-transparent bg-[color:var(--soft-strong)] font-medium text-foreground",
    href && "transition-colors hover:bg-[color:var(--hover)] hover:text-foreground",
    className,
  );
  return href ? (
    <Link href={href} className={cls} title={title} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

/** Wrapping row of chips. */
export function Chips({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

// design/tats's people colours: muted, dark enough for white initials in
// both themes. There is no colour column, so a name always hashes to the same one.
const AVATAR_COLORS = ["#3c6e8f", "#7a5c3e", "#6b7a90", "#4f7a65", "#8a6a3a", "#5b5f99", "#8a4f6e", "#4d6f8c", "#9a5a4a", "#6a7d3c"] as const;

/** Off: Testbench draws no avatars. Kept as a switch so the old drawing stays one line away. */
const DRAW_AVATARS = false as boolean;

export function avatarColor(name: string | null | undefined): string {
  let h = 0;
  for (const ch of (name ?? "").trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/**
 * A person's mark. Testbench shows a name alone, never a picture or initials
 * (not beside a row, not in the corner), so this draws nothing: every caller
 * already prints the name beside it. The sizes and `avatarColor` stay for the
 * places that colour a person's own things (the calendar's lanes).
 */
export function Avatar(props: { name: string | null | undefined; size?: "xs" | "sm" | "lg" | "md" | "row" | "ticket" | "xl"; candidate?: boolean }) {
  const { name, size = "sm" } = props;
  if (DRAW_AVATARS !== true) return null;
  return (
    <span
      aria-hidden
      style={{ "--c": avatarColor(name) } as React.CSSProperties}
      className={cn(
        "av-tone grid flex-none place-items-center rounded-full font-semibold text-[color:var(--n25)]",
        size === "xl"
          ? "size-11 text-[15px]"
          : size === "ticket"
            ? "size-9 text-[12.5px]"
            : size === "row"
              ? "size-8 text-[12px]"
              : size === "xs"
                ? "size-5 text-[8.5px]"
            : size === "md"
              ? "size-7 text-[10.5px]"
              : size === "lg"
                ? "size-6 text-[9.5px]"
                : "size-[22px] text-[9.5px]",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** A company's square glyph, Testbench's `.glyph`: its initials in Geist Mono on ink. */
export function Glyph({ name, size = "sm" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const text = initialsOf(name).slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid flex-none place-items-center rounded-[6px] bg-[color:var(--primary)] font-mono font-semibold text-[color:var(--primary-ink)]",
        size === "lg" ? "size-9 rounded-[8px] text-[12px]" : size === "md" ? "size-[30px] text-[11px]" : "size-[22px] text-[9.5px]",
      )}
    >
      {text}
    </span>
  );
}

/** A label/value list: 110px muted labels, values beside. */
export function KeyValues({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-faint">{k}</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-foreground">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The small sub-heading inside a card: a plain 500-weight label, as design/tats's form labels. */
export function MiniTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 font-sans text-[13px] font-semibold text-foreground", className)} {...props} />;
}

/** The quiet line a card shows when it has nothing. */
export function Empty({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("my-1 text-[13px] text-faint", className)} {...props} />;
}

/** Inline text link: quiet until hovered, the accent on hover. */
export const textLink = "inline-flex items-center gap-1 text-[12.5px] text-muted-foreground underline decoration-[color:var(--line-strong)] underline-offset-[3px] transition-colors hover:text-foreground hover:decoration-current";

/** A connector's logo for its row. Testbench boxes no icons, so the logo stands alone in a 30px slot. */
export function AppTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-[30px] flex-none place-items-center",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type Tab = { href: string; label: React.ReactNode; count?: React.ReactNode; active: boolean };

/**
 * Testbench's segmented control (`.seg`): one faint track, 11px corners. It
 * scrolls sideways on a phone rather than wrapping; from a tablet up it lets a
 * count tile sit over an option's corner.
 */
export const pillTrack =
  "pill-track inline-flex w-fit max-w-full min-w-0 items-center gap-0.5 self-center rounded-[11px] bg-[color:var(--track)] p-[3px] shadow-[inset_0_0_0_1px_rgba(22,23,26,0.03)] max-md:overflow-x-auto max-md:[scrollbar-width:none]";

/**
 * An option on a `pillTrack`: Mona Sans, the picked one raised white (graphite
 * in dark mode), the rest muted. `sm` is Testbench's `.seg.small`, for a switch
 * that sits beside a title or inside a card rather than leading a page.
 */
export const pillOption = (picked: boolean, size: "md" | "sm" = "md") =>
  cn(
    "relative inline-flex flex-none items-center gap-1.5 rounded-[8px] font-sans leading-none font-medium whitespace-nowrap transition-colors",
    size === "sm" ? "h-[26px] rounded-[7px] px-2.5 text-[12.5px]" : "h-[30px] px-3 text-[13.5px]",
    picked ? "bg-[color:var(--pick)] text-[color:var(--pick-ink)] shadow-[var(--pick-shadow)]" : "text-muted-foreground hover:text-foreground",
  );

/** A count over an option's corner, Testbench's `.seg .count`: out of the option's way, never cramped into it. Inline on a phone, where the track scrolls. */
export function OptionCount({ children, hot = false }: { children: React.ReactNode; hot?: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none z-[2] grid h-[18px] min-w-[18px] place-items-center rounded-[6px] px-[5px] font-mono text-[10.5px] leading-none font-medium tabular-nums",
        "md:absolute md:-top-[9px] md:-right-[7px]",
        hot ? "bg-[color:var(--primary)] text-[color:var(--primary-ink)] shadow-[0_2px_6px_-2px_rgba(22,23,26,0.4)]" : "bg-[color:var(--paper)] text-muted-foreground shadow-[var(--shadow-sm)]",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Filter tabs, and with `strip` the view tabs of a `SubBar`: links on a
 * `pillTrack`, so `strip` only says where it sits. A count sits in a small tile
 * over the option's corner, as Testbench's nav counts do.
 */
export function Tabs({ tabs, label, className }: { tabs: Tab[]; label: string; className?: string; strip?: boolean }) {
  return (
    <nav aria-label={label} className={cn(pillTrack, className)}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={pillOption(t.active)}>
          {t.label}
          {t.count !== undefined && <OptionCount>{t.count}</OptionCount>}
        </Link>
      ))}
    </nav>
  );
}

/** The page's filter row: tabs on the left, search and view switches on the right. */
export function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 pt-1", className)} {...props} />;
}

/** A two-way segmented switch made of links (the URL is the view state). */
export function Segmented({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className={pillTrack}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={it.active ? "page" : undefined} className={pillOption(it.active)}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A key inside the button it presses, Testbench's `.btn kbd`: keys.tsx's keycap,
 * always decorative here (the button's `aria-keyshortcuts` is what a screen
 * reader should hear) and tucked toward the button's edge. One keycap for the
 * whole app; never a separate hint row.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <KeyCap decorative className={cn("-mr-1", className)}>
      {children}
    </KeyCap>
  );
}

/**
 * Testbench's status glyphs (its staff list's `StatusGlyph`): small squares, never
 * dots. A square fills left to right as something moves along (`empty`,
 * `quarter`, `half`, `most`, `full`), then ends `done` (green, ticked), `closed`
 * (grey, crossed) or `lapsed` (dashed). `live` is happening now (the accent,
 * dashed), `pending` is being worked on (a turning corner), `alert` needs someone
 * (red). `color` tints the progress kinds (a stage's `--st-*`). Give a `title`
 * when the glyph is the only place the status shows.
 */
export type GlyphKind = "empty" | "quarter" | "half" | "most" | "full" | "done" | "closed" | "lapsed" | "live" | "pending" | "alert";

/** An application stage's glyph, so every page draws a stage the same way. */
export const STAGE_GLYPH: Record<string, GlyphKind> = {
  sourced: "empty",
  contacted: "quarter",
  screening: "half",
  interviewing: "most",
  offer: "full",
  hired: "done",
  placed: "done",
  rejected: "closed",
  withdrawn: "lapsed",
};

export function StatusGlyph({ kind, color, title, className, still = false }: { kind: GlyphKind; color?: string; title?: string; className?: string; still?: boolean }) {
  const ink = color ?? "var(--ink)";
  // `pending` turns while something works on it; `still` keeps it from turning
  // when the wait is on a person (a read nobody has written yet), not a process.
  const cls = cn("size-[14px] shrink-0", kind === "pending" && !still && "motion-safe:animate-spin", className);
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
  const frame = (stroke: string, dash?: string) => <rect x="2" y="2" width="10" height="10" rx="2" fill="none" stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} />;
  const fill = (w: number) => <path d={`M2 4a2 2 0 0 1 2-2h${w - 2}v10H4a2 2 0 0 1-2-2z`} fill={ink} />;
  let body: React.ReactNode;
  switch (kind) {
    case "empty":
      body = frame(color ?? "var(--faint)");
      break;
    case "quarter":
      body = (
        <>
          {frame(ink)}
          <rect x="2" y="2" width="3" height="10" rx="1.2" fill={ink} />
        </>
      );
      break;
    case "half":
      body = (
        <>
          {frame(ink)}
          {fill(5)}
        </>
      );
      break;
    case "most":
      body = (
        <>
          {frame(ink)}
          <path d="M2 4a2 2 0 0 1 2-2h5.5v10H4a2 2 0 0 1-2-2z" fill={ink} />
        </>
      );
      break;
    case "full":
      body = <rect x="2" y="2" width="10" height="10" rx="2" fill={ink} stroke={ink} strokeWidth="1.4" />;
      break;
    case "done":
      // Green by default; `color` quiets it (e.g. var(--faint)) where a long run
      // of ordinary finished things would otherwise all shout green.
      body = (
        <>
          <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill={color ?? "var(--green)"} />
          <path d="m4.5 7.2 1.7 1.7 3.4-3.6" fill="none" stroke="var(--paper)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case "closed":
      body = (
        <>
          <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="var(--faint)" />
          <path d="m5 5 4 4M9 5 5 9" stroke="var(--paper)" strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
      break;
    case "lapsed":
      body = frame("var(--faint)", "1.2 2");
      break;
    case "live":
      body = (
        <>
          {frame("var(--accent)", "2.4 1.6")}
          <rect x="5" y="5" width="4" height="4" rx="1" fill="var(--accent)" />
        </>
      );
      break;
    case "pending":
      body = (
        <>
          {frame("var(--line-strong)")}
          <path d="M7 2h3a2 2 0 0 1 2 2v3" fill="none" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
      break;
    case "alert":
      body = (
        <>
          <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="var(--red)" />
          <path d="M7 4.3v3.4" stroke="var(--paper)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="9.9" r=".85" fill="var(--paper)" />
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 14 14" className={cls} {...a11y}>
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}

/**
 * A candidate's place in an ordered process, as the mockup's step pills:
 * passed steps ticked, the current one raised, later ones faint. `current`
 * outside `stages` (an outcome such as rejected) leaves every step unlit.
 */
export function StageSteps({ stages, current, labels }: { stages: readonly string[]; current: string | null; labels?: Record<string, string> }) {
  const at = current ? stages.indexOf(current) : -1;
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {stages.map((stage, i) => {
        const done = at >= 0 && i < at;
        const cur = i === at;
        const raw = labels?.[stage] ?? stage.replace(/_/g, " ");
        // Sentence case, as every Testbench label: "Phone screen", not "Phone Screen".
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        return (
          <li
            key={stage}
            aria-current={cur ? "step" : undefined}
            className={cn(
              "inline-flex h-[26px] items-center gap-1.5 rounded-[6px] border px-2.5 font-mono text-[12px]",
              cur
                ? stage === "hired" || stage === "placed"
                  ? "border-[color:var(--green)] bg-positive-soft font-medium text-positive"
                  : "border-transparent bg-[color:var(--pick)] font-medium text-foreground shadow-[var(--shadow-sm)]"
                : done
                  ? "border-[color:var(--line-strong)] text-muted-foreground"
                  : "border-dashed border-[color:var(--line-strong)] text-faint",
            )}
          >
            {done && (
              <svg viewBox="0 0 16 16" className="size-[11px] text-positive" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A flash line under the header, from a notice or error code (the ATS's
 * addition): a quiet grey well that reads inside a card or on the box, red
 * only for an error.
 */
export function Notice({ tone = "info", className, ...props }: React.ComponentProps<"p"> & { tone?: "info" | "error" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "m-0 rounded-[10px] px-4 py-3 text-[13px]",
        tone === "error"
          ? "bg-negative-soft text-negative shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--red)_25%,transparent)]"
          : "bg-[color:var(--soft)] text-muted-foreground shadow-[inset_0_0_0_1px_var(--line)]",
        className,
      )}
      {...props}
    />
  );
}
