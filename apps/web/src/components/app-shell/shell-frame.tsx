"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Calendar, ChevronDown, ChevronRight, CircleUser, FileCheck, GraduationCap, House, Inbox, Menu as MenuIcon, Moon, PanelLeft, Pin, Search, Settings, Sun, Target, Ticket, Users, X } from "lucide-react";
import { AccountMenu, applyTheme } from "@/components/app-shell/account-menu";
import { CommandMenu, type CommandItem } from "@/components/app-shell/command-menu";
import { OPEN_COMMAND_EVENT } from "@/components/app-shell/command-context";
import { switchCompany, type ShellCompany } from "@/components/app-shell/company-menu";
import { HoverCard } from "@/components/hover-card";
import { ShellKeys, type GoKey } from "@/components/app-shell/shell-keys";
import { PillGlass } from "@/components/app-shell/pill-glass";
import { ShellMemory, useMarks, useViews } from "@/components/app-shell/shell-memory";
import { START_EVENT, ShellTour, TourButton } from "@/components/app-shell/shell-tour";
import { initialsOf } from "@/components/page";
import { Kbd, Menu, useMod, type MenuItem } from "@/components/tickets/kit";
import { Toaster } from "@/components/toasts";
import { modalOpen } from "@/lib/keys";
import { cn } from "@/lib/utils";
import type { SidebarCounts, TeamStat } from "@/lib/client/sidebar-counts-rules";
import { SIDEBAR_COOKIE, SIDEBAR_DEFAULT, SIDEBAR_RAIL, clampSidebar, dragSidebar, formatSidebar, type SidebarState } from "@/lib/sidebar";
import { allViews, viewHref } from "@/lib/saved-views";

// Tacit Tickets' sidebar (design/tacit-tickets/src/views/sidebar.tsx) on the
// client area's pages: the workspace menu (the company, and every company the
// member is in to switch to), search, then All Teams' Home, Triage, Tickets with
// People, Interviews and Offers under it, Listings & Asks; then Teams, the org's
// departments, each folding open to its own pages, with what needs a look
// counted; and at the foot your name (the account menu), Tutorial, the theme and
// Settings. Until each of Hy's screens is ported, its link opens the page that
// does its work today: Triage (step 2) is the Inbox and New Applicants
// together, Tickets (step 3) the bot's tasks with People and Interviews under
// it, Offers (step 4) its own page, and Listings & Asks is still Job Postings; the Pipeline, the CRM and
// Interview Judgement stay in ⌘K. The pages Hy's sidebar
// has no row for (Insights, Onboarding, Referrals, the calendar ...) are in the
// workspace menu and ⌘K.
// Drag the edge to resize, `[` collapses it to an icon rail (drag the rail's
// edge to open it again), ⌘K opens the command menu. The counts arrive after the
// page has drawn (GET /client/sidebar); design/tats's mark, a faint red tint
// when something arrived since you last opened Triage, is kept
// (shell-memory.tsx). The rail is CSS (globals.css's .sb rules), so it can ease:
// rows stay mounted either way.

type NavLink = { href: string; label: string; icon: ReactNode; go: string; activeUnder?: string[]; under?: boolean; /** Lit on its own path only, not the pages under it. */ exact?: boolean };

const HOME: NavLink = { href: "/client", label: "Home", icon: <House size={15} />, go: "h" };
const TRIAGE: NavLink = { href: "/client/triage", label: "Triage", icon: <Inbox size={15} />, go: "t", activeUnder: ["/client/inbox", "/client/applicants"] };
const TICKETS: NavLink = { href: "/client/tickets", label: "Tickets", icon: <Ticket size={15} />, go: "w", exact: true, activeUnder: ["/client/pipeline", "/client/views"] };
const PEOPLE: NavLink = { href: "/client/tickets/people", label: "People", icon: <CircleUser size={15} />, go: "p", under: true, activeUnder: ["/client/candidates"] };
const INTERVIEWS: NavLink = { href: "/client/tickets/interviews", label: "Interviews", icon: <Calendar size={15} />, go: "i", under: true, activeUnder: ["/client/interviews", "/client/schedule"] };
const OFFERS: NavLink = { href: "/client/tickets/offers", label: "Offers", icon: <FileCheck size={15} />, go: "o", under: true };
const ASKS: NavLink = { href: "/client/jobs", label: "Listings & Asks", icon: <Target size={15} />, go: "l" };
const NAV = [HOME, TRIAGE, TICKETS, PEOPLE, INTERVIEWS, OFFERS, ASKS];

