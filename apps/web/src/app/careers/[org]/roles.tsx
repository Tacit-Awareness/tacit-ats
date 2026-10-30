"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ico, ICON } from "@/components/careers/frame";
import { groupBoard, matchRole, type BoardRole } from "@/lib/public/board";

// The board's roles: a folding band per team (a <details>, so it folds with no
// script) and a filter over them. The prototype's ⌘K menu is this one line: ⌘K
// or Ctrl K focuses it.

function RoleRow({ role }: { role: BoardRole }) {
  return (
    <Link className="tv-row tv-leaf" href={`/jobs/${role.slug}`}>
      <Ico d={ICON.file} />
      <span className="tv-label">{role.title}</span>
      {role.location ? <span className="tv-meta">{role.location}</span> : null}
      <span className="tv-apply">
        Apply now
        <Ico d={ICON.out} />
      </span>
    </Link>
  );
}

export function Roles({ roles }: { roles: BoardRole[] }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

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

  const groups = groupBoard(roles.filter((r) => matchRole(r, query)));
  return (
    <>
      <label className="findline">
        <Ico d={ICON.search} />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`${roles.length} ${roles.length === 1 ? "role" : "roles"}`}
          aria-label="Search roles"
        />
        <span className="keys">⌘K</span>
      </label>
      {groups.length === 0 ? <div className="tv-empty">No roles match &ldquo;{query}&rdquo;</div> : null}
      {groups.map((g) =>
        g.name ? (
          // Searching opens every band; the key resets one the reader folded.
          <details key={`${g.name}:${query ? "q" : ""}`} open>
            <summary className="tv-row tv-folder">
              <Ico d={ICON.chev} />
              <span>
                {g.name}
                <span className="tv-count">{g.roles.length}</span>
              </span>
            </summary>
            {g.roles.map((r) => (
              <RoleRow key={r.slug} role={r} />
            ))}
          </details>
        ) : (
          g.roles.map((r) => <RoleRow key={r.slug} role={r} />)
        ),
      )}
    </>
  );
}
