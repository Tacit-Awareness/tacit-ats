import Link from "next/link";
import { Avatar, ListReader, Notice, PageBar, textLink } from "@/components/page";
import { KeyList } from "@/components/keys";
import type { ReaderAnswer } from "@/lib/client/applicant-queue";
import { cn } from "@/lib/utils";
import { ControlPanel } from "./control-panel";
import type { Reply } from "./reply-box";
import type { Routing } from "./routing-bar";

// Applicant Tickets' markup, props only (page.tsx does the reads): the queue
// grouped by team on the left (a fixed 340px list), the open application as
// one white page on the right, and design/tats's control panel under it
// (control-panel.tsx). J/K walk the tickets (components/keys.tsx). Everything an
// applicant typed is rendered as text; React escapes it, and only an http(s)
// URL becomes a link (applicant-queue.ts's safeHref).

export type TicketRow = { applicationId: string; href: string; name: string; line: string; when: string; active: boolean };
/** `title` is a team's path, or a job's title in an org with no departments. */
export type TicketGroup = { key: string; title: string; rows: TicketRow[] };

export type Ticket = {
  applicationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  jobHref: string;
  applied: string;
  post: string | null;
  /** The job's team, or null when the list isn't by team. */
  team: string | null;
  answers: ReaderAnswer[];
  /** Null when the member may not move people in this job. */
  routing: Routing | null;
  /** Null when the member may not email this candidate. */
  reply: Reply | null;
};

function TicketList({ groups }: { groups: TicketGroup[] }) {
  return (
    <KeyList title="Applicant Tickets" next="Next ticket" mode="select" className="grid content-start gap-0.5" data-tour="tickets">
      {groups.length === 0 ? <p className="m-0 px-3 pt-1 text-[13px] text-faint">No new applicants.</p> : null}
      {groups.map((g, i) => (
        <section key={g.key} aria-label={g.title} className="grid gap-0.5">
          <h2 className={cn("m-0 flex min-w-0 items-center gap-2 px-3 pb-1 text-[12.5px] font-normal text-muted-foreground", i === 0 ? "pt-1" : "pt-3")}>
            <b title={g.title} className="truncate font-medium text-foreground">
              {g.title}
            </b>
            <span className="text-faint tabular-nums">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => (
            <Link
              key={r.applicationId}
              href={r.href}
              data-key-item
              aria-current={r.active ? "true" : undefined}
              className={cn(
                "relative grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 p-3 transition-colors",
                r.active
                  ? "bg-[color:var(--sel)] before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-0.5 before:bg-[color:var(--accent)]"
                  : "hover:bg-[color:var(--hover)]",
              )}
            >
              <span className="row-span-2">
                <Avatar name={r.name} size="ticket" candidate />
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <b className="flex-1 truncate text-[14px] font-medium">{r.name}</b>
                <span className="flex-none text-xs text-faint">{r.when}</span>
              </span>
              <span className="truncate text-[13px] text-muted-foreground">{r.line}</span>
            </Link>
          ))}
        </section>
      ))}
    </KeyList>
  );
}

/** The application as one white page (design/tats's `.pg`), the same in both themes, like a document. */
function Paper({ ticket }: { ticket: Ticket }) {
  const source = ticket.post ? `Job board · ${ticket.post}` : "Job board";
  const h2 = "m-0 mt-5 mb-2 text-[11.5px] font-semibold tracking-[0.02em] text-[color:var(--n800)]";
  return (
    <article className="relative mx-auto w-[640px] max-w-full bg-[color:var(--n0)] px-[26px] pt-8 pb-9 text-[12.5px] leading-[1.6] text-[color:var(--n900)] [color-scheme:light] shadow-[0_1px_3px_oklch(var(--ink-a)/0.08),0_8px_24px_-12px_oklch(var(--ink-a)/0.16)] md:min-h-[828px] md:px-14 md:pt-[52px] md:pb-10">
      <header className="mb-[18px] border-b border-[color:var(--n150)] pb-3.5">
        <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words">{ticket.name}</h1>
        <p className="m-0 mt-1 flex flex-wrap gap-x-3 text-[12px] text-[color:var(--n700)]">
          {ticket.email ? <span className="select-all">{ticket.email}</span> : null}
          {ticket.phone ? <span>{ticket.phone}</span> : null}
        </p>
      </header>
      <dl className="m-0 grid">
        {(
          [
            [
              "Job",
              <Link key="job" href={ticket.jobHref} className="text-[color:var(--n900)] underline decoration-[color:var(--n300)] underline-offset-2 hover:decoration-[color:var(--n900)]">
                {ticket.jobTitle}
              </Link>,
            ],
            ["Applied", ticket.applied],
            ["Source", source],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="grid gap-0 py-[3px] md:grid-cols-[150px_minmax(0,1fr)] md:gap-3">
            <dt className="font-semibold">{k}</dt>
            <dd className="m-0 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {ticket.answers.length === 0 ? <p className="m-0 mt-5 text-[color:var(--n700)]">No other answers.</p> : null}
      {ticket.answers.map((a) => (
        <section key={a.questionId}>
          <h2 className={h2}>{a.label}</h2>
          {a.href ? (
            <a href={a.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-[color:var(--n900)] underline decoration-[color:var(--n300)] underline-offset-2 hover:decoration-[color:var(--n900)]">
              {a.value}
            </a>
          ) : (
            <p className="m-0 break-words whitespace-pre-wrap">{a.value}</p>
          )}
        </section>
      ))}
    </article>
  );
}

export function ApplicantsView({
  total,
  groups,
  ticket,
  notice,
  error,
  open,
  base = "/client/applicants",
  home = false,
}: {
  total: number;
  groups: TicketGroup[];
  ticket: Ticket | null;
  notice: string | null;
  error: string | null;
  open: boolean;
  /** Where its links go: its own route, or Home's tab. */
  base?: string;
  /** Inside Home's tab, whose bar says where you are. */
  home?: boolean;
}) {
  const flash = error ? <Notice tone="error">{error}</Notice> : notice ? <Notice>{notice}</Notice> : null;
  return (
    <ListReader
      listLabel="New applicants"
      readerLabel="Application"
      open={open}
      narrowList
      flushReader
      // design/tats shows no bar while a ticket is open; the empty queue gets one, so the page still says where you are.
      bar={ticket || home ? undefined : <PageBar title="Applicant Tickets" count={total} />}
      list={<TicketList groups={groups} />}
      reader={
        ticket ? (
          <div className="flex min-h-full flex-col bg-[color:var(--soft)]">
            <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 p-3 md:px-6 md:pt-5 md:pb-10">
              <Link href={base} className={cn(textLink, "md:hidden")}>
                ← All applicants
              </Link>
              {flash ? <div className="mx-auto w-[640px] max-w-full">{flash}</div> : null}
              <Paper ticket={ticket} />
            </div>
            {ticket.reply || ticket.routing ? <ControlPanel key={ticket.applicationId} routing={ticket.routing} reply={ticket.reply} team={ticket.team} /> : null}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[760px] content-start gap-4">
            {flash}
            <div className="grid place-items-center gap-1 py-24 text-center">
              <h2 className="m-0 text-[15px] font-medium">No new applicants</h2>
              <p className="m-0 text-[13px] text-muted-foreground">Everyone who applied through a job post has been routed.</p>
            </div>
          </div>
        )
      }
    />
  );
}
