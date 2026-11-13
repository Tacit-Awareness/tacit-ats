"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SearchablePage = { slug: string; title: string; description: string; body: string };

/**
 * Finds a page by title, then description, then body text; ⌘K / Ctrl+K
 * focuses it. Client-side only: the pages are already in hand and small.
 */
export function rankPages(pages: SearchablePage[], query: string): SearchablePage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (p: SearchablePage) =>
    p.slug === q || p.title.toLowerCase() === q
      ? 5
      : p.slug.includes(q) || p.title.toLowerCase().includes(q)
        ? 4
        : p.description.toLowerCase().includes(q)
          ? 2
          : p.body.toLowerCase().includes(q)
            ? 1
            : 0;
  return pages
    .map((page) => ({ page, s: score(page) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 7)
    .map((r) => r.page);
}

export function DocsSearch({ basePath, pages }: { basePath: string; pages: SearchablePage[] }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = rankPages(pages, query);

  // On the docs, ⌘K is this search, not the shell's command menu: listening in
  // the capture phase runs this first, and the shell skips a handled event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="relative">
      {/* Testbench's search field, its ⌘K inside it */}
      <label className="flex h-[34px] items-center gap-2 rounded-[7px] bg-[color:var(--paper)] pr-1.5 pl-3 text-faint shadow-[var(--shadow-sm)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.1)]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-[14px] shrink-0" aria-hidden>
          <path d="M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3" />
        </svg>
        <input
          ref={input}
          type="search"
          aria-label="Search the docs"
          aria-keyshortcuts="Meta+K Control+K"
          placeholder="Search docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd aria-hidden className="inline-grid h-5 min-w-5 flex-none place-items-center rounded-[4px] px-1 font-mono text-[11px] leading-none shadow-[inset_0_0_0_1px_currentColor] opacity-70">
          ⌘K
        </kbd>
      </label>
      {query.trim() ? (
        // Testbench's menu: white, 12px corners, the pop shadow, 34px items; what each page covers is on its hover.
        <div role="region" aria-label="Search results" className="absolute inset-x-0 top-10 z-20 grid gap-px rounded-[12px] bg-[color:var(--raised)] p-1.5 shadow-[var(--pop-shadow)]">
          {results.length ? (
            results.map((p) => (
              <Link
                key={p.slug}
                href={`${basePath}/${p.slug}`}
                title={p.description}
                onClick={() => setQuery("")}
                className="flex min-h-[34px] items-center rounded-[7px] px-2.5 py-1.5 text-[13px] leading-[18px] text-foreground transition-colors hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--hover)]"
              >
                {p.title}
                <span className="sr-only">. {p.description}</span>
              </Link>
            ))
          ) : (
            <p className="m-0 flex min-h-[34px] items-center px-2.5 text-[13px] text-faint">No matching pages.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
