import Link from "next/link";
import { ChevronDown, CircleUser, Ticket as TicketIcon, X } from "lucide-react";
import { clientTools } from "@tacit-ats/core";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { Avatar } from "@/components/tickets/avatar";
import { Blocks, type Block } from "@/components/tickets/blocks";
import { Header } from "@/components/tickets/header";
import { StatusIcon } from "@/components/tickets/status-icon";
import { label } from "@/components/tickets/styles";
import { TONE_COLOR, worst } from "@/components/tickets/tone";
import { COMMAND_LABEL, NOT_BOOKED, STATUS_LABEL, TASK_STATUSES, age, commandsFor, isOpenStatus, roundOf, roundOrder } from "@/lib/client/bot-task-rules";
import { readTickets, type Ticket } from "@/lib/client/bot-tasks";
import { departmentScope, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { liveTone } from "@/lib/client/home-tickets-rules";
import { readPipeline } from "@/lib/client/pipeline";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { ticketCommandAction } from "./actions";
import { TICKET_ERRORS, TICKET_NOTICES, isTicketError, isTicketNotice } from "./messages";

// Tickets (design/tacit-tickets's Tickets): the record of the work, the company
// bot's tasks (`bot_tasks`, lib/client/bot-tasks.ts) grouped by where they stand,
// under the interview rounds as blocks. All on the member's own token.
// - "N interviewing now": everyone in interviews on the Pipeline's read
//   (lib/client/pipeline.ts), a block per round (bot-task-rules.ts's roundOf: the
//   next booked interview's step, else the last held, else not booked), in the
//   company's process order where the names match. Picking one (`?round=`)
//   narrows the list to its people.
// - Approvals first: what waits on the member's sign-off (core's
//   listMyApprovals), each opening in Triage with the Inbox's own controls.
// - Then each status, folding; Active (open tasks) or All (`?all=1`).
// - A ticket (`?t=`) opens its panel: the bot's steps, and Retry, Nudge or
//   Cancel (tickets/actions.ts, `bot_task_command`).
// - `?department=`: a team's tickets, by the job's department.
// Left out: Edit Rounds (the interview process is Onboarding's), the
// interviewers asked under a ticket and the draft on a task (tATS keeps
// neither), Send Invite (no draft to send).

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ClientTickets({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Tickets" />}>
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
  const nowMs = now.getTime();
  const ctx: clientTools.ClientToolCtx = { actorId, orgId: org.id, accessLevel, source: "claude" };
  const [{ tickets, capped }, pipeline, approvals, structure] = await Promise.all([
    readTickets(db),
    readPipeline(db, now, ctx),
    clientTools.listMyApprovals(db, ctx).catch((err: unknown) => {
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return [];
      throw err;
    }),
    readDepartments(db),
  ]);

  const scope = departmentScope(structure, one(sp.department));
  const team = scope.departmentId ? (scope.options.find((o) => o.id === scope.departmentId)?.name ?? null) : null;
  const all = one(sp.all) === "1";
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (scope.departmentId) p.set("department", scope.departmentId);
    if (all) p.set("all", "1");
    if (one(sp.round)) p.set("round", one(sp.round));
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    return q ? `/client/tickets?${q}` : "/client/tickets";
  };

  // The rounds: everyone in interviews, in the team's jobs.
  const waiting = new Set(approvals.flatMap((a) => (a.kind === "offer" && a.applicationId ? [a.applicationId] : [])));
  const interviewing = pipeline.entries
    .filter((e) => e.stage === "interviewing" && inScope(scope, e.roleId))
    .map((e) => ({ e, round: roundOf(e.interviews, nowMs), tone: liveTone({ column: e.column, stalled: e.stalled, waitingOnMe: waiting.has(e.applicationId) }) }));
  const rounds = roundOrder(
    interviewing.map((x) => x.round),
    pipeline.stages?.map((s) => s.name) ?? null,
  );
  const blocks: Block[] = rounds.map((r) => {
    const here = interviewing.filter((x) => x.round === r);
    const tone = worst(here.map((x) => x.tone));
    return {
      key: r,
      name: r,
      tone: tone ? TONE_COLOR[tone] : undefined,
      dots: here.map((x) => ({ id: x.e.applicationId, name: x.e.personName, sub: x.e.roleTitle, note: x.e.nextAction ?? undefined, tone: TONE_COLOR[x.tone], href: `/client/candidates/${x.e.personId}` })),
    };
  });
  const round = rounds.includes(one(sp.round)) ? one(sp.round) : null;
  const onRound = round ? new Set(interviewing.filter((x) => x.round === round).map((x) => x.e.applicationId)) : null;

  const shown = tickets
    .filter((t) => (all ? true : isOpenStatus(t.status)))
    .filter((t) => !t.jobId || inScope(scope, t.jobId))
    .filter((t) => (scope.jobIds ? !!t.jobId : true))
    .filter((t) => !onRound || (t.applicationId !== null && onRound.has(t.applicationId)));
  const asks = approvals.filter((a) => !scope.jobIds || scope.jobIds.has(a.jobId));
  const open = shown.find((t) => t.id === one(sp.t)) ?? null;

  const notice = one(sp.notice);
  const error = one(sp.error);

  const list = (
    <div className="@container flex h-full min-w-0 flex-1 flex-col">
      <Header scope={team} title="Tickets" tabs={[{ label: "Active", href: qs({ all: null, t: null }), on: !all }, { label: "All", href: qs({ all: "1", t: null }), on: all }]} />
      <div className="scroll-quiet flex-1 overflow-y-auto">
        <Blocks title={`${interviewing.length} interviewing now`} blocks={blocks} param="round" />
        {isTicketError(error) && <div className="px-5 pt-3"><Notice tone="error">{TICKET_ERRORS[error]}</Notice></div>}
        {asks.length > 0 && !round && (
          <details open className="group/s">
            <summary className="sticky top-0 z-10 flex h-9 cursor-default list-none items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 [&::-webkit-details-marker]:hidden">
              <StatusIcon status="needs" label="Waiting on your sign-off" />
              <span className="font-medium text-ink">Approvals</span>
              <span className="text-dim tabular-nums">{asks.length}</span>
              <ChevronDown size={13} className="text-dim transition-transform group-[:not([open])]/s:-rotate-90" />
            </summary>
            {asks.map((a) => (
              <Link key={a.requestId} href={`/client/triage?i=appr-${a.requestId}`} className="wash-needs flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors hover:bg-hover">
                <StatusIcon status="needs" label="Waiting on your sign-off" />
                <span className="shrink-0 font-medium text-ink">{a.candidateName ?? a.jobTitle}</span>
                <span className="truncate text-mute">{a.kind === "offer" ? "Offer To Sign Off" : "Job To Approve"}</span>
                <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                  <span className="hidden w-[150px] truncate text-right text-dim @3xl:inline">{a.jobTitle}</span>
                  {a.requestedBy ? <Avatar name={a.requestedBy} /> : <span className="w-5" />}
                  <span className="w-7 text-right text-dim tabular-nums">{age(a.requestedAt, nowMs)}</span>
                </span>
              </Link>
            ))}
          </details>
        )}
        {TASK_STATUSES.map((s) => {
          const rows = shown.filter((t) => t.status === s);
          if (!rows.length) return null;
          return (
            <details key={s} open className="group/s">
              <summary className="sticky top-0 z-10 flex h-9 cursor-default list-none items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 [&::-webkit-details-marker]:hidden">
                <StatusIcon status={s} />
                <span className="font-medium text-ink">{STATUS_LABEL[s]}</span>
                <span className="text-dim tabular-nums">{rows.length}</span>
                <ChevronDown size={13} className="text-dim transition-transform group-[:not([open])]/s:-rotate-90" />
              </summary>
              {rows.map((t) => (
                <Link
                  key={t.id}
                  href={qs({ t: t.id })}
                  scroll={false}
                  aria-current={open?.id === t.id ? "true" : undefined}
                  className={`flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors ${isOpenStatus(s) ? `wash-${s}` : ""} ${open?.id === t.id ? "bg-sel" : "hover:bg-hover"}`}
                >
                  <StatusIcon status={s} />
                  <span className="shrink-0 font-medium text-ink">{t.name}</span>
                  <span className="truncate text-mute">{t.title}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                    <span className="hidden max-w-[220px] truncate text-mute @xl:inline">{t.standing}</span>
                    <span className="hidden w-[150px] truncate text-right text-dim @3xl:inline">{t.jobTitle}</span>
                    {t.ownerName ? <Avatar name={t.ownerName} /> : <span className="w-5" />}
                    <span className="w-7 text-right text-dim tabular-nums">{age(t.updatedAt, nowMs)}</span>
                  </span>
                </Link>
              ))}
            </details>
          );
        })}
        {!shown.length && !(asks.length && !round) && (
          <div className="flex min-h-[240px] flex-col items-center justify-center px-8 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
              <TicketIcon size={18} />
            </span>
            <div className="mt-4 font-medium text-ink">{round ? `No tickets on ${round === NOT_BOOKED ? "people not booked yet" : round}` : "No tickets"}</div>
            <p className="mt-1.5 max-w-[320px] text-mute">A ticket appears for each step your company&apos;s bot is working on for a candidate. What needs you is in Triage.</p>
          </div>
        )}
        {capped && <p className="px-5 py-3 text-xs text-dim">Showing the newest 500 tasks.</p>}
      </div>
    </div>
  );

  return (
    <>
      {isTicketNotice(notice) ? <FlashToast text={TICKET_NOTICES[notice]} /> : null}
      <div className="list-reader flex min-h-0 min-w-0 flex-1">
        {list}
        {open && <TicketPanel ticket={open} close={qs({ t: null })} nowMs={nowMs} />}
      </div>
    </>
  );
}

function TicketPanel({ ticket: t, close, nowMs }: { ticket: Ticket; close: string; nowMs: number }) {
  const commands = commandsFor(t.rawStatus);
  const why = t.rawStatus === "failed" ? (t.error ?? "The task failed") : t.waitingOn ? `No reply from ${t.waitingOn} in ${age(t.updatedAt, nowMs)}` : "Needs a look";
  return (
    <aside className="anim-rise flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-line max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(420px,calc(100vw-16px))] max-lg:bg-panel max-lg:shadow-2xl">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-5">
        {t.personId ? (
          <Link href={`/client/candidates/${t.personId}`} className="truncate rounded text-mute transition-colors hover:text-ink">
            {t.name}
          </Link>
        ) : (
          <span className="truncate text-mute">{t.name}</span>
        )}
        <span className="text-dim">/</span>
        <span className="truncate text-ink">{t.title}</span>
        <Link href={close} scroll={false} aria-label="Close" title="Close" className="ml-auto flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink">
          <X size={15} />
        </Link>
      </header>

      <div className="scroll-quiet flex-1 overflow-y-auto px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{t.title}</h2>
          {t.personId && (
            <Link href={`/client/candidates/${t.personId}`} className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-body transition-colors hover:bg-sel hover:text-ink">
              <CircleUser size={14} className="text-mute" /> Profile
            </Link>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong px-2 text-xs text-body">
            <StatusIcon status={t.status} size={12} /> {STATUS_LABEL[t.status]}
          </span>
          {t.jobTitle && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 text-xs whitespace-nowrap text-mute">{t.jobTitle}</span>}
          {t.waitingOn && t.rawStatus === "waiting" && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 text-xs whitespace-nowrap text-mute">{t.standing}</span>}
        </div>

        <div className={`${label} mt-7`}>Your Bot</div>
        {t.steps.length ? (
          <ol className="relative flex flex-col gap-2.5">
            <span className="absolute top-2 bottom-2 left-[3px] w-px bg-line-strong" aria-hidden="true" />
            {t.steps.map((s, i) => (
              <li key={i} className="anim-rise relative flex items-baseline gap-3 pl-[18px]">
                <span className={`absolute top-[7px] left-0 size-[7px] rounded-full ring-4 ring-[color:var(--paper)] ${i === t.steps.length - 1 && isOpenStatus(t.status) ? "bg-ink" : "bg-dim"}`} />
                <span className={`min-w-0 flex-1 ${i === t.steps.length - 1 ? "text-ink" : "text-body"}`}>{s.label}</span>
                {s.at && <span className="shrink-0 text-xs text-dim tabular-nums">{age(s.at, nowMs)}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-mute">No steps reported yet.</p>
        )}
      </div>

      {commands.length > 0 && (
        <div className="anim-rise shrink-0 border-t border-line p-3">
          <div className={`rounded-lg border border-line-strong bg-sel p-3 ${t.status === "needs" || t.status === "failed" ? `wash-${t.status}` : ""}`}>
            {(t.status === "needs" || t.status === "failed") && (
              <div className="mb-3 flex items-center gap-2 text-ink">
                <StatusIcon status={t.status} />
                <span className="font-medium">{why}</span>
              </div>
            )}
            <div className="flex gap-1.5">
              {commands.map((c, i) => (
                <form key={c} action={ticketCommandAction} className="flex flex-1">
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="command" value={c} />
                  <button
                    type="submit"
                    className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-md whitespace-nowrap transition ${i === 0 && c !== "cancel" ? "bg-ink font-medium text-well hover:opacity-90" : "border border-line-strong text-ink hover:bg-hover"}`}
                  >
                    {COMMAND_LABEL[c]}
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
