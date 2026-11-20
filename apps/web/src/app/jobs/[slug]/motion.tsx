"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EASE, claimGhost, fadeOut, plainClick, rememberTab, riseIn, still, tabFrom } from "@/components/careers/motion";

// A role page's motion (design/careers): the sheet that the board's row flies
// into, and the Overview / Application swap: the panel and the side column
// fade out, the page swaps them, the new ones rise in and the underline
// slides across. The tabs are still links, so all of it works with no script.

/** Takes over a flight from the board, if one is landing on this role. Renders nothing. */
export function SheetEnter({ slug }: { slug: string }) {
  useLayoutEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".careers .sheet");
    if (sheet) void claimGhost(sheet, slug);
  }, [slug]);
  return null;
}

function sidePieces(): Element[] {
  return [...document.querySelectorAll(".careers .side > *")];
}

/** Switch tab the prototype's way: fade the current panel up and out, then go. */
function useSwitch(slug: string) {
  const router = useRouter();
  return async (e: React.MouseEvent<HTMLAnchorElement>, href: string, switching: boolean) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    if (!switching) return;
    rememberTab(slug, document.querySelector<HTMLElement>('.careers .tab[aria-current="page"]'));
    const bar = document.querySelector<HTMLElement>(".careers .tabbar");
    if (bar) {
      const top = bar.getBoundingClientRect().top + window.scrollY - 80;
      if (window.scrollY > top) window.scrollTo({ top, behavior: still() ? "auto" : "smooth" });
    }
    const panel = document.querySelector(".careers .panel");
    await Promise.all([fadeOut(panel, { y: -6, duration: 160 }), ...sidePieces().map((el) => fadeOut(el, { y: -8, duration: 200 }))]);
    router.push(href, { scroll: false });
    // A page that never answers must not leave the panel blank.
    window.setTimeout(() => {
      for (const el of [panel, ...sidePieces()]) for (const a of el?.getAnimations() ?? []) a.cancel();
    }, 5000);
  };
}

/** Overview | Application, with the underline sliding from the tab that was on. */
export function TabBar({ slug, label, tabs }: { slug: string; label: string; tabs: Array<{ href: string; label: string; active: boolean }> }) {
  const nav = useRef<HTMLElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const go = useSwitch(slug);
  const activeLabel = tabs.find((t) => t.active)?.label;

  useLayoutEffect(() => {
    const from = tabFrom(slug);
    if (!from) return;
    // The swap landed: clear the fade-out the old panel and side kept, and bring the new ones in.
    const panel = document.querySelector(".careers .panel");
    for (const el of [panel, ...sidePieces()]) for (const a of el?.getAnimations() ?? []) a.cancel();
    riseIn(panel ? [panel] : [], { y: 12, duration: 500 });
    const facts = document.querySelector(".careers .side .facts");
    if (facts) riseIn([facts], { y: 8, duration: 450 });
    const on = nav.current?.querySelector<HTMLElement>('.tab[aria-current="page"]');
    const line = ind.current;
    if (!on || !line || !nav.current || still()) return;
    nav.current.classList.add("sliding");
    line
      .animate(
        [
          { transform: `translateX(${from.left}px)`, width: `${from.width}px` },
          { transform: `translateX(${on.offsetLeft}px)`, width: `${on.offsetWidth}px` },
        ],
        { duration: 500, easing: EASE.out },
      )
      .finished.finally(() => nav.current?.classList.remove("sliding"))
      .catch(() => undefined);
  }, [slug, activeLabel]);

  return (
    <nav ref={nav} className="tabbar" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.label} className="tab" href={t.href} scroll={false} aria-current={t.active ? "page" : undefined} onClick={(e) => void go(e, t.href, !t.active)}>
          {t.label}
        </Link>
      ))}
      <span ref={ind} className="tab-ind" aria-hidden />
    </nav>
  );
}

/** "Apply for this role": the same swap as the Application tab. */
export function ApplyLink({ slug, href, children }: { slug: string; href: string; children: React.ReactNode }) {
  const go = useSwitch(slug);
  return (
    <Link className="cta" href={href} scroll={false} onClick={(e) => void go(e, href, true)}>
      {children}
    </Link>
  );
}
