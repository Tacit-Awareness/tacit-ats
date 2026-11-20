import Link from "next/link";
import { ChevronRight, CircleUser } from "lucide-react";
import { clientTools } from "@tacit-ats/core";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { Avatar } from "@/components/tickets/avatar";
import { Blocks, type Block } from "@/components/tickets/blocks";
import { Header } from "@/components/tickets/header";
import { StagePips } from "@/components/tickets/stage-pips";
import { StatusIcon } from "@/components/tickets/status-icon";
import { TONE_COLOR, worst } from "@/components/tickets/tone";
import { readTickets } from "@/lib/client/bot-tasks";
import { departmentScope, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { FUNNEL_STAGES, liveTone } from "@/lib/client/home-tickets-rules";
import { isColumnKey } from "@/lib/client/pipeline-columns";
import { readPipeline } from "@/lib/client/pipeline";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";

// People (design/tacit-tickets's People), under Tickets: everyone in process, on
// the Pipeline's read (lib/client/pipeline.ts) on the member's own token, a row
// per live application with its stage as pips, its next action and owner. A row
// folds open to that candidate's tickets, the company bot's tasks on it
// (lib/client/bot-tasks.ts), each opening on Tickets. Tabs: Active, Referred
// (source referral) and All, which is the CRM, every candidate open and closed.
// A team (`?department=`) gets its blocks on top, a block per Pipeline column,
// and picking one (`?stage=`) keeps that column.
// Left out: Prospects and Check In (pools and the job-change check are not on
// this page's reads yet; the CRM has pools), New Candidate (added from a job's
// board or Triage).

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const COLS = "grid grid-cols-[minmax(180px,1fr)_150px_minmax(140px,220px)_40px] @max-2xl:grid-cols-[minmax(160px,1fr)_150px] items-center gap-4";

export default async function ClientPeople({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="People" />}>
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
  const now = new Date();
  const ctx: clientTools.ClientToolCtx = { actorId, orgId: org.id, accessLevel, source: "claude" };
  const [pipeline, { tickets }, approvals, structure] = await Promise.all([
    readPipeline(db, now),
    readTickets(db),
    clientTools.listMyApprovals(db, ctx).catch((err: unknown) => {
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return [];
      throw err;
    }),
    readDepartments(db),
  ]);
  const scope = departmentScope(structure, one(sp.department));
  const team = scope.departmentId ? (scope.options.find((o) => o.id === scope.departmentId)?.name ?? null) : null;
  const tab = one(sp.tab) === "referred" ? "referred" : "active";
  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (scope.departmentId) p.set("department", scope.departmentId);
    const q = p.toString();
    return q ? `/client/tickets/people?${q}` : "/client/tickets/people";
  };

  const waiting = new Set(approvals.flatMap((a) => (a.kind === "offer" && a.applicationId ? [a.applicationId] : [])));
  const live = pipeline.entries.filter((e) => inScope(scope, e.roleId)).map((e) => ({ e, tone: liveTone({ column: e.column, stalled: e.stalled, waitingOnMe: waiting.has(e.applicationId) }) }));
  const blocks: Block[] = FUNNEL_STAGES.map((st) => {
    const here = live.filter((x) => x.e.column === st.key);
    const tone = worst(here.map((x) => x.tone));
    return { key: st.key, name: st.label, tone: tone ? TONE_COLOR[tone] : undefined, dots: here.map((x) => ({ id: x.e.applicationId, name: x.e.personName, sub: x.e.roleTitle, note: x.e.nextAction ?? undefined, tone: TONE_COLOR[x.tone], href: `/client/candidates/${x.e.personId}` })) };
  });
  const stage = team && isColumnKey(one(sp.stage)) ? one(sp.stage) : null;
  const shown = live
    .filter((x) => (tab === "referred" ? x.e.source === "referral" : true))
    .filter((x) => !stage || x.e.column === stage)
    .sort((a, b) => a.e.personName.localeCompare(b.e.personName));
  const ticketsOf = (applicationId: string) => tickets.filter((t) => t.applicationId === applicationId);

  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1">
      <div className="@container flex min-w-0 flex-1 flex-col">
        <Header
          scope={team}
          title="People"
          tabs={[
            { label: "Active", href: href({}), on: tab === "active" },
            { label: "Referred", href: href({ tab: "referred" }), on: tab === "referred" },
            { label: "All", href: scope.departmentId ? `/client/candidates?department=${scope.departmentId}` : "/client/candidates", on: false },
          ]}
        />
        {team && tab === "active" && (
          <div className="shrink-0 border-b border-line">
            <Blocks title={`${live.length} in process now`} blocks={blocks} param="stage" />
          </div>
        )}
        <div className={`${COLS} h-9 shrink-0 border-b border-line pr-5 pl-5 text-xs text-dim`}>
          <span className="pl-6">Name</span>
          <span>Stage</span>
          <span className="@max-2xl:hidden">Next</span>
          <span className="@max-2xl:hidden">Owner</span>
        </div>
        <div className="scroll-quiet flex-1 overflow-y-auto py-1">
          {!shown.length && (
            <div className="flex min-h-[240px] flex-col items-center justify-center px-8 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
                <CircleUser size={18} />
              </span>
              <div className="mt-4 font-medium text-ink">{tab === "referred" ? "No referrals" : "No candidates"}</div>
              <p className="mt-1.5 max-w-[320px] text-mute">{tab === "referred" ? "People your team refers show up here." : "People you route from Triage show up here, with where they stand."}</p>
            </div>
          )}
          {shown.map(({ e, tone }) => {
            const kids = ticketsOf(e.applicationId);
            const wash = tone === "failed" || tone === "needs" ? `wash-${tone}` : "";
            const row = (
              <>
                <span className="flex min-w-0 items-center gap-2.5">
                  {/* The arrow sits above the row's link, so it alone folds the tickets open */}
                  <span className={`relative z-10 -m-1.5 flex shrink-0 rounded-md p-1.5 ${kids.length ? "hover:bg-sel" : "invisible"}`}>
                    <ChevronRight size={14} className="text-dim transition-transform group-open/p:rotate-90" />
                  </span>
                  {/* The whole row is the way to the candidate: the link's own box is stretched over it, and the row takes the focus ring */}
                  <Link href={`/client/candidates/${e.personId}`} className="flex min-w-0 items-center gap-2.5 rounded-md font-medium text-ink outline-none after:absolute after:inset-0">
                    <Avatar name={e.personName} size={22} />
                    <span className="truncate">{e.personName}</span>
                  </Link>
                  <span className="hidden min-w-0 truncate text-mute @3xl:inline">{e.roleTitle}</span>
                </span>
                <StagePips stage={e.stage} />
                <span className="truncate text-mute @max-2xl:hidden">
                  {e.nextAction}
                  {e.nextActionDue && <span className="ml-2 text-dim">Due {e.nextActionDue}</span>}
                </span>
                <span className="flex items-center @max-2xl:hidden">{e.ownerName ? <Avatar name={e.ownerName} /> : null}</span>
              </>
            );
            return kids.length ? (
              <details key={e.applicationId} className="group/p anim-rise">
                <summary className={`${COLS} h-12 w-full cursor-default list-none pr-5 pl-5 text-left transition-colors hover:bg-hover ${wash} relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ink [&::-webkit-details-marker]:hidden`}>{row}</summary>
                {kids.map((t, i) => (
                  <Link key={t.id} href={`/client/tickets?t=${t.id}&all=1`} className="relative flex h-10 w-full items-center gap-2.5 pr-5 pl-[62px] text-left transition-colors hover:bg-hover">
                    <span className={`absolute left-[38px] w-px bg-line-strong ${i === kids.length - 1 ? "top-0 h-1/2" : "inset-y-0"}`} />
                    <span className="absolute top-1/2 left-[38px] h-px w-3.5 bg-line-strong" />
                    <StatusIcon status={t.status} />
                    <span className="text-ink">{t.title}</span>
                    <span className="ml-auto truncate pl-3 text-mute">{t.standing}</span>
                  </Link>
                ))}
              </details>
            ) : (
              <div key={e.applicationId} className={`${COLS} anim-rise h-12 w-full pr-5 pl-5 transition-colors hover:bg-hover ${wash} relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-ink`}>
                {row}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
