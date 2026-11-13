"use client";

import type { Dispatch } from "react";
import { pillOption, pillTrack } from "@/components/page";
import { departmentOptions } from "@/lib/client/department-tree";
import type { EditorAction, EditorState } from "@/lib/client/process-editor";
import { NOTE_MAX, OWNERS, STEP_NAME_MAX, edgeName, type Owner, type ProcessEdge, type ProcessLookup, type ProcessNode, type StageType } from "@/lib/client/process-graph";
import { cn } from "@/lib/utils";

// What is selected on the canvas (design/tats's fcInspector), a card floating
// over the canvas's right (onboarding.css). A <fieldset disabled>
// makes it the read-only reading of the same thing for someone who may not edit.
// "Another team" is stored and shown only. Who runs a step and how long it takes
// are descriptive: nothing books from them, there being no bot to.

const KINDS: Array<[StageType, string]> = [["review", "Review"], ["testbench", "Testbench"], ["interview", "Interview"]];
const LENGTHS: Array<[number, string]> = [[30, "30m"], [45, "45m"], [60, "1h"], [90, "1.5h"], [180, "3h"]];

/** Kind and Length: Testbench's small segmented control, the picked one raised. */
function Pills<T extends string | number>({ label, options, value, onPick }: { label: string; options: Array<[T, string]>; value: T | undefined; onPick: (v: T) => void }) {
  return (
    <div className={cn(pillTrack, "fc-pills")} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" className={cn(pillOption(v === value, "sm"), v === value && "on")} aria-pressed={v === value} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Owners({ node, lookup, patch }: { node: ProcessNode; lookup: ProcessLookup; patch: (p: Partial<ProcessNode>) => void }) {
  const teams = departmentOptions(lookup.departments);
  const pinned = node.who ?? [];
  const team = node.team ?? "own";
  const value = pinned.length ? "" : team;
  const offTheList = !pinned.length && !(team in OWNERS) && !teams.some((t) => t.id === team);
  return (
    <div className="fc-f">
      <label className="grid gap-1.5">
        <span>Who runs it</span>
        <select value={value} onChange={(e) => patch({ team: e.target.value, who: undefined })}>
          {pinned.length ? <option value="">Only the people below</option> : null}
          {(Object.keys(OWNERS) as Owner[]).map((o) => (
            <option key={o} value={o}>
              {OWNERS[o]}
            </option>
          ))}
          {teams.length ? (
            <optgroup label="Teams">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.path}
                </option>
              ))}
            </optgroup>
          ) : null}
          {offTheList ? <option value={team}>{lookup.departments.find((d) => d.id === team)?.name ?? "A team no longer here"} (archived)</option> : null}
        </select>
      </label>
      {pinned.length ? (
        <div className="fc-people">
          {pinned.map((id) => (
            <button key={id} type="button" className="fc-pp" title="Take off this step" onClick={() => patch({ who: pinned.filter((p) => p !== id) })}>
              <span className={cn(!lookup.members.some((m) => m.id === id) && "proc-gap")}>{lookup.members.find((m) => m.id === id)?.name ?? "Someone who left"}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : null}
      <select aria-label="Pin it to someone" value="" onChange={(e) => e.target.value && patch({ who: [...pinned, e.target.value] })}>
        <option value="">Pin it to someone…</option>
        {lookup.members
          .filter((m) => !pinned.includes(m.id))
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function Branch({ edge, lookup, onDepartment }: { edge: ProcessEdge; lookup: ProcessLookup; onDepartment: (id: string | undefined) => void }) {
  const teams = departmentOptions(lookup.departments);
  const gone = !!edge.department && !teams.some((t) => t.id === edge.department);
  return (
    <select aria-label="Which team takes this branch" value={edge.department ?? ""} onChange={(e) => onDepartment(e.target.value || undefined)}>
      <option value="">Everyone else</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.path}
        </option>
      ))}
      {gone ? <option value={edge.department}>{lookup.departments.find((d) => d.id === edge.department)?.name ?? "A team no longer here"} (archived)</option> : null}
    </select>
  );
}

function EdgeFields({ edge, state, lookup, dispatch, readOnly }: { edge: ProcessEdge; state: EditorState; lookup: ProcessLookup; dispatch: Dispatch<EditorAction>; readOnly: boolean }) {
  const name = (id: string) => state.graph.nodes.find((n) => n.id === id);
  const from = name(edge.from);
  const patch = (p: Partial<ProcessEdge>, typing?: string) => dispatch({ type: "patchEdge", id: edge.id, patch: p, typing });
  return (
    <>
      <b className="fc-ih">{from?.kind === "route" ? "Branch" : "Connection"}</b>
      <span className="fc-sub">
        {from?.label} → {name(edge.to)?.label}
      </span>
      {from?.kind === "route" ? (
        <label className="fc-f">
          <span>Team</span>
          <Branch edge={edge} lookup={lookup} onDepartment={(department) => patch({ department })} />
        </label>
      ) : null}
      <label className="fc-f">
        <span>Label</span>
        <input data-field="label" value={edge.label} maxLength={STEP_NAME_MAX} placeholder="Pass, Yes, Infra…" autoComplete="off" onChange={(e) => patch({ label: e.target.value }, `edge:${edge.id}`)} />
      </label>
      {readOnly ? null : (
        <button type="button" className="fc-del" onClick={() => dispatch({ type: "remove" })}>
          Remove connection
        </button>
      )}
    </>
  );
}

function NodeFields({ node, state, lookup, dispatch, readOnly }: { node: ProcessNode; state: EditorState; lookup: ProcessLookup; dispatch: Dispatch<EditorAction>; readOnly: boolean }) {
  const patch = (p: Partial<ProcessNode>, typing?: string) => dispatch({ type: "patchNode", id: node.id, patch: p, typing });
  const onLabel = (label: string) => patch({ label }, `label:${node.id}`);
  if (node.kind === "note") {
    return (
      <>
        <b className="fc-ih">Note</b>
        <label className="fc-f">
          <span className="sr-only">Note</span>
          <textarea data-field="label" rows={4} value={node.label} maxLength={NOTE_MAX} onChange={(e) => onLabel(e.target.value)} />
        </label>
        {readOnly ? null : (
          <button type="button" className="fc-del" onClick={() => dispatch({ type: "remove" })}>
            Remove note
          </button>
        )}
      </>
    );
  }
  const outs = state.graph.edges.filter((e) => e.from === node.id);
  const title = { route: "Split", start: "Start", end: "End", stage: "Step" }[node.kind];
  const target = (e: ProcessEdge) => state.graph.nodes.find((n) => n.id === e.to)?.label ?? "";
  return (
    <>
      <b className="fc-ih">{title}</b>
      <label className="fc-f">
        <span>Name</span>
        <input data-field="label" value={node.label} maxLength={STEP_NAME_MAX} autoComplete="off" onChange={(e) => onLabel(e.target.value)} />
      </label>
      {node.kind === "stage" ? (
        <>
          <div className="fc-f">
            <span>Kind</span>
            <Pills label="Kind" options={KINDS} value={node.type ?? "interview"} onPick={(type) => patch({ type })} />
          </div>
          {node.type === "testbench" ? null : <Owners node={node} lookup={lookup} patch={patch} />}
          <div className="fc-f">
            <span>Length</span>
            <Pills label="Length" options={LENGTHS} value={node.mins} onPick={(mins) => patch({ mins })} />
          </div>
          <p className="fc-hint">Only interviews go on a job&apos;s plan. Who runs a step and how long it takes are for the people reading this: nothing is booked from them.</p>
        </>
      ) : null}
      {node.kind === "route" ? <p className="fc-hint">Candidates go down the branch for the team their job is in, or the one a team inside it is in. Say which team takes each.</p> : null}
      {outs.length ? (
        <div className="fc-f">
          <span>Then</span>
          {outs.map((e) => (
            <label key={e.id} className="fc-out">
              <span className="truncate">{target(e)}</span>
              {node.kind === "route" ? (
                <Branch edge={e} lookup={lookup} onDepartment={(department) => dispatch({ type: "patchEdge", id: e.id, patch: { department } })} />
              ) : (
                <input value={e.label} placeholder="Label" aria-label={`Label for the way to ${target(e)}`} autoComplete="off" onChange={(ev) => dispatch({ type: "patchEdge", id: e.id, patch: { label: ev.target.value }, typing: `edge:${e.id}` })} />
              )}
            </label>
          ))}
        </div>
      ) : null}
      {readOnly && node.kind === "route" && outs.length ? <p className="fc-hint">{outs.map((e) => edgeName(e, lookup.departments)).join(", ")}</p> : null}
      {readOnly || node.kind === "start" || node.kind === "end" ? null : (
        <button type="button" className="fc-del" onClick={() => dispatch({ type: "remove" })}>
          Remove {node.kind === "route" ? "split" : "step"}
        </button>
      )}
    </>
  );
}

export function Inspector({ state, dispatch, lookup, readOnly }: { state: EditorState; dispatch: Dispatch<EditorAction>; lookup: ProcessLookup; readOnly: boolean }) {
  const { selection, graph } = state;
  const edge = selection?.t === "e" ? graph.edges.find((e) => e.id === selection.id) : null;
  const node = selection?.t === "n" ? graph.nodes.find((n) => n.id === selection.id) : null;
  if (!edge && !node) return null;
  const props = { state, dispatch, lookup, readOnly };
  return (
    <aside className="fc-insp" aria-label="Selected">
      <fieldset disabled={readOnly} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        {edge ? <EdgeFields key={edge.id} edge={edge} {...props} /> : null}
        {node ? <NodeFields key={node.id} node={node} {...props} /> : null}
      </fieldset>
    </aside>
  );
}
