"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ico, ICON } from "@/components/careers/frame";
import { EASE, arriveBoard, flyRow, plainClick, still } from "@/components/careers/motion";
import { groupBoard, matchRole, type BoardRole } from "@/lib/public/board";
import { withVia, type Channel } from "@/lib/public/channel";

// The board's roles (design/careers, as OpenAI's careers page): a quiet search
// line, then each team as a folder row that folds (a <details>, so it works
// with no script) and its roles as rows between hairlines: the title, where,
// and "Apply now". ⌘K or Ctrl K focuses the search.
// The prototype's motion: one soft fill glides between the rows under the
// pointer, a folder's roles slide open and closed, and opening a role flies
// a white sheet from its row into the role's page (components/careers/motion.ts).

function RoleRow({ role, channel, onOpen }: { role: BoardRole; channel: Channel; onOpen: (e: React.MouseEvent<HTMLAnchorElement>, href: string, role: BoardRole) => void }) {
  const href = withVia(`/jobs/${role.slug}`, channel);
  return (
    <Link className="tv-row tv-leaf" href={href} onClick={(e) => onOpen(e, href, role)}>
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

/** A team's fold: the chevron and folder turn at once, the roles slide open or closed, and only then does <details> change. */
function fold(details: HTMLDetailsElement, open: boolean) {
  const kids = details.querySelector<HTMLElement>(".tv-kids");
  details.dataset.open = String(open);
  if (!kids || still()) {
    details.open = open;
    return;
  }
  for (const a of kids.getAnimations({ subtree: true })) a.cancel();
  const leaves = [...kids.querySelectorAll<HTMLElement>(".tv-leaf")];
  if (open) {
    details.open = true;
    const h = kids.scrollHeight;
    kids.animate([{ height: "0px" }, { height: `${h}px` }], { duration: 500, easing: EASE.out });
    leaves.forEach((leaf, i) =>
      leaf.animate([{ opacity: 0, transform: "translateX(-6px)", filter: "blur(3px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], {
        duration: 420,
        delay: 50 + i * 50,
        easing: EASE.out,
        fill: "backwards",
      }),
    );
  } else {
    const h = kids.offsetHeight;
    leaves.reverse().forEach((leaf, i) => leaf.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(-4px)" }], { duration: 140, delay: i * 20, fill: "forwards" }));
    kids
      .animate([{ height: `${h}px` }, { height: "0px" }], { duration: 380, easing: EASE.inOut, fill: "forwards" })
      .finished.then(
        () => {
          details.open = false;
          for (const a of kids.getAnimations({ subtree: true })) a.cancel();
        },
        () => undefined,
      );
  }
}

export function Roles({ roles, channel }: { roles: BoardRole[]; channel: Channel }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tree = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLSpanElement>(null);
  const router = useRouter();
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

  // Back from a role: the board fades in from just above.
  useEffect(() => arriveBoard(tree.current?.closest(".board") ?? null), []);

  // One fill glides between rows instead of every row lighting up on its own.
  const glide = (row: HTMLElement | null) => {
    const h = hover.current;
    const box = tree.current;
    if (!h || !box) return;
    if (!row) {
      h.style.opacity = "0";
      return;
    }
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + 4;
    const height = row.offsetHeight - 9;
    const fresh = h.style.opacity !== "1";
    if (fresh) {
      h.style.transition = "none";
      h.style.transform = `translateY(${top}px)`;
      h.style.height = `${height}px`;
      void h.offsetHeight;
      h.style.transition = "";
    }
    h.style.transform = `translateY(${top}px)`;
    h.style.height = `${height}px`;
    h.style.opacity = "1";
  };
  const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(".tv-row") : null);

  const open = (e: React.MouseEvent<HTMLAnchorElement>, href: string, role: BoardRole) => {
    if (!plainClick(e) || !flyRow(e.currentTarget, role.slug, role.title)) return;
    e.preventDefault();
    glide(null);
    const board = tree.current?.closest(".careers");
    for (const el of board?.querySelectorAll(".board, .foot") ?? []) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: EASE.out, fill: "forwards" });
    router.push(href);
  };

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
      <div
        ref={tree}
        className="tv tv-glide"
        role="region"
        aria-label="Open roles"
        onPointerOver={(e) => glide(rowOf(e.target))}
        onPointerLeave={() => glide(null)}
        onFocus={(e) => glide(rowOf(e.target))}
        onBlur={(e) => {
          if (!tree.current?.contains(e.relatedTarget as Node | null)) glide(null);
        }}
      >
        <span ref={hover} className="tv-hover" aria-hidden />
        {groups.length === 0 ? <div className="tv-empty">No roles match &ldquo;{query}&rdquo;</div> : null}
        {groups.map((g) =>
          g.name ? (
            // Searching opens every team; the key resets one the reader folded.
            <details key={`${g.name}:${query ? "q" : ""}`} open data-open="true" onToggle={(e) => (e.currentTarget.dataset.open = String(e.currentTarget.open))}>
              <summary
                className="tv-row tv-folder"
                onClick={(e) => {
                  e.preventDefault();
                  glide(null);
                  const d = e.currentTarget.parentElement as HTMLDetailsElement;
                  fold(d, d.dataset.open !== "true");
                }}
              >
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
              <div className="tv-kids">
                {g.roles.map((r) => (
                  <RoleRow key={r.slug} role={r} channel={channel} onOpen={open} />
                ))}
              </div>
            </details>
          ) : (
            g.roles.map((r) => <RoleRow key={r.slug} role={r} channel={channel} onOpen={open} />)
          ),
        )}
      </div>
    </>
  );
}
