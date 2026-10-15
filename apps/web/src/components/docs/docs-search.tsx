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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <input
        ref={input}
        type="search"
        aria-label="Search the docs"
        placeholder="Search docs  ⌘K"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      {query.trim() ? (
        <div role="region" aria-label="Search results" className="absolute inset-x-0 top-9 z-20 rounded-md border border-[color:var(--line)] bg-card p-1 shadow-md">
          {results.length ? (
            results.map((p) => (
              <Link
                key={p.slug}
                href={`${basePath}/${p.slug}`}
                onClick={() => setQuery("")}
                className="block rounded px-2 py-1.5 hover:bg-accent"
              >
                <span className="block text-[13px] font-medium">{p.title}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{p.description}</span>
              </Link>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No matching pages.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
