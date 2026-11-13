"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useKeyHelp } from "@/components/keys";
import {
  ZOOM_MAX, ZOOM_MIN, clampZoom, edgePath, editorKey, fitView, leftOf, newId, newNode, toWorld, zoomAt,
  type EditorAction, type EditorState, type Point, type View,
} from "@/lib/client/process-editor";
import { NODE_SIZE, defaultGraph, edgeName, formatMins, stepWho, summaryOf, type ProcessLookup, type ProcessNode } from "@/lib/client/process-graph";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { Inspector } from "./inspector";

// The flowchart (design/tats's flowInner and its document listeners), by hand: no
// library. Pointer positions and rects are the page's own pixels (the shell has
// no zoom), and lib/client/process-editor.ts does the arithmetic. A pointer's
// view: the list beside it is the keyboard's. Drawn in onboarding.css: the steps
// are Testbench cards on a dotted well, the edges grey, the ports round handles.

const icon = "size-[15px] flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]";
const PATHS = {
  start: "M2.5 9.5h3l1 2h3l1-2h3M3.5 3.5h9l1 6v3h-11v-3z",
  end: "M4 14V2.5M4 3h8l-2 3 2 3H4",
  route: "M2.5 8h4M6.5 8c2 0 2-4.5 4.5-4.5H13M6.5 8c2 0 2 4.5 4.5 4.5H13",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  note: "M3 3h10v7l-3 3H3zM10 13v-3h3",
  undo: "M5.5 4 2.5 7l3 3M2.5 7h7a4 4 0 0 1 0 8H8",
  redo: "M10.5 4l3 3-3 3M13.5 7h-7a4 4 0 0 0 0 8H8",
};
const Ico = ({ name }: { name: keyof typeof PATHS }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={icon}>
    <path d={PATHS[name]} />
  </svg>
);

function NodeBox({ node, selected, flagged, lookup, port }: { node: ProcessNode; selected: boolean; flagged: boolean; lookup: ProcessLookup; port: boolean }) {
  const [width, height] = NODE_SIZE[node.kind];
  const who = node.kind === "stage" ? stepWho(node, lookup) : null;
  const dot = port && node.kind !== "end" && node.kind !== "note" ? <i className="fc-port" data-port title="Drag to connect" /> : null;
  return (
    <div className={cn("fc-n", node.kind, selected && "sel", flagged && "bad", who?.gap && "gap")} data-fn={node.id} style={{ left: node.x, top: node.y, width, height }}>
      {node.kind === "note" ? <p>{node.label}</p> : null}
      {node.kind === "start" || node.kind === "end" || node.kind === "route" ? (
        <>
          <Ico name={node.kind} />
          <b className="truncate">{node.label}</b>
        </>
      ) : null}
      {who ? (
        <>
          <div className="fc-nh">
            <b className="truncate">{node.label || "Unnamed step"}</b>
            {node.mins ? <span>{formatMins(node.mins)}</span> : null}
          </div>
          <div className="fc-nf">
            <span className="truncate">{who.tag}</span>
          </div>
        </>
      ) : null}
      {dot}
    </div>
  );
}

type Drag =
  | { k: "move"; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }
  | { k: "link"; from: string }
  | { k: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean };

