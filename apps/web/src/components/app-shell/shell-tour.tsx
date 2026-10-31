"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TOUR, onScreen, placeTour, type Box } from "@/lib/tour";
import { cssPx, cssRect } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";

// design/tats's tutorial, the React half (lib/tour.ts is the pure half): a
// walk through every page, one spotlight at a time. Tutorial in the account
// menu starts it; each step goes to its page, waits for what
// it spotlights and puts the card beside it. Clicks outside the card are
// blocked; → or Enter is Next, ← is Back, Esc ends it. Nothing is saved.

const START_EVENT = "tats:tour";
/** How long a step waits for its page and element before centring the card. */
const WAIT_MS = 3000;

const viewport = () => ({ width: cssPx(innerWidth), height: cssPx(innerHeight) });

function find(targets: string[]): HTMLElement | null {
  for (const sel of targets) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && onScreen(cssRect(el.getBoundingClientRect()), viewport())) return el;
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

type Placed = { spot: Box | null; card: { left: number; top: number } };

export function ShellTour() {
  const router = useRouter();
  const pathname = usePathname();
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
    const box = el.current && el.current.isConnected ? cssRect(el.current.getBoundingClientRect()) : null;
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
    if (step.href && pathname !== step.href) {
      router.push(step.href);
      return;
    }
    const since = Date.now();
    let frame = 0;
    const look = () => {
      const found = find(step.targets);
      if (found || Date.now() - since > WAIT_MS) {
        el.current = found;
        found?.scrollIntoView({ block: "nearest" });
        place();
        return;
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [i, pathname, router, place]);

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
      <div className={cn("absolute inset-0", placed?.spot ? "" : "bg-[oklch(0.1_0.004_var(--brand-h)/0.55)]")} aria-hidden />
      {placed?.spot ? (
        <div
          aria-hidden
          className={cn("pointer-events-none absolute transition-[left,top,width,height]", ease)}
          style={{
            ...placed.spot,
            boxShadow: "0 0 0 9999px oklch(0.1 0.004 var(--brand-h) / 0.55), 0 0 0 2px var(--n0), 0 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)",
          }}
        />
      ) : null}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-live="polite"
        className={cn("absolute w-[320px] max-w-[calc(100vw-32px)] bg-raised p-5 text-foreground shadow-[var(--pop-shadow)] transition-[left,top]", ease, !placed && "invisible")}
        style={placed?.card}
      >
        <div className="text-[12.5px] font-medium text-[color:var(--accent)]">
          {i + 1} of {TOUR.length}
        </div>
        <h3 id="tour-title" className="m-0 mt-2 text-[17px] font-semibold tracking-[-0.01em]">
          {step.title}
        </h3>
        <p className="m-0 mt-2 text-[14px] leading-[1.55] text-muted-foreground">{step.body}</p>
        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={end} className="text-[13px] text-muted-foreground hover:text-foreground">
            Skip
          </button>
          <span className="flex-1" />
          {i ? (
            <Button size="sm" variant="outline" onClick={() => go(-1)}>
              Back
            </Button>
          ) : null}
          <Button ref={next} size="sm" onClick={() => go(1)}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
