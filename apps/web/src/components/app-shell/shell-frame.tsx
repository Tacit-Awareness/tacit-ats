"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { CommandMenu, type CommandItem } from "@/components/app-shell/command-menu";
import { HoverCard } from "@/components/hover-card";
import { KeysButton, ShellKeys, type GoKey } from "@/components/app-shell/shell-keys";
import { PillGlass } from "@/components/app-shell/pill-glass";
import { ShellMemory, useMarks, useOpenCount, useViews } from "@/components/app-shell/shell-memory";
import { START_EVENT, ShellTour, TourButton } from "@/components/app-shell/shell-tour";
import { initialsOf } from "@/components/page";
import { Toaster } from "@/components/toasts";
import { modalOpen } from "@/lib/keys";
import { cssPx, cssRect, setUiScale } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";
import { SIDEBAR_COOKIE, SIDEBAR_DEFAULT, SIDEBAR_RAIL, clampSidebar, dragSidebar, formatSidebar, type SidebarState } from "@/lib/sidebar";
import { allViews, pinnedViews, viewHref, type SavedView } from "@/lib/saved-views";

// design/tats's sidebar (Hy's tATS prototype), for the pages that exist so
// far: the org and its search and collapse buttons, Home, then the funnel's
// sections (Top of Funnel, Routing & Tracking) and Onboarding, with Integrations, Documentation, Tutorial, the keys and your name at the bottom.
// A section only appears once it has a page; each new page adds its own link.
// Drag the edge to resize, `[` collapses it to an icon rail (drag the rail's
// edge to open it again), ⌘K opens the command menu. The sidebar is for getting
// around, not a report, so there is one count, what's open in the Inbox, which
// has no other place now its card has no tabs. The one signal is design/tats's
// mark, a faint red tint on Inbox or Applicant Tickets when something arrived
// since you last opened it (shell-memory.tsx, which holds both).
// Saved views you pin sit under Pipeline.
// Client only for what the server cannot know: which link is active, the
// drawer on a phone, the menu and the width. The rail and the folds are CSS
// (globals.css's .sb rules), so they can ease: rows stay mounted either way.

const ICONS = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z",
  brief: "M2.5 5.5h11v7.5h-11ZM6 5.5V3.5h4v2M2.5 8.5h11",
  people: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8",
  team: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2",
  db: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2ZM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2",
  integrations: "M6 10 4.6 11.4a2.1 2.1 0 0 1-3-3L3 7M10 6l1.4-1.4a2.1 2.1 0 0 1 3 3L13 9M6 10l4-4",
  help: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.3 6.2a1.8 1.8 0 0 1 3.4.8c0 1.2-1.7 1.5-1.7 2.5M8 11.3h.01",
  search: "M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3",
  sidebar: "M2.5 3h11v10h-11ZM6.5 3v10",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  chart: "M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5",
  inbox: "M2.5 9h3l1 2h3l1-2h3M4 3h8l1.5 6v4h-11V9Z",
  ticket: "M2.5 5a1.5 1.5 0 0 0 0 3v3.5h11V8a1.5 1.5 0 0 1 0-3V2.5h-11ZM6.5 2.5v9",
  mic: "M8 2.5a2 2 0 0 0-2 2v3.5a2 2 0 0 0 4 0V4.5a2 2 0 0 0-2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5",
  cal: "M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3",
  layers: "M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3",
  tour: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.7 5.6 10.4 8l-3.7 2.4Z",
  route: "M3 2.5h4v3.5H3ZM9 10h4v3.5H9ZM5 6v3a2 2 0 0 0 2 2h2",
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
const INBOX: NavLink = { href: "/client/inbox", label: "Inbox", icon: "inbox" };
const CRM: NavLink = { href: "/client/candidates", label: "CRM", icon: "db" };
const JOBS: NavLink = { href: "/client/jobs", label: "Job Postings", icon: "brief" };
const APPLICANTS: NavLink = { href: "/client/applicants", label: "Applicant Tickets", icon: "ticket" };
const ANALYTICS: NavLink = { href: "/client/analytics", label: "Analytics", icon: "chart" };
const PIPELINE: NavLink = { href: "/client/pipeline", label: "Pipeline", icon: "people", activeUnder: ["/client/views"] };
const INTERVIEWS: NavLink = { href: "/client/interviews", label: "Interviews", icon: "mic" };
const CALENDAR: NavLink = { href: "/client/schedule", label: "Calendar", icon: "cal" };
const INTERVIEWERS: NavLink = { href: "/client/interviewers", label: "Interviewers", icon: "team" };
const REFERRALS: NavLink = { href: "/client/referrals", label: "Referrals", icon: "team" };
// Onboarding's steps but its process, which has its own link, as in design/tats.
const TEAM: NavLink = {
  href: "/client/onboarding/people",
  label: "Team",
  icon: "team",
  activeUnder: ["/client/onboarding/teams", "/client/onboarding/skills", "/client/onboarding/review"],
};
const PROCESS: NavLink = { href: "/client/onboarding/process", label: "Interview process", icon: "route" };
const SETTINGS: NavLink[] = [
  { href: "/client/integrations", label: "Integrations", icon: "integrations", activeUnder: ["/client/calendar"] },
];
const DOCS: NavLink = { href: "/client/docs", label: "Documentation", icon: "help" };
// G then a letter (shell-keys.tsx): design/tats's T and A and J, then H, C, I.
const GO: GoKey[] = [
  { key: "h", label: HOME.label, href: HOME.href },
  { key: "c", label: CRM.label, href: CRM.href },
  { key: "j", label: JOBS.label, href: JOBS.href },
  { key: "t", label: APPLICANTS.label, href: APPLICANTS.href },
  { key: "a", label: PIPELINE.label, href: PIPELINE.href },
  { key: "i", label: INTERVIEWS.label, href: INTERVIEWS.href },
];

