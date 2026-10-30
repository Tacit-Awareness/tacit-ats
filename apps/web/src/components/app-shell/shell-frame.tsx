"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CommandMenu, type CommandItem } from "@/components/app-shell/command-menu";
import { Avatar, initialsOf } from "@/components/page";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE, SIDEBAR_DEFAULT, SIDEBAR_RAIL, SIDEBAR_SNAP, clampSidebar, formatSidebar, type SidebarState } from "@/lib/sidebar";
import { THEME_COOKIE, nextTheme, parseTheme } from "@/lib/theme";

// design/tats's sidebar (Hy's tATS prototype), for the pages that exist so
// far: the org and its search and collapse buttons, Home, then the funnel's
// sections (Top of Funnel, Routing & Tracking), with the team's pages, the member and the footer at the bottom.
// A section only appears once it has a page; each new page adds its own link.
// Drag the edge to resize, `[` collapses it to an icon rail, ⌘K opens the
// command menu. No counts: the sidebar is for getting around, not a report.
// Client only for what the server cannot know: which link is active, the
// drawer on a phone, the menu, the width and the theme toggle.

const ICONS = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z",
  brief: "M2.5 5.5h11v7.5h-11ZM6 5.5V3.5h4v2M2.5 8.5h11",
  people: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8",
  team: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2",
  integrations: "M6 10 4.6 11.4a2.1 2.1 0 0 1-3-3L3 7M10 6l1.4-1.4a2.1 2.1 0 0 1 3 3L13 9M6 10l4-4",
  help: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.3 6.2a1.8 1.8 0 0 1 3.4.8c0 1.2-1.7 1.5-1.7 2.5M8 11.3h.01",
  search: "M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3",
  sidebar: "M2.5 3h11v10h-11ZM6.5 3v10",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  signout: "M6.5 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M9.5 5.2 12.3 8l-2.8 2.8M12.3 8H6",
} as const;
type IconName = keyof typeof ICONS;

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-[15px] shrink-0", className)}
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

type NavLink = { href: string; label: string; icon: IconName; activeUnder?: string[] };

const HOME: NavLink = { href: "/client", label: "Home", icon: "home" };
const CRM: NavLink = { href: "/client/candidates", label: "CRM", icon: "team" };
const JOBS: NavLink = { href: "/client/jobs", label: "Job Postings", icon: "brief" };
const APPLICANTS: NavLink = { href: "/client/applicants", label: "Applicant Tickets", icon: "menu" };
const PIPELINE: NavLink = { href: "/client/pipeline", label: "Pipeline", icon: "people" };
const INTERVIEWS: NavLink = { href: "/client/interviews", label: "Interviews", icon: "team" };
const INTERVIEWERS: NavLink = { href: "/client/interviewers", label: "Interviewers", icon: "team" };
const SETTINGS: NavLink[] = [
  { href: "/client/team", label: "Team", icon: "team" },
  { href: "/client/integrations", label: "Integrations", icon: "integrations", activeUnder: ["/client/calendar"] },
];
const DOCS: NavLink = { href: "/client/docs", label: "Documentation", icon: "help" };

export type ShellJob = { id: string; title: string };

function useIsActive() {
  const pathname = usePathname();
  // Segment-aware prefix match: /client/team must not light Home up.
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (link: NavLink) => (link.href === "/client" ? pathname === "/client" : under(link.href)) || (link.activeUnder ?? []).some(under);
}

/** True while the user is typing, so `[` stays a character there. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const itemCls = (active: boolean, rail: boolean) =>
  cn(
    "flex h-[34px] items-center gap-2.5 rounded-lg text-[14.5px] whitespace-nowrap transition-colors duration-100",
    rail ? "justify-center px-0" : "px-2.5",
    active ? "nav-on font-medium" : "font-[450] hover:bg-[color:var(--hover)]",
  );

function NavItem({ link, active, rail }: { link: NavLink; active: boolean; rail: boolean }) {
  return (
    <Link href={link.href} aria-current={active ? "page" : undefined} title={rail ? link.label : undefined} className={itemCls(active, rail)}>
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon name={link.icon} />
      </span>
      <span className={cn("truncate", rail && "sr-only")}>{link.label}</span>
    </Link>
  );
}

/** A collapsible section heading: the funnel's stages. */
function Section({ label, open, onToggle, rail, children }: { label: string; open: boolean; onToggle: () => void; rail: boolean; children: React.ReactNode }) {
  return (
    <nav className="grid gap-0.5" aria-label={label}>
      {rail ? null : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="mb-1.5 flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-left text-[13.5px] font-[450] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          {label}
          <svg viewBox="0 0 8 8" className={cn("size-2 fill-current transition-transform duration-150", !open && "-rotate-90")} aria-hidden>
            <path d="M1 2.2h6L4 6Z" />
          </svg>
        </button>
      )}
      {open || rail ? children : null}
    </nav>
  );
}

function IconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground", className)}
    >
      {children}
    </button>
  );
}

