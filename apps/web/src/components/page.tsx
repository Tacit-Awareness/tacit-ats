import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

// The page grammar of tacit-internal's 2026-10 Workspace redesign (its
// apps/internal components/page.tsx; Hy's mockup), in design/tats's palette
// since 2026-10-29: a header with the title, a muted line and the actions on
// the right; a KPI strip in pixel numbers; cards with a small section heading
// and count; compact list rows; pills that only take colour when it means
// something (green ok/done, red broken or overdue, indigo for the action).
// Structure is square, anything you press is a pill. Lines come in two weights:
// `--line-strong` for structure (page bars, sub-bars, list | reader splits, table
// heads), `--line` inside a box; strips and heads are shaded one step down from
// the panel (`--surface` on `--paper`). Server components, no state: every page
// composes these instead of restating the classes, so the pages cannot drift apart.

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
        bleed ? "gap-0" : cn("gap-4", narrow ? "max-w-[760px]" : "max-w-[1600px]", bar ? "px-[var(--page-gutter)] pt-6 pb-10" : ""),
        className,
      )}
      {...props}
    />
  );
  if (!bar) return column;
  return (
    <>
      <div className={cn("page-top", stickyBar && "md:sticky md:top-0 md:z-20 md:bg-background")}>{bar}</div>
      {column}
    </>
  );
}

/**
 * design/tats's page bar: a 48px ruled strip with the title (and its count,
 * faint) on the left and the page's filters or actions on the right. With an
 * `icon` it is the prototype's crumbs bar (Home, CRM, Pipeline, Referrals:
 * 13.5px beside the icon); without, its plain title bar (15px). `crumbs` lead
 * the title with links back.
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
    <header className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] py-2 pr-4 pl-4 md:pl-6">
      <h1 className={cn("m-0 flex min-w-0 items-center gap-2 font-medium", icon || crumbs?.length ? "text-[14px]" : "text-[15px] tracking-[-0.008em]")}>
        {icon ? <span className="text-muted-foreground [&>svg]:size-[15px]">{icon}</span> : null}
        {crumbs?.map((c) => (
          <React.Fragment key={c.href}>
            <Link href={c.href} className="truncate text-foreground transition-colors hover:text-muted-foreground">
              {c.label}
            </Link>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-3 shrink-0 text-faint" aria-hidden>
              <path d="M6 4l4 4-4 4" />
            </svg>
          </React.Fragment>
        ))}
        <span className="truncate">{title}</span>
        {count !== undefined && count !== null ? <span className="font-normal text-faint tabular-nums">{count}</span> : null}
      </h1>
      {lead}
      <span className="flex-1" />
      {children ? <div className="flex flex-wrap items-center gap-1.5">{children}</div> : null}
    </header>
  );
}

/** The strip under a `PageBar`: view tabs on the left, a search or switches on the right, ruled underneath. */
export function SubBar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-h-[50px] flex-wrap items-center justify-between gap-2 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] px-4 py-2 md:px-6", className)} {...props} />;
}

/**
 * design/tats's small search box (`.searchbox.sm`): a GET form, 28px high,
 * a magnifier, the query as `name`. `keep` rides along as hidden fields so
 * the other filters stay put.
 */
export function SearchBox({
  action,
  name = "q",
  defaultValue,
  placeholder,
  label,
  keep,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
  keep?: Record<string, string | null | undefined>;
}) {
  return (
    <form action={action} method="get" role="search" className="w-full sm:w-[220px]">
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="flex h-7 items-center gap-2 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--paper)] pr-1.5 pl-2.5 text-faint focus-within:border-[color:var(--line-strong)] focus-within:shadow-[var(--shadow)]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-[13px] shrink-0" aria-hidden>
          <path d="M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3" />
        </svg>
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={label}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
        />
      </label>
    </form>
  );
}

export type Crumb = { href: string; label: string };

