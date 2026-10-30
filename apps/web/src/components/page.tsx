import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

// The page grammar of tacit-internal's 2026-10 Workspace redesign (its
// apps/internal components/page.tsx; Hy's mockup), in design/tats's palette
// since 2026-10-29: a header with the title, a muted line and the actions on
// the right; a KPI strip in pixel numbers; cards with a small section heading
// and count; compact list rows; pills that only take colour when it means
// something (green ok/done, red broken or overdue, indigo for the action). Server components, no state: every page composes these instead
// of restating the classes, so the pages cannot drift apart.

/** The page column: the mockup's 1180px measure, 16px between blocks. */
export function Page({ narrow = false, className, ...props }: React.ComponentProps<"div"> & { narrow?: boolean }) {
  return <div className={cn("mx-auto grid w-full content-start gap-4", narrow ? "max-w-[760px]" : "max-w-[1180px]", className)} {...props} />;
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

/** A mono count beside a heading. */
export function Count({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs font-normal text-faint">{children}</span>;
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

/** A card. `flush` puts the body edge to edge (tables), with the heading in its own ruled band. */
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
        "grid min-w-0 content-start rounded-[12px] border border-[color:var(--line)] bg-card text-[13px]",
        flush ? "gap-0 overflow-hidden" : "gap-2.5 px-4 py-3.5",
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
          className={flush ? "border-b border-[color:var(--line)] px-4 py-3" : undefined}
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

/** The list-row container; rows bleed 8px so their hover reaches the card padding. */
export function Rows({ tight = false, className, ...props }: React.ComponentProps<"div"> & { tight?: boolean }) {
  return <div data-tight={tight || undefined} className={cn("group/rows -mx-2 grid", className)} {...props} />;
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
    "flex min-w-0 items-center gap-[11px] rounded-lg px-2 py-2 text-left group-data-[tight]/rows:py-1.5",
    href && "transition-colors hover:bg-accent",
    className,
  );
  const body = (
    <>
      {icon}
      <span className="grid min-w-0 flex-1">
        <b className="max-w-full justify-self-start truncate text-[13px] font-medium text-foreground">{title}</b>
        {sub && <span className="max-w-full justify-self-start truncate text-xs text-muted-foreground">{sub}</span>}
        {children}
      </span>
      {meta && (
        <span className={cn("flex flex-none items-center gap-2.5 text-xs", metaTone === "late" ? "text-negative" : "text-foreground/75")}>
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
  green: "border-[color:var(--green)] text-positive bg-[linear-gradient(var(--paper),var(--green-soft))]",
  red: "border-[color:var(--red)] text-negative bg-[linear-gradient(var(--paper),var(--red-soft))]",
  grey: "border-[color:var(--line-strong)] text-muted-foreground bg-[linear-gradient(var(--paper),var(--soft))]",
} as const;

/** A status pill (Overseer's): mono, half-pixel border, colour only for meaning. */
export function Pill({ tone = "grey", className, ...props }: React.ComponentProps<"span"> & { tone?: keyof typeof PILL_TONES }) {
  return (
    <span
      className={cn(
        "inline-grid h-[21px] place-items-center rounded-full border-[0.5px] px-[11px] pt-px font-mono text-[11px] tracking-[-0.02em] whitespace-nowrap",
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

/** The round initials avatar: a solid person colour, white initials. */
export function Avatar({ name, size = "sm" }: { name: string | null | undefined; size?: "sm" | "xl" }) {
  return (
    <span
      aria-hidden
      style={{ background: avatarColor(name) }}
      className={cn(
        "grid flex-none place-items-center rounded-full font-semibold text-white",
        size === "xl" ? "size-11 text-[15px]" : "size-[22px] text-[9.5px]",
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
        size === "lg" ? "size-9 rounded-[9px] text-[13px]" : size === "md" ? "size-[30px] rounded-lg text-xs" : "size-[22px] rounded-md text-[9.5px]",
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

/** The small uppercase sub-heading inside a card. */
export function MiniTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 font-mono text-[11px] tracking-[-0.02em] text-muted-foreground uppercase", className)} {...props} />;
}

/** The quiet line a card shows when it has nothing. */
export function Empty({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("my-1 text-[12.5px] text-faint", className)} {...props} />;
}

/** The green "connected" dot with its label. */
export function Live({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
      <i className="size-1.5 rounded-full bg-positive shadow-[0_0_6px_var(--green-bright)]" />
      {children}
    </span>
  );
}

/** Inline text link: quiet until hovered, the accent on hover. */
export const textLink = "inline-flex items-center gap-1 text-[12.5px] text-foreground/75 transition-colors hover:text-[color:var(--accent)]";

/** A 30px app tile for connector rows: a glyph or an icon on the raised fill. */
export function AppTile({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-[30px] flex-none place-items-center rounded-lg bg-raised font-pixel text-xs text-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type Tab = { href: string; label: React.ReactNode; count?: React.ReactNode; active: boolean };

/** Filter tabs: pill links, the active one on the soft band, counts in mono. */
export function Tabs({ tabs, label, className }: { tabs: Tab[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-[30px] items-center gap-2 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors",
            t.active
              ? "border-transparent bg-[color:var(--soft-strong)] font-medium text-foreground"
              : "border-[color:var(--line)] text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="font-mono text-[11.5px] font-normal text-faint">{t.count}</span>}
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
    <nav aria-label={label} className="flex h-[30px] overflow-hidden rounded-lg border border-[color:var(--line)] bg-frame p-0.5 text-[12.5px]">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "grid place-items-center rounded-md px-2.5 transition-colors",
            it.active ? "bg-raised font-medium text-foreground shadow-[var(--shadow)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
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
        "m-0 rounded-[10px] border px-3.5 py-2.5 text-[13px]",
        tone === "error"
          ? "border-[color:color-mix(in_srgb,var(--red)_35%,var(--line))] bg-negative-soft text-negative"
          : "border-[color:var(--line)] bg-card text-foreground/80",
        className,
      )}
      {...props}
    />
  );
}