function ThemeToggle() {
  const flip = () => {
    const root = document.documentElement;
    const next = nextTheme(parseTheme(root.dataset.theme), matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <IconButton label="Switch between light and dark" onClick={flip}>
      <svg viewBox="0 0 16 16" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" />
      </svg>
    </IconButton>
  );
}

/** The org's square: its initial on the accent, as design/tats's workspace logo. */
function OrgLogo({ org }: { org: string }) {
  return (
    <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-[color:var(--accent)] text-[11px] font-semibold text-[color:var(--accent-ink)]" aria-hidden>
      {initialsOf(org).slice(0, 1)}
    </span>
  );
}

export function ShellFrame({
  org,
  user,
  jobs,
  sidebar: initial,
  children,
}: {
  org: string;
  user: { name: string; email: string; level: string };
  jobs: ShellJob[];
  sidebar: SidebarState;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = useIsActive();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sb, setSb] = useState(initial);
  const [shut, setShut] = useState<Set<string>>(() => new Set());
  // The drag's start and its live width: the release saves `now`, not the
  // width from the last render, which may not have caught up.
  const drag = useRef<{ x: number; w: number; now: number } | null>(null);
  useEffect(() => setDrawer(false), [pathname]);

  // The rail is a desktop state; a phone always opens the full drawer.
  const rail = sb.collapsed && !drawer;
  const save = (next: SidebarState) => {
    setSb(next);
    document.cookie = `${SIDEBAR_COOKIE}=${formatSidebar(next)}; path=/; max-age=31536000; samesite=lax`;
  };
  const toggle = () => save({ ...sb, collapsed: !sb.collapsed });

  // ⌘K opens the menu, `[` collapses the sidebar. A page that claims ⌘K for
  // itself (the docs' search) handles it first and calls preventDefault.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((m) => !m);
      } else if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sb.collapsed) return;
    drag.current = { x: e.clientX, w: sb.width, now: sb.width };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer tracks: the drag still follows moves over the edge
    }
    document.body.style.cursor = "col-resize";
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = d.w + e.clientX - d.x;
    if (w < SIDEBAR_SNAP) {
      drag.current = null;
      document.body.style.cursor = "";
      return save({ width: d.w, collapsed: true });
    }
    d.now = clampSidebar(w);
    setSb({ width: d.now, collapsed: false });
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.cursor = "";
    save({ width: d.now, collapsed: false });
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      save({ ...sb, width: clampSidebar(sb.width + (e.key === "ArrowRight" ? 16 : -16)) });
    }
  };

  const shutToggle = (k: string) =>
    setShut((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const commands: CommandItem[] = [
    { group: "Go to", label: HOME.label, href: HOME.href },
    { group: "Go to", label: CRM.label, href: CRM.href },
    { group: "Go to", label: JOBS.label, href: JOBS.href },
    { group: "Go to", label: APPLICANTS.label, href: APPLICANTS.href },
    { group: "Go to", label: PIPELINE.label, href: PIPELINE.href },
    { group: "Go to", label: INTERVIEWS.label, href: INTERVIEWS.href },
    { group: "Go to", label: INTERVIEWERS.label, href: INTERVIEWERS.href },
    ...SETTINGS.map((l) => ({ group: "Go to", label: l.label, href: l.href })),
    { group: "Go to", label: DOCS.label, href: DOCS.href },
    ...jobs.map((j) => ({ group: "Jobs", label: j.title, href: `/client/jobs/${j.id}` })),
  ];

  return (
    <div className="flex h-dvh w-full" style={{ "--sbw": `${sb.width}px`, "--rail": `${SIDEBAR_RAIL}px` } as React.CSSProperties}>
      {/* phone: a slim bar with the menu button; the sidebar becomes a drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-[color:var(--line)] bg-frame px-3 md:hidden">
        <IconButton label="Open the sidebar" onClick={() => setDrawer(true)}>
          <Icon name="menu" className="size-4" />
        </IconButton>
        <OrgLogo org={org} />
        <span className="truncate text-sm font-semibold">{org}</span>
        <IconButton label="Search (⌘K)" onClick={() => setMenu(true)} className="ml-auto">
          <Icon name="search" />
        </IconButton>
      </div>
      {drawer ? <div className="fixed inset-0 z-40 bg-[color:var(--scrim)] md:hidden" onClick={() => setDrawer(false)} aria-hidden /> : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col gap-6 overflow-y-auto bg-frame py-2.5 pr-2 pl-2.5 transition-transform duration-300 [scrollbar-width:none]",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          rail ? "md:w-[var(--rail)] md:pr-1.5" : "md:w-[var(--sbw)]",
          drawer ? "translate-x-0 shadow-[var(--pop-shadow)]" : "-translate-x-full",
        )}
        aria-label="Workspace"
      >
        <div className={cn("flex h-10 items-center gap-1", rail && "h-auto flex-col gap-1.5")}>
          <button
            type="button"
            onClick={() => setMenu(true)}
            title={rail ? org : undefined}
            className={cn(
              "flex h-[34px] min-w-0 items-center gap-[9px] rounded-lg text-[14px] font-medium transition-colors hover:bg-[color:var(--hover)]",
              rail ? "justify-center p-1" : "flex-1 px-2",
            )}
          >
            <OrgLogo org={org} />
            <span className={cn("truncate", rail && "sr-only")}>{org}</span>
          </button>
          {rail ? null : (
            <IconButton label="Search (⌘K)" onClick={() => setMenu(true)}>
              <Icon name="search" />
            </IconButton>
          )}
          <IconButton label={`${sb.collapsed ? "Expand" : "Collapse"} sidebar ([)`} onClick={toggle} className="max-md:hidden">
            <Icon name="sidebar" />
          </IconButton>
        </div>

        <nav className="grid gap-0.5" aria-label="Home">
          <NavItem link={HOME} active={isActive(HOME)} rail={rail} />
          <NavItem link={CRM} active={isActive(CRM)} rail={rail} />
        </nav>

        <Section label="Top of Funnel" open={!shut.has("top")} onToggle={() => shutToggle("top")} rail={rail}>
          <NavItem link={JOBS} active={pathname === JOBS.href} rail={rail} />
          {rail
            ? null
            : jobs.map((job) => {
                const here = pathname === `/client/jobs/${job.id}` || pathname.startsWith(`/client/jobs/${job.id}/`);
                return (
                  <Link
                    key={job.id}
                    href={`/client/jobs/${job.id}`}
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "flex h-[30px] items-center rounded-lg pr-2.5 pl-10 text-[13.5px] whitespace-nowrap transition-colors duration-100",
                      here ? "nav-on font-medium" : "text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{job.title}</span>
                  </Link>
                );
              })}
          <NavItem link={APPLICANTS} active={isActive(APPLICANTS)} rail={rail} />
        </Section>

        <Section label="Routing & Tracking" open={!shut.has("rt")} onToggle={() => shutToggle("rt")} rail={rail}>
          <NavItem link={PIPELINE} active={isActive(PIPELINE)} rail={rail} />
          <NavItem link={INTERVIEWS} active={isActive(INTERVIEWS)} rail={rail} />
          <NavItem link={INTERVIEWERS} active={isActive(INTERVIEWERS)} rail={rail} />
        </Section>

        <div className="mt-auto grid gap-2">
          <nav className="grid gap-0.5" aria-label="Settings">
            {SETTINGS.map((link) => (
              <NavItem key={link.href} link={link} active={isActive(link)} rail={rail} />
            ))}
          </nav>

          <div className={cn("flex items-center gap-2.5 px-2 pt-2", rail && "justify-center px-0")} title={rail ? user.name || user.email : undefined}>
            <Avatar name={user.name || user.email} size="md" />
            <span className={cn("grid min-w-0", rail && "sr-only")}>
              <span className="truncate text-[13.5px] font-medium">{user.name || user.email}</span>
              <span className="truncate text-[12px] text-muted-foreground">{user.level}</span>
            </span>
          </div>

          <div className={cn("flex items-center gap-1.5 pl-1", rail && "flex-col pl-0")}>
            <Link
              href={DOCS.href}
              aria-current={isActive(DOCS) ? "page" : undefined}
              title={rail ? DOCS.label : undefined}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md text-[13px] transition-colors hover:bg-[color:var(--hover)] hover:text-foreground",
                isActive(DOCS) ? "nav-on font-medium text-foreground" : "text-muted-foreground",
                rail ? "w-8 justify-center" : "px-2",
              )}
            >
              <Icon name="help" />
              <span className={cn(rail && "sr-only")}>{DOCS.label}</span>
            </Link>
            <span className={cn("flex", rail ? "flex-col" : "ml-auto")}>
              <ThemeToggle />
              {/* A plain form POST, so it works with JS off and can't be triggered by a GET. */}
              <form action="/client/signout" method="post">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
                >
                  <Icon name="signout" />
                </button>
              </form>
            </span>
          </div>
        </div>
      </aside>

      {/* the edge between the sidebar and the panel: drag to resize, double-click to reset */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        aria-valuenow={sb.width}
        tabIndex={sb.collapsed ? -1 : 0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => save({ width: SIDEBAR_DEFAULT, collapsed: false })}
        onKeyDown={onResizeKey}
        className={cn(
          "relative z-10 -mx-1 hidden w-2 shrink-0 outline-none md:block",
          "after:absolute after:inset-y-3.5 after:left-[3px] after:w-0.5 after:rounded-full after:transition-colors hover:after:bg-[color:var(--line-strong)] focus-visible:after:bg-[color:var(--accent)]",
          sb.collapsed ? "pointer-events-none" : "cursor-col-resize",
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col pt-12 md:py-2.5 md:pr-2.5 md:pl-1.5">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface md:rounded-xl md:border md:border-[color:var(--line)] md:shadow-[var(--shadow)]">
          <div className="shell-page mx-auto w-full max-w-7xl px-4 py-8 md:px-8">{children}</div>
        </main>
      </div>

      <CommandMenu open={menu} onClose={() => setMenu(false)} items={commands} />
    </div>
  );
}