/** Title, muted subtitle, actions right. `lead` is an avatar or company glyph before the title. */
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
    <header className="grid gap-2 pb-1">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-faint">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.href}>
              {i > 0 && <span aria-hidden>/</span>}
              <Link href={c.href} className="font-mono tracking-[-0.03em] text-muted-foreground transition-colors hover:text-foreground">
                {c.label}
              </Link>
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {lead}
          <div className="min-w-0">
            <h1 className="m-0 flex flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-[-0.025em]">
              {title}
              {badge}
            </h1>
            {subtitle && <p className="mt-1 max-w-[70ch] text-[13.5px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export type Stat = { label: string; value: React.ReactNode; href?: string; tone?: "bad" };

/** The KPI strip: mono labels over Departure Mono numbers, one bordered band. */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div
      className={cn(
        // Each cell rules its own right and bottom edge; the outer ones fall
        // outside the clipped box. So the strip stays ruled when it wraps onto
        // a second row in a narrow column, and a short last row leaves card,
        // not a grey hole.
        "grid overflow-hidden rounded-[12px] border border-[color:var(--line)] bg-card [grid-template-columns:repeat(auto-fit,minmax(118px,1fr))]",
        className,
      )}
    >
      {stats.map((s) => {
        const body = (
          <>
            <span className="font-mono text-xs tracking-[-0.04em] text-muted-foreground">{s.label}</span>
            <b className={cn("font-pixel text-[28px] leading-none font-normal tracking-[-0.06em]", s.tone === "bad" ? "text-negative" : "text-foreground")}>
              {s.value}
            </b>
          </>
        );
        const cls = "grid gap-2 px-4 pt-3.5 pb-[13px] text-left shadow-[1px_0_0_var(--line),0_1px_0_var(--line)]";
        return s.href ? (
          <Link key={s.label} href={s.href} className={cn(cls, "transition-colors hover:bg-accent")}>
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
  return <span className="text-[13px] font-normal text-faint tabular-nums">{children}</span>;
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
      <h2 className="m-0 flex items-center gap-2 text-[13.5px] font-semibold tracking-normal">
        {icon}
        {title}
        {count !== undefined && count !== null && <Count>{count}</Count>}
      </h2>
      {aside && <div className="flex flex-wrap items-center gap-2.5 text-xs text-faint">{aside}</div>}
    </div>
  );
}

/** A card. `flush` is design/tats's `.cardbox`: the body edge to edge (tables, ruled rows), the heading in its own ruled band. */
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
        "grid min-w-0 content-start rounded-[12px] border border-[color:var(--line)] bg-card text-[13px] shadow-[var(--shadow)]",
        flush ? "grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden" : "gap-2.5 px-4 py-3.5",
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
          className={flush ? "min-h-10 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3.5 [&>h2]:font-medium" : undefined}
        />
      )}
      {children}
    </section>
  );
}

