import Link from "next/link";
import { CircleUser, Inbox } from "lucide-react";
import { heading, label } from "@/components/tickets/styles";
import { StatusIcon } from "@/components/tickets/status-icon";
import type { QueueEntry } from "@/lib/client/applicant-queue";
import { DEFAULT_RANGE } from "@/lib/client/inbox-digest";
import type { Issue } from "@/lib/client/inbox-issues";
import { ago } from "@/lib/client/pipeline-columns";
import { issueName, issueStatus, undot, type Origin } from "@/lib/client/triage-rules";
import type { Ticket } from "../applicants/view";
import { IssueCard, Reader, Route, type IssueReaderProps } from "../inbox/view";
import { TriageComposer } from "./composer";
import { ResumePane } from "./resume";

// Triage's three panes (design/tacit-tickets's Triage), drawn from what
// page.tsx read on the member's own token: the queue, the picked one in the
// middle, what is known about them on the right. On a narrow screen the queue
// sits over the middle and the right pane goes.

export type TriageProps = {
  /** The team picked in the sidebar, by name. */
  team: string | null;
  needs: Issue[];
  groups: { key: Origin; label: string; entries: QueueEntry[] }[];
  need: Issue | null;
  applicant: QueueEntry | null;
  issue: IssueReaderProps | null;
  ticket: Ticket | null;
  flash: React.ReactNode;
  laterHref: string | null;
  hrefOf: (params: Record<string, string>) => string;
  queueFailed: boolean;
  nowMs: number;
};

