import { departmentOptions } from "@/lib/client/department-tree";
import {
  edgeName, formatMins, levelsOf, pathFor, stepWho,
  type PathStop, type ProcessDoc, type ProcessLookup, type ProcessNode, type StageType,
} from "@/lib/client/process-graph";
import { cn } from "@/lib/utils";

// The process as text: the view below 900px, and the keyboard and screen-reader
// view at any width, since the canvas is a pointer's. Read-only. It draws what is
// on the page, saved or not, so it never disagrees with the canvas beside it.
// Levels in order, ruled apart; no numbers in front of them.

const KINDS: Record<StageType, string> = { review: "Review", testbench: "Testbench", interview: "Interview" };

const STOPS: Record<PathStop, string> = {
  no_start: "there is no start",
  no_branch: "stops at a split with no branch for it",
  dead_end: "stops, nothing comes next",
  loop: "goes round in a loop",
};

function branchInto(node: ProcessNode, graph: ProcessDoc, lookup: ProcessLookup): string | null {
  const routes = new Set(graph.nodes.filter((n) => n.kind === "route").map((n) => n.id));
  const edges = graph.edges.filter((e) => e.to === node.id && routes.has(e.from));
  return edges.length ? edges.map((e) => edgeName(e, lookup.departments)).join(", ") : null;
}

function Step({ node, graph, lookup }: { node: ProcessNode; graph: ProcessDoc; lookup: ProcessLookup }) {
  const who = stepWho(node, lookup);
  const branch = branchInto(node, graph, lookup);
  return (
    <div className="grid min-w-0 gap-0.5">
      <b className="text-[13px] font-medium [overflow-wrap:anywhere]">{node.label.trim() || "Unnamed step"}</b>
      {/* Each fact its own span, spaced rather than dotted. */}
      <p className="m-0 flex flex-wrap gap-x-3 text-[12px] text-faint [overflow-wrap:anywhere]">
        {[branch, KINDS[node.type ?? "interview"], formatMins(node.mins)].filter(Boolean).map((fact, i) => (
          <span key={i}>{fact}</span>
        ))}
        <span className={cn(who.gap && "proc-gap")}>{who.tag}</span>
      </p>
    </div>
  );
}

function TeamPaths({ graph, lookup }: { graph: ProcessDoc; lookup: ProcessLookup }) {
  const scopes = [...departmentOptions(lookup.departments).map((d) => ({ id: d.id as string | null, name: d.path })), { id: null, name: "No team" }];
  return (
    <section aria-label="The way through for each team" className="grid gap-1.5">
      <h4 className="m-0 font-sans text-[13.5px] font-semibold">The way through for each team</h4>
      <dl className="m-0 grid gap-1.5">
        {scopes.map(({ id, name }) => {
          const path = pathFor(graph, id, lookup.departments);
          const stages = path.nodes.filter((n) => n.kind === "stage").map((n) => n.label.trim() || "Unnamed step");
          return (
            <div key={id ?? "none"} className="proc-path">
              <dt className="text-[12.5px] text-faint [overflow-wrap:anywhere]">{name}</dt>
              <dd className="m-0 text-[13px] [overflow-wrap:anywhere]">
                {stages.join(" → ") || "No steps"}
                {path.stop ? <span className="proc-gap"> ({STOPS[path.stop]})</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export function ProcessList({ graph, lookup }: { graph: ProcessDoc; lookup: ProcessLookup }) {
  const levels = levelsOf(graph);
  const start = graph.nodes.find((n) => n.kind === "start");
  const end = graph.nodes.find((n) => n.kind === "end");
  const notes = graph.nodes.filter((n) => n.kind === "note");
  return (
    <div className="grid gap-4">
      <section aria-label="Steps in order" className="grid gap-1.5">
        <p className="m-0 text-[12.5px] text-faint">
          From <b className="font-medium text-foreground">{start?.label.trim() || "the start"}</b> to <b className="font-medium text-foreground">{end?.label.trim() || "the end"}</b>.
        </p>
        {levels.length ? (
          <ol className="m-0 grid list-none p-0">
            {levels.map((level) => (
              <li key={level[0].id} className="proc-level">
                {level.length > 1 ? <span className="text-[12px] text-faint">Depends on the team</span> : null}
                {level.map((node) => (
                  <Step key={node.id} node={node} graph={graph} lookup={lookup} />
                ))}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[13px] text-faint">No steps connected to the start yet.</p>
        )}
      </section>
      {graph.nodes.some((n) => n.kind === "route") || lookup.departments.length ? <TeamPaths graph={graph} lookup={lookup} /> : null}
      {notes.length ? (
        <section aria-label="Notes" className="grid gap-1.5">
          <h4 className="m-0 font-sans text-[13.5px] font-semibold">Notes</h4>
          <ul className="m-0 grid list-none gap-1 p-0">
            {notes.map((n) => (
              <li key={n.id} className="text-[13px] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                {n.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
