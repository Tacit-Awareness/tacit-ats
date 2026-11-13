"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TOUR, onScreen, onStepPage, placeTour, tourTargets, type Box } from "@/lib/tour";
import { cn } from "@/lib/utils";
import "../overlays.css";

// design/tats's tutorial, the React half (lib/tour.ts is the pure half): a
// walk through every page, one spotlight at a time. Tutorial in the account
// menu starts it; each step goes to its page, waits for what
// it spotlights and puts the card beside it. Clicks outside the card are
// blocked; → or Enter is Next, ← is Back, Esc ends it. Nothing is saved. The
// spotlight and the card are Testbench's `.tour-light` and `.tour-card`
// (overlays.css): where you are is the bar over the buttons, its step in words
// on hover.

export const START_EVENT = "tats:tour";
/** How long a step waits for its page and element before centring the card. */
const WAIT_MS = 3000;

const viewport = () => ({ width: innerWidth, height: innerHeight });

function find(targets: string[]): HTMLElement | null {
  for (const sel of targets) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && onScreen(el.getBoundingClientRect(), viewport())) return el;
  }
  return null;
}

/** A button that starts the tutorial, from anywhere in the shell. `onClick` runs first, so a menu can close itself. */
export function TourButton({ onClick, children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      type="button"
      onClick={(e) => {
        onClick?.(e);
        window.dispatchEvent(new Event(START_EVENT));
      }}
    >
      {children}
    </button>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn(back && "-scale-x-100")}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

type Placed = { spot: Box | null; card: { left: number; top: number } };

export function ShellTour() {
  const router = useRouter();
  const pathname = usePathname();
  const sub = useSearchParams().get("sub");
  const [i, setI] = useState<number | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const el = useRef<HTMLElement | null>(null);

  const end = useCallback(() => {
    setI(null);
    setPlaced(null);
    el.current = null;
  }, []);
  const go = useCallback((d: 1 | -1) => setI((cur) => (cur === null ? null : cur + d >= TOUR.length ? null : Math.max(0, cur + d))), []);

  const place = useCallback(() => {
    const c = card.current;
    const box = el.current && el.current.isConnected ? el.current.getBoundingClientRect() : null;
    setPlaced(placeTour(box && onScreen(box, viewport()) ? box : null, viewport(), { width: c?.offsetWidth || 320, height: c?.offsetHeight || 170 }));
  }, []);

  const on = useRef(false);
  on.current = i !== null;
  useEffect(() => {
    const onStart = () => setI(0);
    // Capture phase on window, added on mount before ShellKeys adds its own,
    // so while the tour is on a page's keys, G and `?` never see a key.
    const onKey = (e: KeyboardEvent) => {
      // Tab and Space work the card's buttons, ⌘ / Ctrl / Alt stay the browser's; every other key is the tour's.
      if (!on.current || e.key === "Tab" || e.key === " " || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") end();
      else if (e.key === "ArrowRight" || e.key === "Enter") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener(START_EVENT, onStart);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(START_EVENT, onStart);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [end, go]);

  // Go to the step's page, then wait for what it spotlights.
  useEffect(() => {
    if (i === null) return;
    const step = TOUR[i];
    if (step.href && !onStepPage(step.href, pathname, sub)) {
      router.push(step.href);
      return;
    }
    const targets = tourTargets(step.targets, matchMedia("(max-width: 767px)").matches);
    const since = Date.now();
    let frame = 0;
    const look = () => {
      const found = find(targets);
      if (found || !targets.length || Date.now() - since > WAIT_MS) {
        el.current = found;
        found?.scrollIntoView({ block: "nearest" });
        place();
        return;
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [i, pathname, sub, router, place]);

  // Focus Next once the card is placed, so the keys work from the first step.
  useLayoutEffect(() => {
    if (i !== null && placed) next.current?.focus({ preventScroll: true });
  }, [i, placed]);

  useEffect(() => {
    if (i === null) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [i, place]);

  if (i === null) return null;
  const step = TOUR[i];
  const last = i === TOUR.length - 1;
  const ease = "duration-200 ease-[var(--spring)] motion-reduce:transition-none";

  return (
    <div className="fixed inset-0 z-[300]">
      <div className={cn("absolute inset-0", !placed?.spot && "ov-tour-dim")} aria-hidden />
      {placed?.spot ? <div aria-hidden className={cn("ov-tour-light pointer-events-none absolute transition-[left,top,width,height]", ease)} style={placed.spot} /> : null}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-live="polite"
        className={cn("ov-dialog absolute w-[340px] max-w-[calc(100vw-32px)] px-5 pt-5 pb-4 shadow-[var(--pop-shadow)] transition-[left,top]", ease, !placed && "invisible")}
        style={placed?.card}
      >
        <button type="button" onClick={end} aria-label="Skip" title="Skip (esc)" className="ov-icon-btn absolute top-3 right-3">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
        <h3 id="tour-title" className="m-0 pr-8 font-sans text-[18px] leading-6 font-semibold tracking-[-0.01em]">
          {step.title}
        </h3>
        <p className="m-0 mt-2 font-sans text-[14px] leading-[22px] text-muted-foreground">{step.body}</p>
        <div
          role="progressbar"
          aria-label="Tutorial"
          aria-valuemin={1}
          aria-valuemax={TOUR.length}
          aria-valuenow={i + 1}
          aria-valuetext={`Step ${i + 1} of ${TOUR.length}`}
          title={`Step ${i + 1} of ${TOUR.length}`}
          className="ov-tour-progress mt-[18px] mb-3.5"
        >
          <i style={{ width: `${((i + 1) / TOUR.length) * 100}%` }} />
        </div>
        {/* Testbench's foot: the way back on the left (Skip on the first step), the way on, black, on the right. */}
        <div className="flex items-center justify-between gap-2">
          {i ? (
            <Button variant="ghost" onClick={() => go(-1)} className="-ml-2.5">
              <Arrow back />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={end} className="-ml-2.5">
              Skip
            </Button>
          )}
          <Button ref={next} onClick={() => go(1)}>
            {last ? "Done" : "Next"}
            {last ? null : <Arrow />}
          </Button>
        </div>
      </div>
    </div>
  );
}