const INSIGHTS = { href: "/client/analytics", label: "Insights" };
const SETTINGS = { href: "/client/settings", label: "Settings" };
/** The pages Hy's sidebar has no row for, a click away in the workspace menu. */
const MORE = [
  { href: "/client?view=overview", label: "Recruiting Overview" },
  { href: "/client/onboarding/people", label: "Onboarding" },
  { href: "/client/onboarding/process", label: "Interview Process" },
  { href: "/client/interviewers", label: "Interviewers" },
  { href: "/client/schedule", label: "Interview Calendar" },
  { href: "/client/referrals", label: "Referrals" },
];

// G then a letter (shell-keys.tsx), Tacit Tickets' GO_KEYS.
const GO: GoKey[] = [
  ...NAV.map((l) => ({ key: l.go, label: l.label, href: l.href })),
  { key: "n", label: INSIGHTS.label, href: INSIGHTS.href },
  { key: "s", label: SETTINGS.label, href: SETTINGS.href },
];

export type ShellJob = { id: string; title: string };
/** A team: one of the org's live departments, by its place in the tree. */
export type ShellTeam = { id: string; name: string; depth: number };

function useIsActive() {
  const pathname = usePathname();
  // Segment-aware prefix match: /client/jobs must not light Home up.
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (link: { href: string; activeUnder?: string[]; exact?: boolean }) =>
    (link.href === "/client" || link.exact ? pathname === link.href : under(link.href)) || (link.activeUnder ?? []).some(under);
}

/** True while the user is typing, so `[` stays a character there. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function IconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink", className)}
    >
      {children}
    </button>
  );
}

/** The org's square: its logo, on white so a dark one shows on the dark theme, or its initial in ink. */
function OrgLogo({ org, logoUrl }: { org: string; logoUrl: string | null }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a stored public file, not a page asset
    return <img src={logoUrl} alt="" className="size-5 shrink-0 rounded-[5px] bg-white object-contain" />;
  }
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-ink text-[10px] font-semibold text-well" aria-hidden>
      {initialsOf(org).slice(0, 1)}
    </span>
  );
}

function NavItem({ link, active, rail, count, fresh }: { link: NavLink; active: boolean; rail: boolean; count?: number; fresh?: string | null }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? link.label : undefined}
      aria-description={fresh ?? undefined}
      title={fresh ?? (rail ? link.label : `Press G, then ${link.go.toUpperCase()}`)}
      className={cn(
        "sb-item group/nav flex items-center gap-2 px-1.5 text-left whitespace-nowrap transition-colors",
        link.under && "sb-under ml-[15px] rounded-l-none border-l border-line pl-3",
        active ? "bg-sel text-ink" : fresh ? "nav-new" : link.under ? "text-mute hover:bg-hover hover:text-body" : "text-body hover:bg-hover",
      )}
    >
      <span className={cn("grid size-[15px] shrink-0 place-items-center", link.under && "sb-rail-only", active ? "text-ink" : "text-mute")}>{link.icon}</span>
      <span className="sb-label">{link.label}</span>
      {count ? (
        <span className="sb-label ml-auto text-xs text-dim tabular-nums">{count}</span>
      ) : (
        <span className="sb-label ml-auto hidden text-[11px] text-dim group-hover/nav:inline">G then {link.go.toUpperCase()}</span>
      )}
    </Link>
  );
}

const PINS_KEY = "tacit-team-pins";

