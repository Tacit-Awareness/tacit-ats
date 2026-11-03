"use client";

import { useEffect, useMemo, useReducer, useState, useTransition } from "react";
import { Notice, pillOption, pillTrack } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { ProcessRead } from "@/lib/client/process";
import { editorReducer, editorState } from "@/lib/client/process-editor";
import { validateGraph } from "@/lib/client/process-graph";
import { leavesPage } from "@/lib/client/posting-draft";
import { holdLeave } from "@/lib/leave-guard";
import { saveProcessAction } from "./actions";
import { ApplyDialog } from "./apply-dialog";
import { ProcessCanvas } from "./canvas";
import { ProcessList } from "./list";
import { SAVE_ERRORS, STALE_SAVE } from "./messages";

// The step's one client component: the drawing, Save, and the Canvas / List switch.
// The list reads the same state as the canvas, so it shows what is on the page.
// Below 900px there is only the list (onboarding.css), and a keyboard or a screen
// reader is sent to it by the switch, which comes first. Saved only by Save.

type Said = { tone: "info" | "error"; text: string } | null;

/** `onDirty` hears whether there is anything unsaved, for a sheet that has to ask before it closes. */
export function ProcessEditor({ read, canEdit, onDirty }: { read: ProcessRead; canEdit: boolean; onDirty?: (dirty: boolean) => void }) {
  const [state, dispatch] = useReducer(editorReducer, read.graph, editorState);
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [saved, setSaved] = useState(() => ({ text: JSON.stringify(read.graph), updatedAt: read.updatedAt, drawn: read.drawn }));
  const [conflict, setConflict] = useState<{ latest: string | null } | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const [saving, start] = useTransition();
  const [applying, setApplying] = useState(false);

  const dirty = useMemo(() => JSON.stringify(state.graph) !== saved.text, [state.graph, saved.text]);
  const { problems, gaps } = useMemo(() => validateGraph(state.graph, read.lookup), [state.graph, read.lookup]);
  const flagged = useMemo(() => new Set(problems.flatMap((p) => p.nodeId ?? [])), [problems]);

  useEffect(() => onDirty?.(dirty && canEdit), [dirty, canEdit, onDirty]);

  // Closing the tab, and a link in the app, which changes page with no `beforeunload`.
  useEffect(() => {
    if (!dirty || !canEdit) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
      if (!link || !leavesPage(e, link, window.location.href)) return;
      if (window.confirm("Leave without saving? What you changed here will be lost.")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    const release = holdLeave();
    return () => {
      release();
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, canEdit]);

  const save = (expectedUpdatedAt: string | null) =>
    start(async () => {
      const graph = state.graph;
      setSaid(null);
      try {
        const answer = await saveProcessAction({ graph, expectedUpdatedAt });
        if (answer.ok) {
          setSaved({ text: JSON.stringify(graph), updatedAt: answer.updatedAt, drawn: true });
          setConflict(null);
          setSaid({ tone: "info", text: "Saved. No job has changed: apply it when you're ready." });
        } else if ("stale" in answer) {
          setConflict({ latest: answer.latest });
        } else {
          setSaid({ tone: "error", text: SAVE_ERRORS[answer.error] });
        }
      } catch {
        setSaid({ tone: "error", text: SAVE_ERRORS.failed });
      }
    });

  const applyHint = dirty || !saved.drawn ? "Save first: Apply uses what's saved." : problems.length ? "Fix what's listed first." : undefined;
  const canApply = !applyHint && !saving && saved.updatedAt !== null;

  return (
    <div className="proc grid min-w-0 gap-2.5" data-view={view}>
      {saved.drawn ? null : <Notice>Nothing&apos;s saved yet. This is a starting point, not your process.</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <div className={`proc-views ${pillTrack}`} role="group" aria-label="How to show the process">
          <button type="button" className={pillOption(view === "canvas")} aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>
            Canvas
          </button>
          <button type="button" className={pillOption(view === "list")} aria-pressed={view === "list"} onClick={() => setView("list")}>
            List<span className="sr-only">, for a keyboard or a screen reader</span>
          </button>
        </div>
        <span className="flex-1" />
        {canEdit ? (
          <>
            <span className="text-xs text-faint" role="status">
              {dirty ? "Unsaved changes" : saved.drawn ? "Saved" : ""}
            </span>
            <Button size="sm" disabled={saving || (!dirty && saved.drawn)} onClick={() => save(saved.updatedAt)}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" disabled={!canApply} title={applyHint} onClick={() => setApplying(true)}>
              Apply to jobs
            </Button>
          </>
        ) : null}
      </div>

      {conflict ? (
        <Notice tone="error">
          {STALE_SAVE}{" "}
          <button type="button" className="underline" disabled={saving} onClick={() => save(conflict.latest)}>
            Save mine over it
          </button>{" "}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </Notice>
      ) : null}
      {said ? <Notice tone={said.tone}>{said.text}</Notice> : null}

      <ProcessCanvas state={state} dispatch={dispatch} lookup={read.lookup} readOnly={!canEdit} flagged={flagged} shown={view === "canvas"} />
      <div className="proc-listwrap">
        <ProcessList graph={state.graph} lookup={read.lookup} />
      </div>

      {problems.length ? (
        <div className="proc-notes" role="status">
          <b>To fix before this can go on any job</b>
          <ul>
            {problems.map((p) => (
              <li key={`${p.code}:${p.nodeId ?? p.message}`}>{p.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {gaps.length ? (
        <div className="proc-notes gaps">
          <b>Worth a look</b>
          <ul>
            {gaps.map((g) => (
              <li key={`${g.code}:${g.nodeId ?? g.edgeId}`}>{g.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {applying && saved.updatedAt ? <ApplyDialog updatedAt={saved.updatedAt} onClose={() => setApplying(false)} /> : null}
    </div>
  );
}