export type ShellJob = { id: string; title: string };

function useIsActive() {
  const pathname = usePathname();
  // Segment-aware prefix match: /client/jobs must not light Home up.
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (link: NavLink) => (link.href === "/client" ? pathname === "/client" : under(link.href)) || (link.activeUnder ?? []).some(under);
}

/** True while the user is typing, so `[` stays a character there. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const itemCls = (active: boolean, fresh = false) =>
  cn(
    "sb-item flex w-full items-center gap-2.5 px-2.5 text-left text-[14.5px] whitespace-nowrap",
    active ? "nav-on font-medium" : fresh ? "nav-new font-[450]" : "font-[450] hover:bg-[color:var(--hover)]",
  );

/** `fresh` is the mark's tooltip, when something new is there. `count` is what's open, gone on the rail with the label. */
function NavItem({ link, active, rail, fresh, count }: { link: NavLink; active: boolean; rail: boolean; fresh?: string | null; count?: number | null }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      title={fresh ?? (rail ? link.label : undefined)}
      // The label leaves the layout on the rail, and the accessibility tree with it.
      aria-label={rail ? link.label : undefined}
      aria-description={fresh ?? undefined}
      className={itemCls(active, !!fresh)}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon name={link.icon} />
      </span>
      <span className="sb-label">{link.label}</span>
      {count ? (
        <span className="sb-label ml-auto text-[12.5px] font-normal text-faint tabular-nums">
          {count}
          <span className="sr-only"> open</span>
        </span>
      ) : null}
    </Link>
  );
}

/** Pipeline, and the views pinned under it: only one of them is lit, the view when it is one you pinned. */
function PipelineLinks({ rail, pathname }: { rail: boolean; pathname: string }) {
  const isActive = useIsActive();
  const on = useSearchParams().get("view");
  const pins = pinnedViews(useViews().state);
  const onPin = pathname === PIPELINE.href && pins.some((v) => v.id === on);
  return (
    <>
      <NavItem link={PIPELINE} active={isActive(PIPELINE) && !onPin} rail={rail} />
      {pins.map((v) => (
        <PinnedView key={v.id} view={v} active={onPin && v.id === on} rail={rail} />
      ))}
    </>
  );
}

function PinnedView({ view, active, rail }: { view: SavedView; active: boolean; rail: boolean }) {
  return (
    <Link
      href={viewHref(view)}
      aria-current={active ? "page" : undefined}
      title={rail ? view.name : undefined}
      aria-label={rail ? view.name : undefined}
      className={cn(itemCls(active), "sb-sub")}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon name="layers" className="size-[13px]" />
      </span>
      <span className="sb-label">{view.name}</span>
    </Link>
  );
}

/** A collapsible section heading: the funnel's stages. */
function Section({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <nav className={cn("sb-group", !open && "shut")} aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="sb-sec flex items-center gap-1.5 px-2.5 text-left text-[13.5px] font-[450] text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground"
      >
        {label}
        <svg viewBox="0 0 8 8" className={cn("sb-tri size-2 fill-current", !open && "-rotate-90")} aria-hidden>
          <path d="M1 2.2h6L4 6Z" />
        </svg>
      </button>
      {children}
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
      className={cn("grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground", className)}
    >
      {children}
    </button>
  );
}

