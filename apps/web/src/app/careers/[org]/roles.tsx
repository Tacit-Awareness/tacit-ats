"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ico, ICON } from "@/components/careers/frame";
import { groupBoard, matchRole, type BoardRole } from "@/lib/public/board";
import { withVia, type Channel } from "@/lib/public/channel";

// The board's roles (design/careers, as OpenAI's careers page): a quiet search
// line, then each team as a folder row that folds (a <details>, so it works
// with no script) and its roles as rows between hairlines: the title, where,
// and "Apply now". ⌘K or Ctrl K focuses the search.

function RoleRow({ role, channel }: { role: BoardRole; channel: Channel }) {
  return (
    <Link className="tv-row tv-leaf" href={withVia(`/jobs/${role.slug}`, channel)}>
      <span className="tv-ico">
        <Ico d={ICON.file} />
      </span>
      <span className="tv-label">{role.title}</span>
      {role.location ? <span className="tv-meta">{role.location}</span> : null}
      <span className="tv-apply">
        Apply now
        <Ico d={ICON.out} />
      </span>
    </Link>
  );
}

/** ⌘ on Apple keyboards, Ctrl elsewhere; ⌘ until the browser says, as most readers are on a Mac. */
function useApple(): boolean {
  const [apple, setApple] = useState(true);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setApple(/mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent));
  }, []);
  return apple;
}

export function Roles({ roles, channel }: { roles: BoardRole[]; channel: Channel }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const apple = useApple();

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
          placeholder={`${roles.length} ${roles.length === 1 ? "role" : "roles"}`}
          aria-label="Search roles"
        />
        <kbd className="keys" title={apple ? "⌘K" : "Ctrl K"}>
          {apple ? <Ico d={ICON.cmd} /> : "Ctrl"}
          <span>K</span>
        </kbd>
      </label>
      <div className="tv" role="region" aria-label="Open roles">
        {groups.length === 0 ? <div className="tv-empty">No roles match &ldquo;{query}&rdquo;</div> : null}
        {groups.map((g) =>
          g.name ? (
            // Searching opens every team; the key resets one the reader folded.
            <details key={`${g.name}:${query ? "q" : ""}`} open>
              <summary className="tv-row tv-folder">
                <span className="tv-chev">
                  <Ico d={ICON.right} />
                </span>
                <span className="tv-ico">
                  <svg className="ico f-closed" viewBox="0 0 24 24" aria-hidden>
                    <path d={ICON.folder} />
                  </svg>
                  <svg className="ico f-open" viewBox="0 0 24 24" aria-hidden>
                    <path d={ICON.folderOpen} />
                  </svg>
                </span>
                <span className="tv-label">
                  {g.name}
                  <span className="tv-count">{g.roles.length}</span>
                </span>
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