export function TriageView({ team, needs, groups, need, applicant, issue, ticket, flash, laterHref, hrefOf: qs, queueFailed, nowMs }: TriageProps) {
  const order = groups.flatMap((g) => g.entries);
  const rowCls = (on: boolean) => `flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${on ? "bg-sel" : "hover:bg-hover"}`;

  const queuePane = (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-5">
        {team && (
          <>
            <span className="truncate text-mute">{team}</span>
            <span className="text-dim">/</span>
          </>
        )}
        <h1 className="mr-2 shrink-0 font-medium text-ink">Triage</h1>
        <Link href="/client/inbox?tab=done" className="ml-auto flex h-7 items-center rounded-md px-2.5 text-mute transition-colors hover:text-ink">
          Done
        </Link>
      </header>
      <nav aria-label="Triage" data-tour="triage" className="scroll-quiet flex-1 overflow-y-auto p-1.5">
        {needs.length > 0 && (
          <section className="mb-1.5">
            <div className="flex h-8 items-center gap-2 px-3 text-xs text-dim">
              Needs You <span className="tabular-nums">{needs.length}</span>
            </div>
            {needs.map((n) => (
              <Link key={n.key} href={qs({ i: n.key })} aria-current={need?.key === n.key ? "true" : undefined} className={`${rowCls(need?.key === n.key)} gap-2.5`}>
                <span className="pt-0.5">
                  <StatusIcon status={issueStatus(n)} label={n.what} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{issueName(n)}</span>
                  <span className="block truncate text-mute">{n.what}</span>
                </span>
              </Link>
            ))}
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mb-1.5">
            <div className="flex h-8 items-center gap-2 px-3 text-xs text-dim">
              {g.label} <span className="tabular-nums">{g.entries.length}</span>
            </div>
            {g.entries.map((e) => {
              const on = !need && applicant?.applicationId === e.applicationId;
              return (
                <Link key={e.applicationId} href={qs({ a: e.applicationId })} aria-current={on ? "true" : undefined} className={rowCls(on)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{e.name ?? "Unnamed applicant"}</span>
                    <span className="block truncate text-mute">
                      {e.jobTitle ?? "Untitled job"} <span className="ml-1.5 text-dim">{ago(e.appliedAt, nowMs)}</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>
        ))}
        {!needs.length && !order.length && <div className="px-3 py-3 text-dim">Nothing waiting on you</div>}
        {queueFailed && <div className="px-3 py-3 text-dim">New applicants couldn&apos;t be read just now.</div>}
      </nav>
    </div>
  );

  const middle = issue ? (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-5">
        <span className="truncate font-medium text-ink">{issue.ticket?.title ?? issue.what}</span>
        <span className="min-w-0 flex-1 truncate text-mute">{issue.ticket ? issue.what : undot(issue.subject.replace(/ /g, ", "))}</span>
        <Link href={`/client/inbox?i=${encodeURIComponent(issue.instance.key)}`} className="shrink-0 rounded text-mute underline decoration-dim underline-offset-2 transition-colors hover:text-ink" title="See it in the Inbox, with everything around it">
          Open In Inbox
        </Link>
      </div>
      <div key={issue.instance.key} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {issue.ticket ? (
          <>
            <Route loop={issue.ticket.loop} />
            {issue.ticket.body(
              <>
                {flash}
                <IssueCard issue={issue} range={DEFAULT_RANGE} />
              </>,
            )}
          </>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 px-4 pt-5 pb-10 md:px-6">
            {flash}
            <Reader issue={issue} range={DEFAULT_RANGE} />
          </div>
        )}
      </div>
    </div>
  ) : ticket ? (
    <div className="flex h-full min-w-0 flex-col">
      {flash && <div className="shrink-0 border-b border-line px-5 py-2">{flash}</div>}
      <div className="min-h-0 flex-1">
        <ResumePane name={ticket.name} files={ticket.files} />
      </div>
      <TriageComposer key={ticket.applicationId} name={ticket.name} routing={ticket.routing} reply={ticket.reply} team={ticket.team} laterHref={laterHref} />
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
        <Inbox size={18} />
      </span>
      <div className="mt-4 font-medium text-ink">Nothing in triage</div>
      <p className="mt-1.5 max-w-[280px] text-mute">When someone applies or is referred in, they land here for you to route.</p>
      <Link href="/client/pipeline" className="mt-4 flex h-7 items-center rounded-md border border-line-strong px-2.5 text-ink transition-colors hover:bg-hover">
        Go To Tickets
      </Link>
    </div>
  );

  const facts = (rows: [string, React.ReactNode][]) => (
    <dl className="flex flex-col gap-2.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <dt className="w-[68px] shrink-0 text-mute">{k}</dt>
          <dd className="min-w-0 truncate text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );

  const info = need ? (
    <div key={need.key} className="anim-rise px-5 py-5">
      {need.candidate ? (
        <Link href={`/client/candidates/${need.candidate.id}`} className={`${heading} block max-w-full truncate hover:underline`}>
          {need.candidate.name}
        </Link>
      ) : (
        <div className={`${heading} truncate`}>{issueName(need)}</div>
      )}
      <div className="truncate text-mute">{need.job.title}</div>
      <p className="mt-4 leading-[1.55] text-body">{need.why}.</p>
      <div className={`${label} mt-7`}>Details</div>
      {facts([
        ["Waiting", ago(need.since ?? need.at, nowMs)],
        ...(need.who ? ([["With", need.who]] as [string, string][]) : []),
        ...(need.nextAction ? ([["Next", need.nextAction]] as [string, string][]) : []),
      ])}
    </div>
  ) : ticket ? (
    <div key={ticket.applicationId} className="anim-rise px-5 py-5">
      <div className={`${heading} truncate`}>{ticket.name}</div>
      <div className="truncate text-mute">{ticket.jobTitle}</div>
      <div className={`${label} mt-7`}>Details</div>
      {facts([
        ["Applied", ticket.applied],
        ["Source", undot(ticket.source)],
        ["Role", <Link key="r" href={ticket.jobHref} className="hover:underline">{ticket.jobTitle}</Link>],
        ...(ticket.team ? ([["Team", ticket.team]] as [string, string][]) : []),
        ...(ticket.email ? ([["Email", ticket.email]] as [string, string][]) : []),
        ...(ticket.phone ? ([["Phone", ticket.phone]] as [string, string][]) : []),
      ])}
      {ticket.notes.length > 0 && (
        <>
          <div className={`${label} mt-7`}>{ticket.referral ? "Referral Note" : "Notes"}</div>
          <div className="flex flex-col gap-1.5">
            {ticket.notes.map((n, k) => (
              <p key={k} className="m-0 rounded-lg bg-hover px-3 py-2.5 leading-[1.5] whitespace-pre-wrap text-body">
                {n}
              </p>
            ))}
          </div>
        </>
      )}
      {ticket.answers.length > 0 && (
        <>
          <div className={`${label} mt-7`}>Answers</div>
          <dl className="flex flex-col gap-3.5 rounded-lg bg-hover px-3 py-2.5">
            {ticket.answers.map((x) => (
              <div key={x.questionId}>
                <dt className="text-mute">{x.label}</dt>
                <dd className="mt-0.5 leading-[1.5] break-words whitespace-pre-wrap text-ink">
                  {x.href ? (
                    <a href={x.href} target="_blank" rel="noreferrer noopener" className="underline decoration-dim underline-offset-2 hover:decoration-ink">
                      {x.value}
                    </a>
                  ) : (
                    x.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <div className={`${label} mt-7`}>
        Files <span className="tabular-nums">{ticket.files.length}</span>
      </div>
      {ticket.files.length ? (
        <div className="flex flex-col gap-1.5">
          {ticket.files.map((f) => (
            <a key={f.fileId} href={`/client/files/${f.fileId}`} className="flex h-8 items-center gap-2 rounded-lg bg-hover px-2.5 text-ink transition-colors hover:bg-sel">
              <span className="truncate">{f.filename}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="m-0 text-mute">None yet</p>
      )}
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
        <CircleUser size={18} />
      </span>
      <div className="mt-4 font-medium text-ink">No application open</div>
      <p className="mt-1.5 max-w-[220px] text-mute">The application behind the person you pick shows up here.</p>
    </div>
  );

  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1">
      <div className="grid min-h-0 w-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,40%)_minmax(0,1fr)] lg:grid-cols-[minmax(220px,22%)_minmax(380px,1fr)_minmax(260px,28%)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="min-h-0 border-b border-line lg:border-r lg:border-b-0">{queuePane}</div>
        <div className="min-h-0 min-w-0">{middle}</div>
        <aside aria-label="Details" className="scroll-quiet hidden min-h-0 overflow-y-auto border-l border-line lg:block">
          {info}
        </aside>
      </div>
    </div>
  );
}
