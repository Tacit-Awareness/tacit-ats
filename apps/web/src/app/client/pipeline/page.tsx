import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { crmHref, stageLabel } from "@/lib/client/crm-views";
import { departmentAndBelow, departmentScope, departmentTabs, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { readDecisionLoop, type DecisionLoop } from "@/lib/client/inbox";
import { hiddenOn, lastHeld } from "@/lib/client/interview-loop";
import { countPastMatches, pastMatchWords } from "@/lib/client/past-matches";
import { readPipeline, type PipelineEntry } from "@/lib/client/pipeline";
import { movesFor } from "@/lib/client/pipeline-moves";
import { SOURCE_GROUPS } from "@/lib/client/analytics-metrics";
import { PIPELINE_COLUMNS, isColumnKey, type ColumnKey } from "@/lib/client/pipeline-columns";
import { factsOf, isStuck, modeParam, parseLayout, parseNameSearch, pipelineHref, resolveMode, rowGroups, sortKey, stageCounts, statusOf, type ModeContext, type PipelineLink } from "@/lib/client/pipeline-list";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { readPersonTags } from "@/lib/client/views";
import { describeFilters, parseViewFilters, parseViewId, rowSource, viewKeeps } from "@/lib/saved-views";
import { Refusal } from "../refusal";
import { CandidateBody } from "../candidates/[id]/view";
import type { CandidateJourney } from "../candidates/[id]/dashboard";
import { feedbackCards, loopProps } from "../interviews/loop-props";
import { readCandidateView } from "../candidates/[id]/read";
import type { BoardCard, BoardColumn } from "./board-state";
import { PersonPopup } from "./popup";
import type { FactKind, ListFact } from "./list";
import { PipelineView, type PipelineListProps } from "./view";

// Every open job's live applications (design/tats's Pipeline), read with the
// signed-in member's own token (lib/client/pipeline.ts). This page only
// arranges it: the member's department tabs, job chip and name filter (a
// department narrows the job chip to its jobs and those of the departments
// inside it, lib/client/department-tree.ts). Across jobs it is a list that opens
// on who is stuck (`?mode=`, lib/client/pipeline-list.ts), with a stage bar; one
// job picked, the board, each column in its order with a dozen cards until
// "Show all", or that job's list (`?layout=list`, the bar's switch). A row opens
// the candidate in a pop-up (`?open=<application id>`, only ever one this read
// holds, so a tampered id is no pop-up), a card their page; on a job the member
// may edit, a card also carries its real stage moves (lib/client/pipeline-moves.ts),
// which board.tsx offers by drag, keys and a right-click, and a row the same ones
// by a right-click and S (row-menu.tsx).
// A saved view (lib/saved-views.ts) is the same page with
// `?stage=&source=&tag=&view=` in the URL: the filters come from there, never
// from the browser's copy, and picking a department leaves the view, as the
// prototype. A view opens in Everyone, so Stuck never overrides its filters.
// `?stage=` is also the stage bar's: one filter, so a view's stage shows on the
// bar. Using the bar drops `view`, because the URL is no longer that view (its
// source and label stay), and a stage alone is not a view, so it gets no crumb.
// A name filter also counts the closed applications it would find, a count and
// a link into the CRM (lib/client/past-matches.ts), never the people themselves.

/**
 * The pop-up's interview loop and reads, for the application it was opened
 * from: the Interviews reader's loop with no round picked (the pop-up is about
 * the person, not one interview) and nothing to edit in it, and every read the
 * member may see, with a word on any kept from them.
 */
function journeyOf(read: DecisionLoop | null, applicationId: string, candidate: string, isAdmin: boolean, now: number): CandidateJourney | null {
  if (!read) return null;
  const held = lastHeld(read.progress, now);
  const hidden = held ? hiddenOn(read.progress, held) : 0;
  const notes = [
    read.feedback?.yoursOutstanding && !isAdmin ? "Others' feedback may stay hidden until you file yours." : null,
    hidden ? `${hidden === 1 ? "One interviewer's" : `${hidden} interviewers'`} feedback on the last round is not visible to you.` : null,
  ].filter(Boolean);
  return {
    applicationId,
    loop: {
      ...loopProps({ candidate, jobTitle: read.plan.title, progress: read.progress, selectedId: "", listed: new Set(), href: () => "", stage: read.stage, routing: read.routing, isAdmin, now }),
      editProcess: null,
    },
    feedback: read.feedback ? feedbackCards(read.feedback, now) : [],
    feedbackNote: notes.length ? notes.join(" ") : null,
  };
}

/** Cards a column shows before "Show all", as design/tats's board. */
const COLUMN_PREVIEW = 12;

/** What a glance at a row wants first, after the name and the status: the job, why they're stuck, the owner, the source, then the rest. */
const FACT_ORDER: FactKind[] = ["job", "stuck", "owner", "source", "stage", "more"];

/**
 * A row's facts as list.tsx draws them: lib's own (factsOf, the same words the
 * row's spoken label carries), each named for what it is so it can take its
 * tone, in FACT_ORDER. What isn't the job, stage, owner, source or headline is
 * a stuck reason, which is all factsOf adds.
 */
function rowFacts(e: PipelineEntry): ListFact[] {
  const kind = (text: string): FactKind =>
    text === e.roleTitle
      ? "job"
      : text === e.ownerName
        ? "owner"
        : text === e.headline
          ? "more"
          : text === e.stageName?.name
            ? "stage"
            : SOURCE_GROUPS.some((g) => g.label === text)
              ? "source"
              : "stuck";
  return factsOf(e)
    .map((text) => ({ text, kind: kind(text) }))
    .sort((a, b) => FACT_ORDER.indexOf(a.kind) - FACT_ORDER.indexOf(b.kind));
}

export default async function ClientPipeline({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Applicant Tickets" />}>
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
  const q = parseNameSearch(one(sp.q));
  const expanded = isColumnKey(one(sp.all)) ? (one(sp.all) as ColumnKey) : null;
  const viewId = parseViewId(one(sp.view));
  const filters = parseViewFilters({ stage: one(sp.stage), source: one(sp.source), tag: one(sp.tag) });

  const now = new Date();
  const nowMs = now.getTime();
  const [pipeline, structure] = await Promise.all([readPipeline(db, now, toolCtx(gate.ctx)), readDepartments(db)]);
  const openId = one(sp.open);
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
  // Everything but the stage: the stage bar counts every stage from this.
  const unstaged = entries.filter((e) => viewKeeps({ ...filters, stage: null }, { roleId: e.roleId, column: e.column, source: rowSource(e), tagIds: tagged?.get(e.personId) ?? [] }, null));
  const viewed = unstaged.filter((e) => !filters.stage || e.column === filters.stage);
  const job = jobs.some((j) => j.id === one(sp.job)) ? one(sp.job) : null;
  const needle = q.toLowerCase();
  const matches = (e: PipelineEntry) => (!job || e.roleId === job) && (!needle || `${e.personName} ${e.headline ?? ""}`.toLowerCase().includes(needle));
  const shown = viewed.filter(matches);
  const pastCount = q ? await countPastMatches(db, q, { jobId: job, departmentIds: department ? [...departmentAndBelow(structure.departments, department)] : null }) : 0;

  const viewParams = { stage: filters.stage, source: filters.source, tag: filters.tag, view: viewId };
  const modeContext: ModeContext = { ...viewParams, all: expanded, q: q || null };
  const mode = resolveMode(one(sp.mode), modeContext);
  const layout = parseLayout(one(sp.layout));
  const onList = !job || layout === "list";
  const href = (next: PipelineLink) => pipelineHref({ ...viewParams, department, job, q: q || null, all: expanded, mode, layout }, next);

  // The board has no stage bar to clear a stage picked from it, so a job drops that; a saved view's stage stays.
  const forJob = viewId ? viewed : unstaged;
  const jobStage = viewId ? undefined : null;

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
      ownerActorId: e.ownerActorId,
      stalled: e.stalled.length > 0,
      stage: e.stage,
      stageLabel: e.stageName?.name ?? stageLabel(e.stage),
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

  // The team each job is with, by name: a row says which team its person is interviewing with.
  const jobTeam = new Map(structure.jobs.map((j) => [j.jobId, j.departmentId]));
  const teamName = new Map(structure.departments.map((d) => [d.id, d.name]));
  const teamOf = (roleId: string) => teamName.get(jobTeam.get(roleId) ?? "") ?? null;

  const list = (): PipelineListProps => {
    const matching = unstaged.filter(matches);
    const matchingById = new Map(matching.map((e) => [e.applicationId, e]));
    // Only when the rows span more than one team: under one, every row would say the same.
    const teams = new Set(matching.map((e) => teamOf(e.roleId))).size > 1;
    const groups = rowGroups(matching, { mode, stage: filters.stage, expanded, now: nowMs }).map((g) => ({
      ...g,
      rows: g.rows.map((r) => {
        const e = matchingById.get(r.applicationId);
        return {
          ...r,
          openHref: href({ open: r.applicationId }),
          active: r.applicationId === openId,
          parts: e ? rowFacts(e) : undefined,
          team: teams && e ? (teamOf(e.roleId) ?? "No team") : undefined,
          menu: e?.editable ? { stage: e.stage, stageLabel: e.stageName?.name ?? stageLabel(e.stage), moves: movesFor(e.stage, e.interviews, nowMs) } : null,
        };
      }),
      moreHref: g.more ? href({ all: g.more.all }) : null,
    }));
    const filtered = !!(needle || filters.stage || filters.source || filters.tag);
    return {
      modes: [
        { href: href({ mode: "stuck", all: null }), label: "Stuck", count: shown.filter(isStuck).length.toLocaleString("en-US"), active: mode === "stuck" },
        { href: href({ mode: "everyone" }), label: "Everyone", count: shown.length.toLocaleString("en-US"), active: mode === "everyone" },
      ],
      stages: stageCounts(matching).map((s) => ({ ...s, active: s.key === filters.stage, href: href({ stage: s.key === filters.stage ? null : s.key, all: null }) })),
      groups,
      teams,
      zero: groups.length
        ? null
        : mode === "stuck"
          ? {
              title: filtered ? "Nobody here is stuck" : "Nobody's stuck",
              note: filtered ? "No one matching these filters is overdue or gone quiet." : "Nobody has gone a week without a touch, and no next action is overdue.",
              action: shown.length ? { href: href({ mode: "everyone" }), label: "See everyone" } : null,
            }
          : { title: "No one here", note: "Nothing matches these filters.", action: null },
    };
  };

  const opened = onList ? entries.find((e) => e.applicationId === openId) : undefined;
  const member = { actorId: gate.ctx.actorId, orgId: gate.ctx.org.id, accessLevel };
  const [person, loop] = opened
    ? await Promise.all([readCandidateView(gate.ctx, opened.personId, nowMs), readDecisionLoop(db, member, { jobId: opened.roleId, applicationId: opened.applicationId })])
    : [null, null];

  return (
    <PipelineView
      total={shown.length}
      columns={columns}
      list={onList ? list() : null}
      layout={{ on: onList ? "list" : "board", list: href({ layout: "list", all: null }), board: job ? href({ layout: null, all: null, stage: jobStage }) : null }}
      popup={
        opened && person ? (
          // The pop-up's head names them and no more: the job and where they stand are the dashboard's own head and side card.
          <PersonPopup
            applicationId={opened.applicationId}
            title={opened.personName?.trim() || "Unnamed"}
            home={href({})}
            pageHref={`/client/candidates/${opened.personId}`}
          >
            <CandidateBody {...person} notice={null} error={null} dashboard journey={journeyOf(loop, opened.applicationId, opened.personName?.trim() || "Unnamed", accessLevel === "admin", nowMs)} />
          </PersonPopup>
        ) : null
      }
      capped={pipeline.capped}
      past={pastCount ? { href: crmHref({ department, view: "all", q, sort: "last", dir: "desc", page: 1 }), label: pastMatchWords(pastCount, q) } : null}
      departments={departmentTabs(scope, (d) => href({ department: d, job: null, all: null, leaveView: true }))}
      job={
        jobs.length
          ? {
              value: job ? (jobs.find((j) => j.id === job)?.title ?? "All jobs") : "All jobs",
              on: !!job,
              options: [
                { href: href({ job: null, all: null }), label: `All jobs (${viewed.length})`, active: !job },
                ...jobs.map((j) => ({
                  href: href({ job: j.id, all: null, stage: jobStage }),
                  label: `${j.title} (${forJob.filter((e) => e.roleId === j.id).length})`,
                  active: job === j.id,
                })),
              ],
            }
          : null
      }
      search={{ q, keep: { department, job, ...viewParams, mode: modeParam(mode, modeContext), layout: job ? layout : null } }}
      view={
        viewId || filters.source || filters.tag
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
          : !onList && shown.length === 0
            ? "Nobody matches."
            : null
      }
    />
  );
}
