"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page, PageBar, SubBar } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { showToast } from "@/components/toasts";
import { useKeyHelp, useKeys } from "@/components/keys";
import { WIDGETS, WIDGET_KEYS, WIDGETS_COOKIE, SIZE_NAMES, addWidget, cycleSize, defaultWidgets, formatWidgets, moveWidget, parseWidgets, removeWidget, type Placed, type WidgetKey } from "@/lib/client/home-widgets";
import { cn } from "@/lib/utils";
import "./home-widgets.css";

// The Overview's widgets (design/tats's Edit widgets, on the iPhone home
// screen's model): home-view.tsx draws every widget on the server and this
// places them. Edit widgets: drag one and the others slide out of its way, or
// arrow keys on a focused one; − removes, the pill cycles Small / Wide / Full,
// and Add widget opens a gallery of the rest with live previews. Done or Esc
// ends it. Present: the Overview alone, full screen, until Esc. The layout
// saves on each change, to the cookie the page reads for its first paint.
// GSAP's Flip is the prototype's; here a few lines of the Web Animations API,
// because nothing else in this app wants GSAP.

const LOCK_MS = 300;
const EDGE = 60;

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function cookieLayout(fallback: Placed[]) {
  if (typeof document === "undefined") return fallback;
  const row = document.cookie.split("; ").find((c) => c.startsWith(`${WIDGETS_COOKIE}=`));
  return row ? parseWidgets(row.slice(WIDGETS_COOKIE.length + 1)) : fallback;
}

function saveLayout(layout: Placed[]) {
  document.cookie = `${WIDGETS_COOKIE}=${formatWidgets(layout)}; path=/; max-age=31536000; samesite=lax`;
}

const ICON = { grid: "M3 3h4v4H3ZM9 3h4v4H9ZM3 9h4v4H3ZM9 9h4v4H9Z", expand: "M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3", plus: "M8 3.5v9M3.5 8h9", minus: "M3.5 8h9", check: "M3.5 8.5l3 3 6-7" };

const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-[14px] shrink-0" aria-hidden>
    <path d={d} />
  </svg>
);

type Drag = { el: HTMLElement; k: WidgetKey; scroller: HTMLElement | null; x0: number; y0: number; x: number; y: number; grabX: number; grabY: number; moved: boolean; lock: number };