/** The org's square: its logo, on white so a dark one shows on the dark theme, or its initial on the accent, as design/tats's workspace logo. */
function OrgLogo({ org, logoUrl }: { org: string; logoUrl: string | null }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a stored public file, not a page asset
    return <img src={logoUrl} alt="" className="size-[22px] shrink-0 bg-white object-contain" />;
  }
  return (
    <span className="grid size-[22px] shrink-0 place-items-center bg-[color:var(--accent)] text-[11px] font-semibold text-[color:var(--accent-ink)]" aria-hidden>
      {initialsOf(org).slice(0, 1)}
    </span>
  );
}

type ShellProps = {
  actorId: string;
  org: string;
  orgLogoUrl: string | null;
  user: { name: string; email: string; level: string };
  jobs: ShellJob[];
  sidebar: SidebarState;
  children: React.ReactNode;
};

export function ShellFrame({ actorId, ...props }: ShellProps) {
  return (
    <ShellMemory actorId={actorId}>
      <Frame {...props} />
    </ShellMemory>
  );
}

function Frame({ org, orgLogoUrl, user, jobs, sidebar: initial, children }: Omit<ShellProps, "actorId">) {
  const pathname = usePathname();
  const isActive = useIsActive();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sb, setSb] = useState(initial);
  const [shut, setShut] = useState<Set<string>>(() => new Set());
  const side = useRef<HTMLElement>(null);
  const views = useViews();
  const marks = useMarks(isActive(INBOX) ? "inbox" : isActive(APPLICANTS) ? "tickets" : null);
  const openInInbox = useOpenCount("inbox");
  // The drag's start and where it has got to: the release saves `now`, not the
  // state from the last render, which may not have caught up. `snapUntil` is how
  // long the edge eases after a snap before it follows the pointer again.
  const drag = useRef<{ x: number; w: number; from: number; now: SidebarState; snapUntil: number } | null>(null);
  const animating = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDrawer(false), [pathname]);
  // The drawer is a phone's: left open while the window widens, it would hold the
  // sidebar full on a collapsed desktop. And the tutorial walks the page behind it.
  useEffect(() => {
    const shut = () => setDrawer(false);
    const desktop = matchMedia("(min-width: 768px)");
    const onWidth = () => {
      if (desktop.matches) shut();
    };
    desktop.addEventListener("change", onWidth);
    window.addEventListener(START_EVENT, shut);
    return () => {
      desktop.removeEventListener("change", onWidth);
      window.removeEventListener(START_EVENT, shut);
    };
  }, []);

  // The rail is a desktop state; a phone always opens the full drawer.
  const rail = sb.collapsed && !drawer;
  const save = (next: SidebarState) => {
    setSb(next);
    document.cookie = `${SIDEBAR_COOKIE}=${formatSidebar(next)}; path=/; max-age=31536000; samesite=lax`;
  };
  // Lets the CSS play one change (@starting-style needs it), then steps aside.
  // An attribute, not a class: React would drop a class when `rail` changes.
  const animate = () => {
    const el = side.current;
    if (!el) return;
    el.dataset.anim = "";
    clearTimeout(animating.current);
    animating.current = setTimeout(() => delete el.dataset.anim, 400);
  };
  const toggle = () => {
    animate();
    save({ ...sb, collapsed: !sb.collapsed });
  };

  // ⌘K opens the menu, `[` collapses the sidebar. A page that claims ⌘K for
  // itself (the docs' search) handles it first and calls preventDefault.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
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

  useEffect(() => {
    setUiScale();
    window.addEventListener("resize", setUiScale);
    return () => window.removeEventListener("resize", setUiScale);
  }, []);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = side.current?.getBoundingClientRect();
    drag.current = { x: cssPx(e.clientX), w: box ? cssRect(box).width : sb.width, from: sb.width, now: sb, snapUntil: 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer tracks: the drag still follows moves over the edge
    }
    document.body.classList.add("sb-dragging");
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = dragSidebar(d.w + cssPx(e.clientX) - d.x, d.from);
    if (next.collapsed !== d.now.collapsed) {
      // A snap eases: the drag's no-transition comes off for its length.
      document.body.classList.remove("sb-dragging");
      d.snapUntil = performance.now() + 300;
      animate();
    } else if (performance.now() > d.snapUntil) {
      document.body.classList.add("sb-dragging");
    }
    d.now = next;
    setSb(next);
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove("sb-dragging");
    save(d.now);
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      save({ ...sb, width: clampSidebar(sb.width + (e.key === "ArrowRight" ? 16 : -16)) });
    }
  };

  const shutToggle = (k: string) => {
    animate();
    setShut((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const commands: CommandItem[] = [
    { group: "Go to", label: HOME.label, href: HOME.href },
    { group: "Go to", label: INBOX.label, href: INBOX.href },
    { group: "Go to", label: CRM.label, href: CRM.href },
    { group: "Go to", label: JOBS.label, href: JOBS.href },
    { group: "Go to", label: APPLICANTS.label, href: APPLICANTS.href },
    { group: "Go to", label: ANALYTICS.label, href: ANALYTICS.href },
    { group: "Go to", label: PIPELINE.label, href: PIPELINE.href },
    { group: "Go to", label: "Views", href: "/client/views" },
    { group: "Go to", label: INTERVIEWS.label, href: INTERVIEWS.href },
    { group: "Go to", label: CALENDAR.label, href: CALENDAR.href },
    { group: "Go to", label: INTERVIEWERS.label, href: INTERVIEWERS.href },
    { group: "Go to", label: REFERRALS.label, href: REFERRALS.href },
    { group: "Go to", label: "Onboarding", href: TEAM.href },
    { group: "Go to", label: PROCESS.label, href: PROCESS.href },
    ...SETTINGS.map((l) => ({ group: "Go to", label: l.label, href: l.href })),
    { group: "Go to", label: DOCS.label, href: DOCS.href },
    ...jobs.map((j) => ({ group: "Jobs", label: j.title, href: `/client/jobs/${j.id}` })),
    ...allViews(views.state).map((v) => ({ group: "Views", label: v.name, href: viewHref(v) })),
  ];

  return (
    <div className="ui-root flex" style={{ "--sbw": `${sb.width}px`, "--rail": `${SIDEBAR_RAIL}px` } as React.CSSProperties}>
      {/* phone: a slim bar with the menu button; the sidebar becomes a drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-[color:var(--line)] bg-frame px-3 md:hidden">
        <IconButton label="Open the sidebar" onClick={() => setDrawer(true)}>
          <Icon name="menu" className="size-4" />
        </IconButton>
        <OrgLogo org={org} logoUrl={orgLogoUrl} />
        <span className="truncate text-sm font-semibold">{org}</span>
        <IconButton label="Search (⌘K)" onClick={() => setMenu(true)} className="ml-auto">
          <Icon name="search" />
        </IconButton>
      </div>
      {drawer ? <div className="fixed inset-0 z-40 bg-[color:var(--scrim)] md:hidden" onClick={() => setDrawer(false)} aria-hidden /> : null}

      <aside
        ref={side}
        // Any link: a pinned view can be the page you are on with another query, which the pathname effect never sees.
        onClick={(e) => {
          if ((e.target as Element).closest("a")) setDrawer(false);
        }}
        className={cn(
          "sb fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col overflow-y-auto bg-frame py-2.5 pr-2 pl-2.5 transition-transform duration-300 [scrollbar-width:none]",
          "md:static md:z-auto md:translate-x-0",
          rail ? "sb-rail md:w-[var(--rail)] md:pr-1.5" : "md:w-[var(--sbw)]",
          drawer ? "translate-x-0 shadow-[var(--pop-shadow)]" : "-translate-x-full",
        )}
        aria-label="Workspace"
      >
        <div className="sb-ws">
          <button
            type="button"
            onClick={() => setMenu(true)}
            title={rail ? org : undefined}
            aria-label={rail ? org : undefined}
            className="sb-org flex h-[34px] min-w-0 flex-1 items-center gap-[9px] px-2 text-[14px] font-medium transition-colors hover:bg-[color:var(--hover)]"
          >
            <OrgLogo org={org} logoUrl={orgLogoUrl} />
            <span className="sb-label">{org}</span>
          </button>
          <IconButton label="Search (⌘K)" onClick={() => setMenu(true)} className="sb-search">
            <Icon name="search" />
          </IconButton>
          <IconButton label={`${sb.collapsed ? "Expand" : "Collapse"} sidebar ([)`} onClick={toggle} className="sb-toggle max-md:hidden">
            <Icon name="sidebar" />
          </IconButton>
        </div>

        <nav className="sb-group" aria-label="Home">
          <NavItem link={HOME} active={isActive(HOME)} rail={rail} />
          <NavItem link={INBOX} active={isActive(INBOX)} rail={rail} fresh={marks.inbox ? "New in your Inbox" : null} count={openInInbox} />
        </nav>

        <Section label="Top of Funnel" open={!shut.has("top")} onToggle={() => shutToggle("top")}>
          <NavItem link={JOBS} active={isActive(JOBS)} rail={rail} />
          <NavItem link={APPLICANTS} active={isActive(APPLICANTS)} rail={rail} fresh={marks.tickets ? "New applicants since you last looked" : null} />
          <NavItem link={ANALYTICS} active={isActive(ANALYTICS)} rail={rail} />
        </Section>

        <Section label="Routing & Tracking" open={!shut.has("rt")} onToggle={() => shutToggle("rt")}>
          <Suspense fallback={<NavItem link={PIPELINE} active={isActive(PIPELINE)} rail={rail} />}>
            <PipelineLinks rail={rail} pathname={pathname} />
          </Suspense>
          <NavItem link={INTERVIEWS} active={isActive(INTERVIEWS)} rail={rail} />
          <NavItem link={CALENDAR} active={isActive(CALENDAR)} rail={rail} />
          <NavItem link={INTERVIEWERS} active={isActive(INTERVIEWERS)} rail={rail} />
          <NavItem link={REFERRALS} active={isActive(REFERRALS)} rail={rail} />
        </Section>

        <Section label="Onboarding" open={!shut.has("ob")} onToggle={() => shutToggle("ob")}>
          <NavItem link={TEAM} active={isActive(TEAM)} rail={rail} />
          <NavItem link={PROCESS} active={isActive(PROCESS)} rail={rail} />
          <NavItem link={CRM} active={isActive(CRM)} rail={rail} />
        </Section>

        <div className="sb-foot">
          <nav className="sb-group" aria-label="Settings">
            {SETTINGS.map((link) => (
              <NavItem key={link.href} link={link} active={isActive(link)} rail={rail} />
            ))}
            <NavItem link={DOCS} active={isActive(DOCS)} rail={rail} />
            <TourButton title={rail ? "Tutorial" : undefined} aria-label={rail ? "Tutorial" : undefined} className={itemCls(false)}>
              <span className="grid size-5 shrink-0 place-items-center">
                <Icon name="tour" />
              </span>
              <span className="sb-label">Tutorial</span>
            </TourButton>
            <KeysButton className={cn(itemCls(false), "max-md:hidden")}>
              <span className="sb-label">Keyboard shortcuts</span>
            </KeysButton>
          </nav>
          <AccountMenu user={user} rail={rail} pathname={pathname} />
        </div>
      </aside>

      {/* the edge between the sidebar and the panel: drag to resize, double-click to reset */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        aria-valuenow={sb.width}
        tabIndex={sb.collapsed ? -1 : 0}
        title={sb.collapsed ? "Drag to open. Double-click to open." : "Drag to resize. Double-click to reset."}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => {
          animate();
          save({ width: sb.collapsed ? sb.width : SIDEBAR_DEFAULT, collapsed: false });
        }}
        onKeyDown={onResizeKey}
        className={cn(
          "relative z-10 -mx-1 hidden w-2 shrink-0 cursor-col-resize outline-none md:block",
          "after:absolute after:inset-y-3.5 after:left-[3px] after:w-0.5 after:rounded-full after:transition-colors hover:after:bg-[color:var(--line-strong)] focus-visible:after:bg-[color:var(--accent)]",
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col pt-12 md:py-2.5 md:pr-2.5 md:pl-1.5">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card md:border md:border-[color:var(--line)] md:shadow-[var(--shadow)]">
          <div className="shell-page mx-auto w-full max-w-7xl px-4 py-8 md:px-8">{children}</div>
        </main>
      </div>

      <CommandMenu open={menu} onClose={() => setMenu(false)} items={commands} />
      {/* Before ShellKeys: the tour's capture listener is added first, so it takes its keys before G and `?`. */}
      <Suspense fallback={null}>
        <ShellTour />
      </Suspense>
      <ShellKeys go={GO} />
      <PillGlass />
      <HoverCard />
      <Toaster />
    </div>
  );
}
