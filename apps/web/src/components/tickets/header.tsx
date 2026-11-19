import Link from "next/link";
import type { ReactNode } from "react";

// design/tacit-tickets/src/kit.tsx's Header: the page's 44px top bar, the team
// it is scoped to, its title, its tabs, and controls on the right. Tabs are
// links here, so a tab is a URL. Server-safe.

export type HeaderTab = { label: string; href: string; on: boolean };

export function Header({ scope, title, tabs, right }: { scope?: string | null; title: string; tabs?: HeaderTab[]; right?: ReactNode }) {
  return (
    <header className="scroll-quiet flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line pr-3 pl-5">
      {scope && (
        <span className="mr-0.5 flex shrink-0 items-center gap-2">
          <span className="text-mute">{scope}</span>
          <span className="text-dim">/</span>
        </span>
      )}
      <h1 className="mr-2 shrink-0 font-medium text-ink">{title}</h1>
      {tabs?.map((t) => (
        <Link key={t.label} href={t.href} aria-current={t.on ? "page" : undefined} className={`flex h-7 shrink-0 items-center rounded-md px-2.5 whitespace-nowrap transition-colors ${t.on ? "bg-sel text-ink" : "text-mute hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">{right}</span>
    </header>
  );
}