export function HomeBoard({ title, icon, filters, tabs, widgets, layout: saved, foot }: {
  title: string;
  icon: React.ReactNode;
  filters: React.ReactNode;
  tabs: React.ReactNode;
  /** Every widget this member can have, drawn. */
  widgets: Partial<Record<WidgetKey, React.ReactNode>>;
  layout: Placed[];
  foot: React.ReactNode;
}) {
  // The cookie, not only the prop: Back brings a cached page whose prop was read before the last edit.
  const [layout, setLayout] = useState(() => cookieLayout(saved));
  const [editing, setEditing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [arrived, setArrived] = useState<WidgetKey | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef(layout);
  live.current = layout;

  const items = () => [...(grid.current?.querySelectorAll<HTMLElement>(".wg") ?? [])];

  /** Before a change: where each widget is, so it can slide from there. */
  const measure = () => {
    if (calm()) return;
    before.current = new Map(items().map((el) => [el.dataset.wk!, el.getBoundingClientRect()]));
  };

  const place = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    // Measured with no transform, so a reorder or a scroll under the widget is already in the number.
    d.el.style.transform = "none";
    const r = d.el.getBoundingClientRect();
    d.el.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px) scale(1.03)`;
  }, []);

  useLayoutEffect(() => {
    place();
    const from = before.current;
    before.current = null;
    if (!from) return;
    for (const el of items()) {
      const was = from.get(el.dataset.wk!);
      if (!was || el === drag.current?.el) continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [layout, place]);

  const change = (next: Placed[]) => {
    measure();
    setLayout(next);
    saveLayout(next);
  };

  const remove = (k: WidgetKey, el: HTMLElement | null) => {
    const drop = () => change(removeWidget(live.current, k));
    if (!el || calm()) return drop();
    el.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.7)", opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" }).finished.then(drop);
  };

  const add = (k: WidgetKey) => {
    change(addWidget(live.current, k));
    setArrived(k);
    setGallery(false);
    showToast({ text: `Added ${WIDGETS[k].name}` });
  };

  const reset = () => {
    change(defaultWidgets());
    setGallery(false);
    showToast({ text: "Back to the default layout" });
  };

  useEffect(() => {
    if (arrived) grid.current?.querySelector(`[data-wk="${arrived}"]`)?.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
  }, [arrived]);

  /** Arrow keys on a focused widget: the same move as a drag, onto its neighbour. */
  const onWidgetKey = (e: React.KeyboardEvent, k: WidgetKey) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!d || e.target !== e.currentTarget) return;
    e.preventDefault();
    const shown = live.current.filter((x) => widgets[x.k]);
    const over = shown[shown.findIndex((x) => x.k === k) + d];
    if (over) change(moveWidget(live.current, k, over.k));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>(".wg");
    if (!editing || !el || e.button || target.closest(".wg-ctl")) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag.current = {
      el,
      k: el.dataset.wk as WidgetKey,
      scroller: el.closest<HTMLElement>(".hm-page"),
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      moved: false,
      lock: 0,
    };

    const onMove = (m: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.x = m.clientX;
      d.y = m.clientY;
      if (!d.moved) {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) < 4) return;
        d.moved = true;
        d.el.classList.add("lift");
        document.body.classList.add("wg-dragging");
      }
      place();
      // Over another widget, take its place; the pause lets the others finish sliding, or it would swap straight back.
      const over = Date.now() > d.lock ? document.elementsFromPoint(d.x, d.y).map((n) => n.closest<HTMLElement>(".wg")).find((n) => n && n !== d.el) : null;
      if (over) {
        d.lock = Date.now() + LOCK_MS;
        measure();
        setLayout(moveWidget(live.current, d.k, over.dataset.wk as WidgetKey));
      }
      if (d.scroller) {
        const box = d.scroller.getBoundingClientRect();
        const v = d.y < box.top + EDGE ? -12 : d.y > box.bottom - EDGE ? 12 : 0;
        if (v) {
          d.scroller.scrollTop += v;
          place();
        }
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("wg-dragging");
      if (!d?.moved) return;
      saveLayout(live.current);
      d.el.classList.remove("lift");
      d.el.classList.add("settle");
      d.el.style.transform = "";
      setTimeout(() => d.el.classList.remove("settle"), 260);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const present = () => {
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const stopPresenting = () => {
    setPresenting(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  useEffect(() => {
    if (!presenting) return;
    document.body.classList.add("present");
    // Esc in full screen is the browser's and never reaches the page.
    const onChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.body.classList.remove("present");
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [presenting]);

  useKeys({ Escape: () => (presenting ? stopPresenting() : setEditing(false)) }, presenting || editing);
  useKeyHelp("Home", editing ? [{ keys: "← / →", label: "Move the focused widget" }, { keys: "Esc", label: "Done editing" }] : []);

  const shown = layout.filter((x) => widgets[x.k]);
  const available = WIDGET_KEYS.filter((k) => widgets[k]);

  return (
    <Page
      bleed
      className="hm-page"
      bar={
        <>
          <PageBar title={title} icon={icon}>
            {editing ? (
              <>
                <span className="wg-hint">Drag to move · − to remove</span>
                <Button size="sm" variant="outline" onClick={() => setGallery(true)}>
                  <Glyph d={ICON.plus} />
                  Add widget
                </Button>
                <Button size="sm" onClick={() => setEditing(false)}>
                  Done
                </Button>
              </>
            ) : (
              <>
                {filters}
                <span className="hm-actions">
                  <button type="button" data-tour="edit-widgets" className={buttonVariants({ size: "sm", variant: "ghost" })} title="Choose, move and resize the blocks on this page" onClick={() => setEditing(true)}>
                    <Glyph d={ICON.grid} />
                    Edit widgets
                  </button>
                  <button type="button" className={buttonVariants({ size: "sm", variant: "ghost" })} title="Full screen, for a projector or a TV (Esc to leave)" onClick={present}>
                    <Glyph d={ICON.expand} />
                    Present
                  </button>
                </span>
              </>
            )}
          </PageBar>
          <div className="hm-nav">
            <SubBar>{tabs}</SubBar>
          </div>
        </>
      }
    >
      <div className="hm fit">
        <div ref={grid} data-tour="kpis" className={cn("wg-grid", editing && "editing")} onPointerDown={onPointerDown}>
          {shown.map((x) => {
            const W = WIDGETS[x.k];
            return (
              <div key={x.k} data-wk={x.k} tabIndex={editing ? 0 : undefined} role={editing ? "group" : undefined} aria-label={editing ? W.name : undefined} className={cn("wg", `w${x.w}`, x.k === arrived && "arrive")} onKeyDown={editing ? (e) => onWidgetKey(e, x.k) : undefined}>
                <div className="wg-j">
                  {/* Still while editing, so the block can be picked up and nothing in it takes a Tab. */}
                  <div className="wg-in" inert={editing}>
                    {widgets[x.k]}
                  </div>
                  {editing ? (
                    <>
                      <button type="button" className="wg-ctl wg-x" aria-label={`Remove ${W.name}`} onClick={(e) => remove(x.k, e.currentTarget.closest(".wg"))}>
                        <Glyph d={ICON.minus} />
                      </button>
                      {W.sizes.length > 1 ? (
                        <button type="button" className="wg-ctl wg-sz" title="Change size" aria-label={`${W.name}: ${SIZE_NAMES[x.w]}. Change size`} onClick={() => change(cycleSize(live.current, x.k))}>
                          {SIZE_NAMES[x.w]}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
          {editing ? (
            <button type="button" className="wg-add" onClick={() => setGallery(true)}>
              <Glyph d={ICON.plus} />
              <span>Add widget</span>
            </button>
          ) : null}
        </div>
        {!shown.length && !editing ? (
          <div className="wg-empty">
            <p>No widgets on your Overview.</p>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Glyph d={ICON.grid} />
              Edit widgets
            </Button>
          </div>
        ) : null}
        {foot}
      </div>
      {gallery ? <Gallery widgets={widgets} keys={available} on={new Set(shown.map((x) => x.k))} add={add} reset={reset} close={() => setGallery(false)} /> : null}
    </Page>
  );
}

/** Every widget with a live preview, the ones already placed marked. */
function Gallery({ widgets, keys, on, add, reset, close }: {
  widgets: Partial<Record<WidgetKey, React.ReactNode>>;
  keys: WidgetKey[];
  on: Set<WidgetKey>;
  add: (k: WidgetKey) => void;
  reset: () => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="Add a widget"
      className="wg-galm"
      onClose={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="wg-gal-h">
        <h2>Add a widget</h2>
        <p>Pick the numbers you care about. Each one keeps its own size and place.</p>
      </div>
      <div className="wg-gal">
        {[...keys]
          .sort((x, y) => Number(on.has(x)) - Number(on.has(y)))
          .map((k) => {
            const W = WIDGETS[k];
            const placed = on.has(k);
            return (
              <div key={k} className={cn("wg-tile", placed && "off")}>
                <span className="wg-prev" inert>
                  <span className={cn("wg-prev-in", `w${W.sizes[0]}`)}>{widgets[k]}</span>
                </span>
                <span className="wg-tile-t">
                  <b>{W.name}</b>
                  <span>{W.desc}</span>
                </span>
                {placed ? (
                  <span className="wg-tile-a">
                    <Glyph d={ICON.check} />
                    On your Overview
                  </span>
                ) : (
                  <button type="button" className="wg-tile-a" aria-label={`Add ${W.name}`} onClick={() => add(k)}>
                    <Glyph d={ICON.plus} />
                    Add
                  </button>
                )}
              </div>
            );
          })}
      </div>
      <div className="wg-gal-f">
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset to the default layout
        </Button>
        <Button size="sm" variant="outline" onClick={close}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