export function ProcessCanvas({
  state,
  dispatch,
  lookup,
  readOnly,
  flagged,
  shown,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  lookup: ProcessLookup;
  readOnly: boolean;
  /** Nodes a problem names. */
  flagged: Set<string>;
  /** The Canvas view is on: it fits itself when it comes into view. */
  shown: boolean;
}) {
  const { graph, selection } = state;
  const vp = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 80, z: 1 });
  const [link, setLink] = useState<(Point & { from: string }) | null>(null);
  const latest = useRef({ view, graph, selection });
  latest.current = { view, graph, selection };

  // A rect's and pointer's screen pixels, as the page's CSS pixels inside the viewport.
  const inViewport = useCallback((clientX: number, clientY: number): Point => {
    const r = vp.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const fit = useCallback(() => {
    if (!vp.current) return;
    const r = vp.current.getBoundingClientRect();
    const next = fitView(latest.current.graph, r.width, r.height);
    if (next) setView(next);
  }, []);

  // Hidden, it has no size: wait for one. Once per showing, so a drag is never undone by a resize.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    fitted.current = false;
    if (!shown || !vp.current) return;
    const tryFit = () => {
      if (fitted.current || !vp.current || !isShown(vp.current) || !vp.current.clientWidth) return;
      fitted.current = true;
      fit();
    };
    tryFit();
    const watch = new ResizeObserver(tryFit);
    watch.observe(vp.current);
    return () => watch.disconnect();
  }, [shown, fit]);

  // React's wheel listener is passive, and this one has to stop the page scrolling.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = latest.current.view;
      if (e.ctrlKey || e.metaKey) setView(zoomAt(v, inViewport(e.clientX, e.clientY), v.z * Math.exp(-e.deltaY * 0.01)));
      else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [inViewport]);

  // ⌘Z and the rest. Not useKeys: its ignoreKey skips ⌘.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShown(vp.current)) return;
      const key = editorKey(e);
      if (!key) return;
      if (key === "undo" || key === "redo") {
        e.preventDefault();
        dispatch({ type: key });
      } else if (latest.current.selection) {
        e.preventDefault();
        dispatch(key === "remove" ? { type: "remove" } : { type: "select", selection: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, readOnly]);

  useKeyHelp(
    "Interview process",
    readOnly
      ? []
      : [
          { keys: "⌘ Z", label: "Undo" },
          { keys: "⇧ ⌘ Z", label: "Redo" },
          { keys: "Delete", label: "Remove what's selected" },
          { keys: "Esc", label: "Clear the selection" },
        ],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 1) return;
    const target = e.target as Element;
    const port = target.closest("[data-port]");
    const nodeEl = target.closest<HTMLElement>("[data-fn]");
    const edgeEl = target.closest<HTMLElement>("[data-fe]");
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const v = latest.current.view;
    const world = (x: number, y: number) => toWorld(v, inViewport(x, y));

    let drag: Drag;
    if (port && nodeEl && !readOnly) {
      drag = { k: "link", from: nodeEl.dataset.fn! };
      setLink({ from: drag.from, ...world(e.clientX, e.clientY) });
    } else if (nodeEl) {
      const node = latest.current.graph.nodes.find((n) => n.id === nodeEl.dataset.fn);
      if (!node) return;
      dispatch({ type: "select", selection: { t: "n", id: node.id } });
      if (readOnly) return;
      const p = world(e.clientX, e.clientY);
      drag = { k: "move", id: node.id, dx: p.x - node.x, dy: p.y - node.y, sx: e.clientX, sy: e.clientY, moved: false };
    } else if (edgeEl) {
      dispatch({ type: "select", selection: { t: "e", id: edgeEl.dataset.fe! } });
      return;
    } else {
      drag = { k: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
    }

    const onMove = (ev: PointerEvent) => {
      if (drag.k === "link") {
        setLink({ from: drag.from, ...world(ev.clientX, ev.clientY) });
        return;
      }
      // A click that trembles is still a click.
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
      drag.moved = true;
      if (drag.k === "move") {
        const p = world(ev.clientX, ev.clientY);
        dispatch({ type: "drag", id: drag.id, x: p.x - drag.dx, y: p.y - drag.dy });
      } else {
        setView({ ...latest.current.view, x: drag.vx + ev.clientX - drag.sx, y: drag.vy + ev.clientY - drag.sy });
      }
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (drag.k === "move") dispatch({ type: "dragEnd" });
      if (drag.k === "link") {
        setLink(null);
        const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-fn]")?.dataset.fn;
        if (ev.type === "pointerup" && to) dispatch({ type: "connect", id: newId("e"), from: drag.from, to, departments: lookup.departments });
      }
      if (drag.k === "pan" && !drag.moved) dispatch({ type: "select", selection: null });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const add = (kind: "stage" | "route" | "note", at?: Point) => {
    const r = vp.current!.getBoundingClientRect();
    const c = at ?? toWorld(view, { x: r.width / 2, y: r.height / 2 });
    dispatch({ type: "add", node: newNode(kind, newId("n"), c) });
    // The inspector for it exists after this render.
    setTimeout(() => {
      const input = vp.current?.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='label']");
      input?.focus();
      input?.select();
    });
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if ((e.target as Element).closest("[data-fn]")) {
      const input = vp.current?.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='label']");
      input?.focus();
      input?.select();
      return;
    }
    add("stage", toWorld(view, inViewport(e.clientX, e.clientY)));
  };

  const zoomBy = (factor: number) => {
    const r = vp.current!.getBoundingClientRect();
    setView(zoomAt(view, { x: r.width / 2, y: r.height / 2 }, clampZoom(view.z * factor)));
  };

  const linkFrom = link ? graph.nodes.find((n) => n.id === link.from) : null;
  const size = 20 * view.z;
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const sum = summaryOf(graph);

  return (
    <div className="fc" role="group" aria-label="Flowchart of the process. The List shows the same thing for a keyboard or a screen reader." data-mode={readOnly ? "read" : "edit"}>
      <div
        ref={vp}
        className="fc-vp"
        data-testid="process-viewport"
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${size}px ${size}px` }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <div className="fc-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="fc-edges" width="1" height="1" aria-hidden>
            {graph.edges.map((e) => {
              const a = nodes.get(e.from);
              const b = nodes.get(e.to);
              if (!a || !b) return null;
              const tip = leftOf(b);
              const d = edgePath(a, tip);
              const name = e.label.trim() || (a.kind === "route" ? edgeName(e, lookup.departments) : "");
              const sx = a.x + NODE_SIZE[a.kind][0];
              const sy = a.y + NODE_SIZE[a.kind][1] / 2;
              return (
                <g key={e.id} className={cn("fc-e", selection?.id === e.id && "sel")} data-fe={e.id}>
                  <path className="hit" d={d} />
                  <path className="ln" d={d} />
                  <path className="ar" d={`M${tip.x - 7} ${tip.y - 4}L${tip.x} ${tip.y}L${tip.x - 7} ${tip.y + 4}Z`} />
                  {name ? (
                    <text x={(sx + tip.x) / 2} y={(sy + tip.y) / 2 - 6}>
                      {name}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {link && linkFrom ? <path className="fc-tmp" d={edgePath(linkFrom, link)} /> : null}
          </svg>
          {graph.nodes.map((n) => (
            <NodeBox key={n.id} node={n} selected={selection?.t === "n" && selection.id === n.id} flagged={flagged.has(n.id)} lookup={lookup} port={!readOnly} />
          ))}
        </div>
      </div>

      {selection ? (
        <Inspector state={state} dispatch={dispatch} lookup={lookup} readOnly={readOnly} />
      ) : (
        <div className="fc-pill" title={readOnly ? "Drag to pan. ⌘ + scroll to zoom. Click a step to read it." : "Double-click the canvas to add a step. Drag from the dot on a step to connect it. Click a step to say who runs it. Delete removes, ⌘Z undoes. Scroll to pan, ⌘ + scroll to zoom."}>
          <span>
            {sum.steps} step{sum.steps === 1 ? "" : "s"}
          </span>
          <span>
            {sum.interviews} interview{sum.interviews === 1 ? "" : "s"}
          </span>
          <span>about {formatMins(sum.mins) || "0m"} per candidate</span>
        </div>
      )}

      <div className="fc-tools">
        {readOnly ? null : (
          <>
            <button type="button" className="fc-tb" title="Add a step" onClick={() => add("stage")}>
              <Ico name="plus" />
              Step
            </button>
            <button type="button" className="fc-tb" title="Add a split" onClick={() => add("route")}>
              <Ico name="route" />
              Split
            </button>
            <button type="button" className="fc-tb" title="Add a note" onClick={() => add("note")}>
              <Ico name="note" />
              Note
            </button>
            <i className="fc-sep" />
          </>
        )}
        <button type="button" className="fc-tb ic" aria-label="Zoom out" disabled={view.z <= ZOOM_MIN} onClick={() => zoomBy(1 / 1.2)}>
          <Ico name="minus" />
        </button>
        <span className="fc-z" data-testid="process-zoom">
          {Math.round(view.z * 100)}%
        </span>
        <button type="button" className="fc-tb ic" aria-label="Zoom in" disabled={view.z >= ZOOM_MAX} onClick={() => zoomBy(1.2)}>
          <Ico name="plus" />
        </button>
        <button type="button" className="fc-tb" title="Fit to screen" onClick={fit}>
          Fit
        </button>
        {readOnly ? null : (
          <>
            <i className="fc-sep" />
            <button type="button" className="fc-tb ic" aria-label="Undo (⌘Z)" title="Undo (⌘Z)" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
              <Ico name="undo" />
            </button>
            <button type="button" className="fc-tb ic" aria-label="Redo (⇧⌘Z)" title="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
              <Ico name="redo" />
            </button>
            <button type="button" className="fc-tb" title="Start over from the neutral process" onClick={() => dispatch({ type: "reset", graph: defaultGraph() })}>
              Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
