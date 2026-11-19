import Link from "next/link";
import { Calendar, ChevronDown, CircleUser, X } from "lucide-react";
import { clientTools } from "@tacit-ats/core";
import { Avatar } from "@/components/tickets/avatar";
import { Header } from "@/components/tickets/header";
import { StatusIcon, type Status } from "@/components/tickets/status-icon";
import { label } from "@/components/tickets/styles";
import { departmentScope, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { readFeedbackForm } from "@/lib/client/feedback";
import { canFile } from "@/lib/client/feedback-rules";
import { readInterview, readInterviews, type InterviewListItem, type Member } from "@/lib/client/interviews";
import { ago, until } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { FeedbackForm } from "../../interviews/feedback-form";
import { Refusal } from "../../refusal";
import { Week, type WeekItem } from "./week";

// Interviews (design/tacit-tickets's Interviews), under Tickets: what is booked,
// and the feedback owed on what is done. On the member's own token: the
// interviews they can see (lib/client/interviews.ts's readInterviews, as
// Interview Judgement reads them) and which of their own they have filed on
// (core's listMyInterviews). Three groups, folding: Needs Your Feedback (theirs,
// started, not filed), Upcoming, Done; or the Week (`?view=week`). An interview
// (`?i=`) opens its panel: the round, who is on it, the calls filed so far (the
// verdict only; the notes stay in Interview Judgement), and for one of their own
// the feedback form, Interview Judgement's own (interviews/feedback-form.tsx),
// which answers in place. A limited interviewer gets the same: their interviews.
// Left out: Schedule (find_interview_times and schedule_interview are the
// connector's; the page has no way to book yet), interviewers' weekly load.

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const REC: Record<string, string> = { strong_yes: "Strong Yes", yes: "Yes", no: "No", strong_no: "Strong No" };
const isPast = (i: InterviewListItem, now: number) => Date.parse(i.endsAt) <= now;
const when = (i: InterviewListItem, now: number) => (Date.parse(i.startsAt) <= now ? ago(i.startsAt, now) : until(i.startsAt, now));

export default async function ClientInterviewsList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  const member: Member = { actorId, orgId: org.id, accessLevel };
  const sp = await searchParams;
  const now = new Date();
  const nowMs = now.getTime();
  const asked = one(sp.i);
  const [items, mine, structure] = await Promise.all([
    readInterviews(db, member, now, asked),
    clientTools.listMyInterviews(db, toolCtx(gate.ctx), { when: "all" }, now),
    readDepartments(db),
  ]);
  const filed = new Map(mine.map((m) => [m.interviewId, m.feedbackFiled]));
  const scope = departmentScope(structure, one(sp.department));
  const team = scope.departmentId ? (scope.options.find((o) => o.id === scope.departmentId)?.name ?? null) : null;
  const week = one(sp.view) === "week";
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (scope.departmentId) p.set("department", scope.departmentId);
    if (week) p.set("view", "week");
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    return q ? `/client/tickets/interviews?${q}` : "/client/tickets/interviews";
  };

  const inTeam = items.filter((i) => inScope(scope, i.jobId));
  const owes = (i: InterviewListItem) => canFile(i, nowMs) && filed.get(i.interviewId) === false;
  const owed = inTeam.filter(owes).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const groups: [string, Status, string, InterviewListItem[]][] = [
    ["Needs Your Feedback", "needs", "Needs your feedback", owed],
    ["Upcoming", "waiting", "Upcoming, booked", inTeam.filter((i) => !isPast(i, nowMs) && !owes(i)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))],
    ["Done", "done", "Done", inTeam.filter((i) => isPast(i, nowMs) && !owes(i))],
  ];
  const open = inTeam.find((i) => i.interviewId === asked) ?? null;

  // The open one's calls and, for one of the member's own, their form.
  let calls: clientTools.FeedbackEntry[] = [];
  let form: Awaited<ReturnType<typeof readFeedbackForm>> | null = null;
  let unread = false;
  if (open) {
    try {
      const detail = await readInterview(db, member, open);
      calls = detail.feedback.feedback.filter((f) => f.interviewId === open.interviewId);
      if (canFile(open, nowMs)) form = await readFeedbackForm(db, toolCtx(gate.ctx), { interviewId: open.interviewId, jobId: open.jobId, mine: calls.find((f) => f.mine) ?? null });
    } catch (err) {
      if (!(err instanceof clientTools.ClientToolError)) throw err;
      unread = true;
    }
  }

  const weekItems: WeekItem[] = inTeam.map((i) => ({ id: i.interviewId, name: i.candidateName ?? "Candidate", step: i.step ?? "Interview", startsAt: i.startsAt, endsAt: i.endsAt, done: isPast(i, nowMs), href: href({ i: i.interviewId }), picked: open?.interviewId === i.interviewId }));

  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1">
      <div className="@container flex min-w-0 flex-1 flex-col">
        <Header scope={team} title="Interviews" tabs={[{ label: "List", href: href({ view: null }), on: !week }, { label: "Week", href: href({ view: "week" }), on: week }]} right={<Link href="/client/schedule" className="flex h-7 items-center rounded-md px-2.5 text-mute transition-colors hover:text-ink">Calendar</Link>} />
        {week ? (
          <Week items={weekItems} />
        ) : (
          <div className="scroll-quiet flex-1 overflow-y-auto">
            {groups.map(([name, status, says, rows]) =>
              rows.length ? (
                <details key={name} open className="group/s">
                  <summary className="sticky top-0 z-10 flex h-9 cursor-default list-none items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 [&::-webkit-details-marker]:hidden">
                    <StatusIcon status={status} label={says} />
                    <span className="font-medium text-ink">{name}</span>
                    <span className="text-dim tabular-nums">{rows.length}</span>
                    <ChevronDown size={13} className="text-dim transition-transform group-[:not([open])]/s:-rotate-90" />
                  </summary>
                  {rows.map((i) => (
                    <Link
                      key={i.interviewId}
                      href={href({ i: i.interviewId })}
                      scroll={false}
                      aria-current={open?.interviewId === i.interviewId ? "true" : undefined}
                      className={`flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors ${status === "needs" ? "wash-needs" : ""} ${open?.interviewId === i.interviewId ? "bg-sel" : "hover:bg-hover"}`}
                    >
                      <StatusIcon status={status} label={says} />
                      <span className="shrink-0 font-medium text-ink">{i.candidateName ?? "Candidate"}</span>
                      <span className="truncate text-mute">{i.step ?? "Interview"}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                        <span className="hidden text-dim @2xl:inline">{i.jobTitle}</span>
                        <span className="w-[104px] text-right text-mute">{when(i, nowMs)}</span>
                        <span className="flex w-[52px] justify-end -space-x-1">
                          {i.interviewers.slice(0, 3).map((m) => (
                            <span key={m} className="rounded-full ring-2 ring-[color:var(--paper)]">
                              <Avatar name={m} size={18} />
                            </span>
                          ))}
                        </span>
                      </span>
                    </Link>
                  ))}
                </details>
              ) : null,
            )}
            {!inTeam.length && (
              <div className="flex min-h-[240px] flex-col items-center justify-center px-8 py-10 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
                  <Calendar size={18} />
                </span>
                <div className="mt-4 font-medium text-ink">No interviews</div>
                <p className="mt-1.5 max-w-[320px] text-mute">Booked interviews show up here.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {open && (
        <aside className="anim-rise flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-line max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(420px,calc(100vw-16px))] max-lg:bg-panel max-lg:shadow-2xl">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-5">
            <span className="truncate text-mute">{open.candidateName ?? "Candidate"}</span>
            <span className="text-dim">/</span>
            <span className="truncate text-ink">{open.step ?? "Interview"}</span>
            <Link href={href({ i: null })} scroll={false} aria-label="Close" title="Close" className="ml-auto flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink">
              <X size={15} />
            </Link>
          </header>
          <div className="scroll-quiet flex-1 overflow-y-auto px-5 pt-6 pb-5">
            <div className="flex items-center gap-2.5">
              <h2 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{open.step ?? "Interview"}</h2>
              <Link href={`/client/interviews?i=${open.interviewId}`} className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-body transition-colors hover:bg-sel hover:text-ink" title="The whole loop, every read and the meeting notes">
                <CircleUser size={14} className="text-mute" /> Open Loop
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {[open.jobTitle, when(open, nowMs), open.status === "done" ? "Done" : isPast(open, nowMs) ? "Held" : "Booked"].filter(Boolean).map((c) => (
                <span key={c} className="inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 text-xs whitespace-nowrap text-mute">
                  {c}
                </span>
              ))}
            </div>

            <div className={`${label} mt-7`}>Interviewers</div>
            {open.interviewers.length ? (
              <div className="overflow-hidden rounded-lg border border-line-strong">
                {open.interviewers.map((n) => {
                  const call = calls.find((c) => c.interviewer === n);
                  return (
                    <div key={n} className="flex min-h-[44px] items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
                      <Avatar name={n} size={22} />
                      <span className="min-w-0 flex-1 truncate text-ink">{n}</span>
                      <span className={`shrink-0 ${call ? "font-medium text-ink" : "text-dim"}`}>{call ? REC[call.recommendation] ?? call.recommendation : isPast(open, nowMs) ? "Not filed" : "Booked"}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="m-0 text-mute">Nobody on it yet.</p>
            )}

            {unread ? (
              <p className="mt-7 text-mute">This interview is no longer there for you to read.</p>
            ) : form ? (
              <>
                <div className={`${label} mt-7`}>{form.filed ? "Your Feedback" : "Your Feedback, Owed"}</div>
                <FeedbackForm key={form.interviewId} form={form} candidate={open.candidateName ?? "the candidate"} />
              </>
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
}
