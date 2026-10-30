"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { avatarColor } from "@/components/page";
import { cn } from "@/lib/utils";
import { THEME_COOKIE, nextTheme, parseTheme } from "@/lib/theme";

// tacit-internal's sidebar shell (apps/internal components/app-shell/shell-frame.tsx),
// for a client org: the org's jobs where tATS sits there, then the client
// area's pages. Client only for what the server cannot know: which link is
// active, the mobile drawer and the theme toggle.

const ICONS = {
  jobs: "M2 2.5h3.4v11H2zM6.3 2.5h3.4v7H6.3zM10.6 2.5H14v9h-3.4z",
  home: "M2.8 7.2 8 3l5.2 4.2V13a.8.8 0 0 1-.8.8H9.6v-3.6H6.4v3.6H3.6a.8.8 0 0 1-.8-.8Z",
  team: "M8.3 5.5a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0M2 13c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6M13.3 6a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0M11 9.5c1.6 0 2.7 1 3 2.8",
  integrations: "M6 10 4.6 11.4a2.1 2.1 0 0 1-3-3L3 7M10 6l1.4-1.4a2.1 2.1 0 0 1 3 3L13 9M6 10l4-4",
  docs: "M4 2.5h5.5L12 5v8.5H4ZM9.5 2.5V5H12M6 8h4M6 10.5h4",
} as const;
type IconName = keyof typeof ICONS;

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} className={cn("size-[15px] shrink-0", className)} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

type NavLink = { href: string; label: string; icon: IconName; activeUnder?: string[] };

const PAGES: NavLink[] = [
  { href: "/client", label: "Home", icon: "home" },
  { href: "/client/team", label: "Team", icon: "team" },
  { href: "/client/integrations", label: "Integrations", icon: "integrations", activeUnder: ["/client/calendar"] },
  { href: "/client/docs", label: "Documentation", icon: "docs" },
];

export type ShellJob = { id: string; title: string; active: number | null };

function useIsActive() {
  const pathname = usePathname();
  // Segment-aware prefix match: /client/team must not light Home up.
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (link: NavLink) => (link.href === "/client" ? pathname === "/client" : under(link.href)) || (link.activeUnder ?? []).some(under);
}

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] whitespace-nowrap transition-colors duration-150",
        active ? "nav-on font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon name={link.icon} className={active ? "text-foreground" : undefined} />
      {link.label}
    </Link>
  );
}

// Jobs are the center of the client area, as tATS is of the Workspace:
// first in the sidebar, in their own block, with every open job under it.
// `active` is null for an interviewer, who sees no pipeline counts.
function JobsBlock({ jobs, activeTotal }: { jobs: ShellJob[]; activeTotal: number | null }) {
  const pathname = usePathname();
  const onList = pathname === "/client/jobs";
  return (
    <div className="grid gap-px rounded-[10px] border border-[color:var(--line)] bg-gradient-to-b from-[var(--paper)] to-[var(--surface)] p-1 shadow-[var(--shadow)]">
      <Link
        href="/client/jobs"
        aria-current={onList ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-semibold transition-colors duration-150",
          onList ? "nav-on" : "hover:bg-accent",
        )}
      >
        <Icon name="jobs" className="text-muted-foreground" />
        Jobs
        {activeTotal ? <span className="ml-auto font-mono text-[11.5px] font-normal text-muted-foreground">{activeTotal}</span> : null}
      </Link>
      {jobs.map((job) => {
        const here = pathname === `/client/jobs/${job.id}`;
        return (
          <Link
            key={job.id}
            href={`/client/jobs/${job.id}`}
            aria-current={here ? "page" : undefined}
            className={cn(
              "flex h-[26px] items-center gap-2 rounded-md pr-2 pl-[30px] text-[12.5px] transition-colors duration-150",
              here ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="truncate">{job.title}</span>
            {job.active ? <span className="ml-auto font-mono text-[11px] text-faint">{job.active}</span> : null}
          </Link>
        );
      })}
    </div>
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
    <button
      type="button"
      onClick={flip}
      aria-label="Switch between light and dark"
      title="Switch theme"
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <svg viewBox="0 0 16 16" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5Z" fill="currentColor" />
      </svg>
    </button>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function ShellFrame({
  org,
  user,
  jobs,
  activeTotal,
  children,
}: {
  org: string;
  user: { name: string; email: string; level: string };
  jobs: ShellJob[];
  activeTotal: number | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = useIsActive();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="flex h-dvh w-full">
      {/* phone: a slim bar with the menu button; the sidebar becomes a drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-[color:var(--line)] bg-frame px-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open the sidebar"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
          </svg>
        </button>
        <span className="tacit-mark size-4" aria-hidden />
        <span className="truncate text-sm font-semibold">{org}</span>
      </div>
      {drawer ? <div className="fixed inset-0 z-40 bg-[color:var(--scrim)] md:hidden" onClick={() => setDrawer(false)} aria-hidden /> : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col gap-4 overflow-y-auto bg-frame px-3 pt-3 pb-3 transition-transform duration-300 [scrollbar-width:none]",
          "md:static md:z-auto md:w-[244px] md:translate-x-0 md:border-r-0",
          drawer ? "translate-x-0 shadow-[var(--pop-shadow)]" : "-translate-x-full",
        )}
        aria-label="Workspace"
      >
        <Link href="/client" className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-1.5 text-[14px] font-medium">
          <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[color:var(--ink)]">
            <span className="tacit-mark size-3 bg-[color:var(--paper)]!" aria-hidden />
          </span>
          <span className="truncate">{org}</span>
        </Link>

        <JobsBlock jobs={jobs} activeTotal={activeTotal} />

        <nav className="grid gap-px" aria-label="Workspace pages">
          <div className="mb-0.5 px-2 text-[12.5px] font-medium text-faint">Workspace</div>
          {PAGES.map((link) => <NavItem key={link.href} link={link} active={isActive(link)} />)}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-lg border border-[color:var(--line)] bg-gradient-to-b from-[var(--paper)] to-[var(--surface)] px-2.5 py-2 shadow-[var(--shadow)]">
          <span
            style={{ background: avatarColor(user.name || user.email) }}
            className="grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
          >
            {initials(user.name || user.email)}
          </span>
          <span className="grid min-w-0">
            <span className="truncate text-[12.5px] font-medium">{user.name || user.email}</span>
            <span className="truncate text-[11.5px] text-faint">{user.level}</span>
          </span>
          <span className="ml-auto flex">
            <ThemeToggle />
            {/* A plain form POST, so it works with JS off and can't be triggered by a GET. */}
            <form action="/client/signout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <svg viewBox="0 0 16 16" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden>
                  <path d="M6.5 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M9.5 5.2 12.3 8l-2.8 2.8M12.3 8H6" />
                </svg>
              </button>
            </form>
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pt-12 md:p-2 md:pl-0">
        <main className="min-h-0 flex-1 overflow-y-auto bg-surface md:rounded-xl md:border md:border-[color:var(--line)] md:shadow-[var(--shadow)]">
          <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