/** Teams: the org's live departments, each folding open to its own pages. The picked team is ?department= on those pages. */
function Teams({ teams, stats }: { teams: ShellTeam[]; stats: Record<string, TeamStat> }) {
  const pathname = usePathname();
  const here = useSearchParams().get("department");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pins, setPins] = useState<string[]>([]);
  const [onlyAttn, setOnlyAttn] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]");
      if (Array.isArray(saved)) setPins(saved.filter((x): x is string => typeof x === "string"));
    } catch {
      /* nothing pinned */
    }
  }, []);
  useEffect(() => {
    if (here) setOpen((o) => ({ ...o, [here]: true }));
  }, [here]);
  const pin = (id: string) =>
    setPins((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      try {
        localStorage.setItem(PINS_KEY, JSON.stringify(next));
      } catch {
        /* pinned for this visit */
      }
      return next;
    });

  const sub = [
    { label: "Tickets", href: "/client/tickets", count: (st?: TeamStat) => st?.attn ?? 0 },
    { label: "People", href: "/client/tickets/people", count: () => 0 },
    { label: "Triage", href: "/client/triage", count: (st?: TeamStat) => st?.triage ?? 0 },
  ];
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase());
  const visible = teams.filter((t) => match(t.name) && (!onlyAttn || (stats[t.id]?.attn ?? 0) > 0 || t.id === here));
  const pinned = visible.filter((t) => pins.includes(t.id));
  const rest = visible.filter((t) => !pins.includes(t.id));

  const row = (t: ShellTeam, indent: boolean) => {
    const st = stats[t.id];
    const isOpen = !!open[t.id] || !!q.trim();
    const picked = here === t.id;
    return (
      <div key={t.id} data-team={t.id}>
        <div className={cn("group flex h-7 items-center rounded-md pr-1 transition-colors", picked && !isOpen ? "bg-sel" : "hover:bg-hover")}>
          <button
            type="button"
            onClick={() => setOpen((o) => ({ ...o, [t.id]: !isOpen }))}
            aria-expanded={isOpen}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-1.5 text-left"
            style={indent ? { paddingLeft: 6 + t.depth * 12 } : undefined}
          >
            <Users size={14} className="shrink-0 text-mute" />
            <span className={cn("truncate", picked ? "text-ink" : "text-body")}>{t.name}</span>
            <ChevronRight size={12} className={cn("shrink-0 text-dim transition-transform", isOpen && "rotate-90")} />
          </button>
          <button
            type="button"
            aria-label={pins.includes(t.id) ? `Unpin ${t.name}` : `Pin ${t.name}`}
            aria-pressed={pins.includes(t.id)}
            onClick={() => pin(t.id)}
            className="hidden size-5 items-center justify-center rounded text-dim group-hover:flex hover:text-ink focus-visible:flex"
          >
            <Pin size={12} className={pins.includes(t.id) ? "fill-current" : ""} />
          </button>
          {st && st.attn > 0 && (
            <span
              className={cn(
                "ml-1 inline-flex h-[18px] items-center justify-center text-xs tabular-nums group-hover:hidden",
                st.stuck ? "min-w-[18px] rounded-full bg-bad px-1 text-[11px] font-medium text-white" : "px-1 text-dim",
              )}
              title={st.stuck ? "Someone here is overdue" : "Needs you"}
            >
              {st.attn}
            </span>
          )}
        </div>
        {isOpen && (
          <div className="relative mb-1 ml-[13px] flex flex-col gap-px border-l border-line pl-2">
            {sub.map((it) => {
              const active = picked && pathname === it.href;
              const count = it.count(st);
              return (
                <Link
                  key={it.href}
                  href={`${it.href}?department=${t.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-7 items-center rounded-md px-2 text-left transition-colors", active ? "bg-sel text-ink" : "text-mute hover:bg-hover hover:text-body")}
                >
                  {it.label}
                  {!!count && <span className="ml-auto text-xs text-dim tabular-nums">{count}</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sb-teams flex min-h-0 flex-col">
      <div className="mt-5 flex shrink-0 items-center px-1.5 text-xs text-dim">
        Teams <span className="ml-1.5 tabular-nums">{teams.length}</span>
        <button
          type="button"
          onClick={() => setOnlyAttn(!onlyAttn)}
          aria-pressed={onlyAttn}
          title="Only teams that need you"
          className={cn("ml-auto flex h-5 items-center gap-1 rounded px-1.5 transition-colors", onlyAttn ? "bg-sel text-ink" : "hover:text-body")}
        >
          Needs You
        </button>
      </div>
      <div className="mt-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 focus-within:border-line-strong">
        <Search size={12} className="shrink-0 text-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a team" aria-label="Find a team" className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-dim" />
        {q && (
          <button type="button" aria-label="Clear" onClick={() => setQ("")} className="text-dim hover:text-ink">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-px pb-2">
        {pinned.map((t) => row(t, false))}
        {pinned.length > 0 && rest.length > 0 && <div className="mx-1.5 my-1.5 h-px shrink-0 bg-line" />}
        {rest.map((t) => row(t, !q.trim()))}
        {!visible.length && <div className="px-1.5 py-3 text-dim">No teams</div>}
      </div>
    </div>
  );
}

/** The sun or the moon: whichever theme is not on screen now. The account menu keeps Light, Dark and System. */
function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);
  const name = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={() => {
        applyTheme(dark ? "light" : "dark");
        setDark(!dark);
      }}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink"
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

type ShellProps = {
  actorId: string;
  org: string;
  orgLogoUrl: string | null;
  /** The company on the token, and every company the member belongs to: more than one adds them to the workspace menu. */
  orgId?: string;
  companies?: ShellCompany[];
  user: { name: string; email: string; level: string };
  jobs: ShellJob[];
  /** The org's live departments, in tree order; none for an interviewer or an org without them. */
  teams?: ShellTeam[];
  sidebar: SidebarState;
  children: ReactNode;
};

export function ShellFrame({ actorId, ...props }: ShellProps) {
  return (
    <ShellMemory actorId={actorId}>
      <Frame {...props} />
    </ShellMemory>
  );
}

function Frame({ org, orgLogoUrl, orgId, companies, user, jobs, teams = [], sidebar: initial, children }: Omit<ShellProps, "actorId">) {
  const pathname = usePathname();
  const isActive = useIsActive();
  const mod = useMod("K");
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sb, setSb] = useState(initial);
  const [counts, setCounts] = useState<SidebarCounts>({ triage: 0, teams: {} });
  const side = useRef<HTMLElement>(null);
  const views = useViews();
  const marks = useMarks(isActive(TRIAGE) ? (pathname.startsWith("/client/applicants") ? "tickets" : pathname.startsWith("/client/inbox") ? "inbox" : null) : null);
  // The drag's start and where it has got to: the release saves `now`, not the
  // state from the last render, which may not have caught up. `snapUntil` is how
  // long the edge eases after a snap before it follows the pointer again.
  const drag = useRef<{ x: number; w: number; from: number; now: SidebarState; snapUntil: number } | null>(null);
  const animating = useRef<ReturnType<typeof setTimeout>>(undefined);
  const askedAt = useRef(0);
  useEffect(() => setDrawer(false), [pathname]);
  // The counts, once the page has drawn, and again on a later page at most every half minute.
  useEffect(() => {
    if (Date.now() - askedAt.current < 30_000) return;
    askedAt.current = Date.now();
    let live = true;
    fetch("/client/sidebar", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<SidebarCounts>) : null))
      .then((c) => {
        if (live && c) setCounts(c);
      })
      .catch(() => {
        /* the counts are a nicety: without them the rows still go where they go */
      });
    return () => {
      live = false;
    };
  }, [pathname]);
  // The drawer is a phone's: left open while the window widens, it would hold the
  // sidebar full on a collapsed desktop. And the tutorial walks the page behind it.
  useEffect(() => {
    const shut = () => setDrawer(false);
    const open = () => setMenu(true);
    const desktop = matchMedia("(min-width: 768px)");
    const onWidth = () => {
      if (desktop.matches) shut();
    };
    desktop.addEventListener("change", onWidth);
    window.addEventListener(START_EVENT, shut);
    window.addEventListener(OPEN_COMMAND_EVENT, open);
    return () => {
      desktop.removeEventListener("change", onWidth);
      window.removeEventListener(START_EVENT, shut);
      window.removeEventListener(OPEN_COMMAND_EVENT, open);
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

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = side.current?.getBoundingClientRect();
    drag.current = { x: e.clientX, w: box ? box.width : sb.width, from: sb.width, now: sb, snapUntil: 0 };
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
    const next = dragSidebar(d.w + e.clientX - d.x, d.from);
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

  const others = orgId && companies && companies.length > 1 ? companies.filter((c) => c.id !== orgId) : [];
  // A refusal here lands on the picker, which says why.
  const switchTo = (id: string) => void switchCompany(id).catch(() => window.location.assign("/client/choose-company"));
  const commands: CommandItem[] = [
    ...NAV.map((l) => ({ group: "Go to", label: l.label, href: l.href })),
    { group: "Go to", label: INSIGHTS.label, href: INSIGHTS.href },
    { group: "Go to", label: "Applicant Tickets", href: "/client/pipeline" },
    { group: "Go to", label: "CRM", href: "/client/candidates" },
    { group: "Go to", label: "Interview Judgement", href: "/client/interviews" },
    { group: "Go to", label: "Inbox", href: "/client/inbox" },
    { group: "Go to", label: "New Applicants", href: "/client/applicants" },
    { group: "Go to", label: "Views", href: "/client/views" },
    ...MORE.map((m) => ({ group: "Go to", label: m.label, href: m.href })),
    { group: "Go to", label: SETTINGS.label, href: SETTINGS.href },
    { group: "Go to", label: "Documentation", href: "/client/docs" },
    ...teams.map((t) => ({ group: "Teams", label: t.name, href: `/client/tickets?department=${t.id}` })),
    ...jobs.map((j) => ({ group: "Jobs", label: j.title, href: `/client/jobs/${j.id}` })),
    ...allViews(views.state).map((v) => ({ group: "Views", label: v.name, href: viewHref(v) })),
    ...others.map((c) => ({ group: "Switch company", label: c.name, run: () => switchTo(c.id) })),
  ];
  const workspace: MenuItem[] = [
    { heading: `${user.name || user.email}, ${user.level}` },
    { label: INSIGHTS.label, href: INSIGHTS.href },
    { label: SETTINGS.label, href: SETTINGS.href },
    ...(others.length ? (["sep", { heading: "Switch Company" }] as MenuItem[]) : []),
    ...others.map((c) => ({ label: c.name, onPick: () => switchTo(c.id) })),
    "sep",
    ...MORE.map((m) => ({ label: m.label, href: m.href })),
    "sep",
    {
      label: (
        <span className="flex items-center">
          Command Menu{" "}
          <span className="ml-auto text-dim">
            <Kbd>{mod}</Kbd>
          </span>
        </span>
      ),
      onPick: () => setMenu(true),
    },
  ];

  return (
    <div className="ui-root flex" style={{ "--sbw": `${sb.width}px`, "--rail": `${SIDEBAR_RAIL}px` } as React.CSSProperties}>
      {/* Testbench's box: the app sits in one rounded box on the sky (globals.css .tb-box). */}
      <div className="tb-box max-md:rounded-none max-md:shadow-none">
        {/* phone: a slim bar with the menu button; the sidebar becomes a drawer */}
        <div className="fixed inset-x-0 top-0 z-30 flex h-11 items-center gap-2.5 border-b border-line bg-well px-3 md:hidden">
          <IconButton label="Open the sidebar" onClick={() => setDrawer(true)}>
            <MenuIcon size={16} />
          </IconButton>
          <OrgLogo org={org} logoUrl={orgLogoUrl} />
          <span className="truncate font-medium text-ink">{org}</span>
          <IconButton label={`Search, ${mod}`} onClick={() => setMenu(true)} className="ml-auto">
            <Search size={15} />
          </IconButton>
        </div>
        {drawer ? <div className="fixed inset-0 z-40 bg-[color:var(--scrim)] md:hidden" onClick={() => setDrawer(false)} aria-hidden /> : null}

        <aside
          ref={side}
          // Any link: a team's page can be the page you are on with another query, which the pathname effect never sees.
          onClick={(e) => {
            if ((e.target as Element).closest("a")) setDrawer(false);
          }}
          className={cn(
            "sb scroll-quiet fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col overflow-y-auto bg-well pt-3 pr-2 pb-3 pl-3 transition-transform duration-300",
            "md:static md:z-auto md:translate-x-0",
            rail ? "sb-rail md:w-[var(--rail)] md:pr-1.5" : "md:w-[var(--sbw)]",
            drawer ? "translate-x-0 shadow-[var(--pop-shadow)]" : "-translate-x-full",
          )}
          aria-label="Workspace"
        >
          <div className="sb-ws">
            <Menu
              width={240}
              items={workspace}
              trigger={(open) => (
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label={others.length ? `Company: ${org}. Switch company` : `Workspace: ${org}`}
                  title={rail ? org : undefined}
                  className="sb-org flex h-8 min-w-0 items-center gap-2 px-1.5 transition-colors hover:bg-hover"
                >
                  <OrgLogo org={org} logoUrl={orgLogoUrl} />
                  <span className="sb-label font-medium text-ink">{org}</span>
                  <ChevronDown size={13} className="sb-chev shrink-0 text-dim" />
                </button>
              )}
            />
            <IconButton label={`Search, ${mod}`} onClick={() => setMenu(true)} className="sb-search ml-auto">
              <Search size={15} />
            </IconButton>
            <IconButton label={`${sb.collapsed ? "Expand" : "Collapse"} sidebar ([)`} onClick={toggle} className="sb-toggle max-md:hidden">
              <PanelLeft size={15} />
            </IconButton>
          </div>

          <div className="sb-sec flex items-end px-1.5 text-xs text-dim">All Teams</div>
          <nav className="sb-group" aria-label="All Teams">
            {NAV.map((l) => (
              <NavItem
                key={l.href}
                link={l}
                active={isActive(l)}
                rail={rail}
                count={l === TRIAGE ? counts.triage : undefined}
                fresh={l === TRIAGE && (marks.inbox || marks.tickets) ? "New in Triage since you last looked" : null}
              />
            ))}
          </nav>

          {teams.length > 0 && (
            <Suspense fallback={null}>
              <Teams teams={teams} stats={counts.teams} />
            </Suspense>
          )}

          <div className="sb-foot">
            <AccountMenu user={user} rail={rail} pathname={pathname} />
            {/* Tacit Tickets' foot: Tutorial, the theme and Settings beside your name. */}
            <div className="sb-tools">
              <TourButton title="Tutorial" className="flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink">
                <GraduationCap size={15} aria-hidden />
                <span className="sr-only">Tutorial</span>
              </TourButton>
              <ThemeButton />
              <Link
                href={SETTINGS.href}
                aria-current={isActive(SETTINGS) ? "page" : undefined}
                title="Settings, G then S"
                className={cn("flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sel hover:text-ink", isActive(SETTINGS) ? "bg-sel text-ink" : "text-mute")}
              >
                <Settings size={15} aria-hidden />
                <span className="sr-only">Settings</span>
              </Link>
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
            "after:absolute after:inset-y-0 after:left-[3.5px] after:w-px after:bg-transparent after:transition-colors hover:after:inset-y-3 hover:after:left-[3px] hover:after:w-0.5 hover:after:rounded-full hover:after:bg-line-strong focus-visible:after:bg-[color:var(--accent)]",
          )}
        />

        <div className="flex min-w-0 flex-1 flex-col pt-11 md:pt-0">
          {/* Tacit Tickets: the page is one bordered panel inset in the box, beside the sidebar on the well. */}
          <main className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel md:my-2 md:mr-2 md:rounded-lg md:border md:border-line">
            <div className="shell-page mx-auto w-full max-w-[1600px] px-[var(--page-gutter)] py-7">{children}</div>
          </main>
        </div>
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
