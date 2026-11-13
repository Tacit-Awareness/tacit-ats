"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ico, ICON } from "@/components/careers/frame";
import { groupBoard, matchRole, type BoardRole } from "@/lib/public/board";
import { withVia, type Channel } from "@/lib/public/channel";

// The board's roles: a search field beside the title, then one white card of
// team bands (each a <details>, so it folds with no script) and role rows, as
// Testbench's grouped lists. The prototype's ⌘K menu is the search field: ⌘K or
// Ctrl K focuses it.

function RoleRow({ role, channel }: { role: BoardRole; channel: Channel }) {
  return (
    <Link className="row" href={withVia(`/jobs/${role.slug}`, channel)}>
      <Ico d={ICON.file} />
      <span className="row-title">{role.title}</span>
      {role.location ? <span className="row-meta">{role.location}</span> : null}
      <span className="row-apply">
        Apply now
        <Ico d={ICON.out} />
      </span>
    </Link>
  );
}

export function Roles({ roles, channel }: { roles: BoardRole[]; channel: Channel }) {
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
      <label className="find">
        <Ico d={ICON.search} />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${roles.length} ${roles.length === 1 ? "role" : "roles"}`}
          aria-label="Search roles"
        />
        <kbd className="kbd" title="⌘K or Ctrl K">
          <Ico d={ICON.cmd} />k
        </kbd>
      </label>
      <div className="list">
        {groups.length === 0 ? <div className="list-empty">No roles match &ldquo;{query}&rdquo;</div> : null}
        {groups.map((g) =>
          g.name ? (
            // Searching opens every band; the key resets one the reader folded.
            <details key={`${g.name}:${query ? "q" : ""}`} open>
              <summary className="band">
                <span className="band-name">{g.name}</span>
                <span className="band-count">{g.roles.length}</span>
                <Ico d={ICON.down} />
              </summary>
              {g.roles.map((r) => (
                <RoleRow key={r.slug} role={r} channel={channel} />
              ))}
            </details>
          ) : (
            g.roles.map((r) => <RoleRow key={r.slug} role={r} channel={channel} />)
          ),
        )}
      </div>
    </>
  );
}
