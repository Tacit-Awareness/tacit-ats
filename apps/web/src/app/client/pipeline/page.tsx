import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { stageLabel } from "@/lib/client/crm-views";
import { departmentScope, departmentTabs, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { readPipeline, type PipelineEntry } from "@/lib/client/pipeline";
import { movesFor } from "@/lib/client/pipeline-moves";
import { PIPELINE_COLUMNS, ago, isColumnKey, lastInterviewAt, nextInterviewAt, until, type ColumnKey } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { readPersonTags } from "@/lib/client/views";
import { describeFilters, hasFilters, parseViewFilters, parseViewId, rowSource, viewKeeps } from "@/lib/saved-views";
import { Refusal } from "../refusal";
import type { BoardCard, BoardColumn } from "./board-state";
import { PipelineView } from "./view";

// Every open job's live applications on one board (design/tats's Pipeline),
// read with the signed-in member's own token (lib/client/pipeline.ts). This
// page only arranges it: the member's department tabs, job chip and name
// filter (a department narrows the job chip to its jobs and those of the
// departments inside it, lib/client/department-tree.ts), each column's
// order, and a dozen cards a column until "Show all". A card opens the
// candidate page; on a job the member may edit it also carries its real stage
// moves (lib/client/pipeline-moves.ts), which board.tsx offers by drag and keys.
// A saved view (lib/saved-views.ts) is the same page with
// `?stage=&source=&tag=&view=` in the URL: the filters come from there, never
// from the browser's copy, and picking a department leaves the view, as the
// prototype.

/** Cards a column shows before "Show all", as design/tats's board. */
const COLUMN_PREVIEW = 12;

/** The card's one status line: what is happening, or what is next. */
function statusOf(e: PipelineEntry, now: number): string {
  switch (e.column) {
    case "booked": {
      const next = nextInterviewAt(e.interviews, now);
      return next ? `Interview ${until(next, now)}` : "Interview booked";
    }
    case "decide": {
      const last = lastInterviewAt(e.interviews, now);
      return last ? `Interviewed ${ago(last, now)}` : "Interviewed";
    }
    case "new":
      return e.sourceDetail ?? `Added ${ago(e.addedAt, now)}`;
    case "scheduling":
      return e.nextAction ?? "No interview booked";
    default:
      return e.nextAction ?? `Touched ${ago(e.lastTouchAt, now)}`;
  }
}

/**
 * Within a column, what needs looking at first: the soonest interview, the
 * longest wait for a decision, the stalest card; New shows the newest first.
 */
function sortKey(e: PipelineEntry, now: number): number {
  if (e.column === "booked") return Date.parse(nextInterviewAt(e.interviews, now) ?? e.lastTouchAt);
  if (e.column === "decide") return Date.parse(lastInterviewAt(e.interviews, now) ?? e.lastTouchAt);
  if (e.column === "new") return -Date.parse(e.addedAt);
  return Date.parse(e.lastTouchAt);
}

export default async function ClientPipeline({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Pipeline" />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      </Page>
    );
  }

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim();
  const expanded = isColumnKey(one(sp.all)) ? (one(sp.all) as ColumnKey) : null;
  const viewId = parseViewId(one(sp.view));
  const filters = parseViewFilters({ stage: one(sp.stage), source: one(sp.source), tag: one(sp.tag) });

  const now = new Date();
  const nowMs = now.getTime();
  const [pipeline, structure] = await Promise.all([readPipeline(db, now), readDepartments(db)]);
  const scope = departmentScope(structure, one(sp.department));
  const department = scope.departmentId;
  const jobs = pipeline.jobs.filter((j) => inScope(scope, j.id));
  const entries = pipeline.entries.filter((e) => inScope(scope, e.roleId));
  const [tagged, tagName] = filters.tag
    ? await Promise.all([
        readPersonTags(db, entries.map((e) => e.personId), filters.tag),
        db.from("tags").select("name").eq("id", filters.tag).maybeSingle().then((r) => r.data?.name ?? null),
      ])
    : [null, null];
  const viewed = entries.filter((e) => viewKeeps(filters, { roleId: e.roleId, column: e.column, source: rowSource(e), tagIds: tagged?.get(e.personId) ?? [] }, null));
  const job = jobs.some((j) => j.id === one(sp.job)) ? one(sp.job) : null;
  const needle = q.toLowerCase();
  const shown = viewed.filter((e) => (!job || e.roleId === job) && (!needle || `${e.personName} ${e.headline ?? ""}`.toLowerCase().includes(needle)));

  const viewParams = { stage: filters.stage, source: filters.source, tag: filters.tag, view: viewId };
  const href = (next: { department?: string | null; job?: string | null; all?: ColumnKey | null; leaveView?: boolean }) => {
    const params = new URLSearchParams();
    const d = next.department === undefined ? department : next.department;
    const j = next.job === undefined ? job : next.job;
    const a = next.all === undefined ? expanded : next.all;
    if (d) params.set("department", d);
    if (j) params.set("job", j);
    if (q) params.set("q", q);
    if (a) params.set("all", a);
    if (!next.leaveView) {
      for (const [k, v] of Object.entries(viewParams)) if (v) params.set(k, v);
    }
    const qs = params.toString();
    return `/client/pipeline${qs ? `?${qs}` : ""}`;
  };

  const columns: BoardColumn[] = PIPELINE_COLUMNS.map(({ key, label }) => {
    const all = shown.filter((e) => e.column === key).sort((a, b) => sortKey(a, nowMs) - sortKey(b, nowMs));
    const open = expanded === key;
    const cards: BoardCard[] = (open ? all : all.slice(0, COLUMN_PREVIEW)).map((e) => ({
      applicationId: e.applicationId,
      personId: e.personId,
      href: `/client/candidates/${e.personId}`,
      name: e.personName,
      line: job ? (e.headline ?? e.roleTitle) : e.roleTitle,
      status: statusOf(e, nowMs),
      ownerName: e.ownerName,
      stalled: e.stalled.length > 0,
      stage: e.stage,
      stageLabel: stageLabel(e.stage),
      moves: e.editable ? movesFor(e.stage, e.interviews, nowMs) : null,
    }));
    return {
      key,
      label,
      total: all.length,
      cards,
      more: all.length > COLUMN_PREVIEW ? { href: href({ all: open ? null : key }), label: open ? "Show fewer" : `Show all ${all.length}` } : null,
    };
  });

  return (
    <PipelineView
      total={shown.length}
      columns={columns}
      capped={pipeline.capped}
      departments={departmentTabs(scope, (d) => href({ department: d, job: null, all: null, leaveView: true }))}
      job={
        jobs.length
          ? {
              value: job ? (jobs.find((j) => j.id === job)?.title ?? "All jobs") : "All jobs",
              on: !!job,
              options: [
                { href: href({ job: null, all: null }), label: `All jobs (${viewed.length})`, active: !job },
                ...jobs.map((j) => ({
                  href: href({ job: j.id, all: null }),
                  label: `${j.title} (${viewed.filter((e) => e.roleId === j.id).length})`,
                  active: job === j.id,
                })),
              ],
            }
          : null
      }
      search={{ q, keep: { department, job, ...viewParams } }}
      view={
        viewId || hasFilters(filters)
          ? {
              id: viewId,
              fallback: describeFilters({ ...filters, department }, { department: scope.options.find((o) => o.id === department)?.path, tag: tagName }),
            }
          : null
      }
      empty={
        entries.length === 0
          ? department
            ? "Nobody is in this department's open jobs yet."
            : "Nobody is in an open job's pipeline yet."
          : shown.length === 0
            ? "Nobody matches."
            : null
      }
    />
  );
}