/** Two equal columns that fall to one on a phone. */
export function Grid2({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid items-start gap-4 md:grid-cols-2", className)} {...props} />;
}

/** Main column plus a 340px side column, stacked under 1100px. */
export function Split({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-4">{main}</div>
      <aside className="grid min-w-0 gap-4">{side}</aside>
    </div>
  );
}

/**
 * design/tats's list-and-reader page (Inbox, New Applicants, Interviews):
 * a list on the left, the open item in a reader one shade down. Render it as
 * the page itself, not inside `Page`: it fills the panel edge to edge (the
 * shell drops its padding around it, `.shell-page:has(> .list-reader)` in
 * globals.css) and each side scrolls on its own. On a phone it shows the
 * list, or the reader once something is `open`.
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
        "grid min-h-0 flex-1",
        narrowList ? "md:grid-cols-[340px_minmax(0,1fr)]" : interviewList ? "md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]" : "md:grid-cols-[minmax(320px,42%)_minmax(0,1fr)]",
      )}
    >
      <section
        aria-label={listLabel}
        className={cn(
          "min-h-0 overflow-y-auto px-2 pt-2 pb-6 md:border-r md:border-[color:var(--line-strong)]",
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
      className={cn("group/rows grid", ruled ? "divide-y divide-[color:var(--line)]" : "-mx-2", className)}
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
    "flex min-w-0 items-center gap-[11px] px-2 py-2 text-left group-data-[tight]/rows:py-1.5",
    "group-data-[ruled]/rows:min-h-14 group-data-[ruled]/rows:px-3.5 max-sm:group-data-[ruled]/rows:flex-wrap",
    href && "transition-colors hover:bg-accent",
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
        <span className={cn("flex flex-none items-center gap-2.5 text-xs max-sm:group-data-[ruled]/rows:max-w-full max-sm:group-data-[ruled]/rows:flex-wrap", metaTone === "late" ? "text-negative" : "text-foreground/75")}>
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
  grey: "text-muted-foreground bg-[color:var(--soft)]",
} as const;

/** A status pill (design/tats's `.h-out`): 12px sans on a flat soft fill, colour only for meaning. */
export function Pill({ tone = "grey", className, ...props }: React.ComponentProps<"span"> & { tone?: keyof typeof PILL_TONES }) {
  return (
    <span
      className={cn(
        "inline-grid h-[22px] place-items-center rounded-full px-2 text-[12px] whitespace-nowrap",
        PILL_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A hairline chip: tags, names, filters. `muted` is the dashed "not in Tacit yet" one. */
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
    "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap",
    muted ? "border-dashed border-[color:var(--line-strong)] text-faint" : "border-[color:var(--line)] text-foreground/80",
    active && "border-transparent bg-[color:var(--soft-strong)] font-medium text-foreground",
    href && "transition-colors hover:bg-accent hover:text-foreground",
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

export function avatarColor(name: string | null | undefined): string {
  let h = 0;
  for (const ch of (name ?? "").trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/**
 * The round initials avatar: initials on a solid colour per name, in the
 * brand's hue (`.av-tone` in globals.css). `candidate` is design/tats's `.av.cand`:
 * an applicant has no picture, so it draws nothing, and rows hold no room for
 * one; colour stays for the team. `xs` is 20px
 * (card owners, activity), `lg` 24px (table rows), `md` 28px, `row` 32px
 * (list rows), `ticket` 36px, `xl` 44px.
 */
export function Avatar({ name, size = "sm", candidate = false }: { name: string | null | undefined; size?: "xs" | "sm" | "lg" | "md" | "row" | "ticket" | "xl"; candidate?: boolean }) {
  if (candidate) return null;
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

/** A company's square glyph: its initials in pixel type. */
export function Glyph({ name, size = "sm" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const text = initialsOf(name).slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid flex-none place-items-center bg-raised font-pixel text-foreground/80 shadow-[inset_0_0_0_1px_var(--line-strong)]",
        size === "lg" ? "size-9 text-[13px]" : size === "md" ? "size-[30px] text-xs" : "size-[22px] text-[9.5px]",
      )}
    >
      {text}
    </span>
  );
}

/** A label/value list: 110px muted labels, values beside. */
export function KeyValues({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-faint">{k}</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-foreground/80">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The small sub-heading inside a card: a plain 500-weight label, as design/tats's form labels. */
export function MiniTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 text-[12.5px] font-medium text-muted-foreground", className)} {...props} />;
}

/** The quiet line a card shows when it has nothing. */
export function Empty({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("my-1 text-[12.5px] text-faint", className)} {...props} />;
}

/** Inline text link: quiet until hovered, the accent on hover. */
export const textLink = "inline-flex items-center gap-1 text-[12.5px] text-foreground/75 transition-colors hover:text-[color:var(--accent)]";

/** A 30px app tile for connector rows, design/tats's `.set-tile`. */
export function AppTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-[30px] flex-none place-items-center rounded-[8px] border border-[color:var(--line)] bg-[color:var(--paper)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type Tab = { href: string; label: React.ReactNode; count?: React.ReactNode; active: boolean };

/** design/tats's option group: one grey pill track. It scrolls sideways on a phone rather than wrapping, which a pill cannot do. */
export const pillTrack =
  "pill-track inline-flex w-fit max-w-full min-w-0 items-center gap-0.5 self-center overflow-x-auto rounded-full bg-[color:var(--soft-strong)] p-[3px] [scrollbar-width:none]";

/** An option on a `pillTrack`: the picked one a dark pill (light in dark mode), the rest muted text. */
export const pillOption = (picked: boolean) =>
  cn(
    "inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors ease-[var(--spring)]",
    picked ? "bg-[color:var(--pick)] text-[color:var(--pick-ink)]" : "text-muted-foreground hover:text-foreground",
  );

/**
 * Filter tabs, and with `strip` the view tabs of a `SubBar` (design/tats's
 * `.tabs`, `.crm-tabs`, `.hm-nav`): since v69 the two look the same, links on a
 * `pillTrack`, so `strip` only says where it sits. Counts take the option's own
 * colour, so they read on the dark pill.
 */
export function Tabs({ tabs, label, className }: { tabs: Tab[]; label: string; className?: string; strip?: boolean }) {
  return (
    <nav aria-label={label} className={cn(pillTrack, className)}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={pillOption(t.active)}>
          {t.label}
          {t.count !== undefined && <span className="text-[12.5px] font-normal tabular-nums opacity-70">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** The page's filter row: tabs on the left, search and view switches on the right. */
export function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3", className)} {...props} />;
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
        const label = labels?.[stage] ?? stage.replace(/_/g, " ");
        return (
          <li
            key={stage}
            aria-current={cur ? "step" : undefined}
            className={cn(
              "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs capitalize",
              cur
                ? stage === "hired" || stage === "placed"
                  ? "border-[color:var(--green)] bg-positive-soft font-medium text-positive"
                  : "border-[color:var(--line-strong)] bg-[color:var(--soft-strong)] font-medium text-foreground"
                : done
                  ? "border-[color:var(--line)] text-foreground/80"
                  : "border-[color:var(--line)] text-faint",
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
 * addition): a hairline band, red only for an error.
 */
export function Notice({ tone = "info", className, ...props }: React.ComponentProps<"p"> & { tone?: "info" | "error" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "m-0 border px-3.5 py-2.5 text-[13px]",
        tone === "error"
          ? "border-[color:color-mix(in_srgb,var(--red)_35%,var(--line))] bg-negative-soft text-negative"
          : "border-[color:var(--line)] bg-card text-foreground/80",
        className,
      )}
      {...props}
    />
  );
}
