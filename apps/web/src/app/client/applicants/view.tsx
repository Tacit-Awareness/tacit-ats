import Link from "next/link";
import { Avatar, Count, KeyValues, ListReader, MiniTitle, Notice, textLink } from "@/components/page";
import { Button } from "@/components/ui/button";
import { selectClass } from "@/components/ui/input";
import type { ReaderAnswer } from "@/lib/client/applicant-queue";
import type { RejectReason } from "@/lib/client/applicants";
import { cn } from "@/lib/utils";
import { routeApplicantAction } from "./actions";

// Applicant Tickets' markup, props only (page.tsx does the reads): the queue
// grouped by job on the left, the open application as one document on the
// right, and design/tats's composer under it as the routing bar. Everything
// an applicant typed is rendered as text; React escapes it, and only an
// http(s) URL becomes a link (applicant-queue.ts's safeHref).

export type TicketRow = { applicationId: string; href: string; name: string; line: string; when: string; active: boolean };
export type TicketGroup = { jobId: string; jobTitle: string; rows: TicketRow[] };

export type Ticket = {
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  jobHref: string;
  applied: string;
  post: string | null;
  answers: ReaderAnswer[];
  /** Null when the member may not move people in this job. */
  routing: { applicationId: string; next: string | null; reasons: RejectReason[] } | null;
};

function TicketList({ total, groups }: { total: number; groups: TicketGroup[] }) {
  return (
    <div className="grid gap-3">
      <h1 className="m-0 flex items-center gap-2 px-2 pt-1.5 text-[15px] font-semibold">
        Applicant Tickets <Count>{total}</Count>
      </h1>
      {groups.length === 0 ? <p className="m-0 px-2 text-[13px] text-faint">No new applicants.</p> : null}
      {groups.map((g) => (
        <section key={g.jobId} aria-label={g.jobTitle} className="grid gap-0.5">
          <h2 className="m-0 flex items-center gap-2 rounded-md bg-[color:var(--band)] px-2 py-1 text-[12.5px] font-medium">
            <span className="truncate">{g.jobTitle}</span>
            <Count>{g.rows.length}</Count>
          </h2>
          {g.rows.map((r) => (
            <Link
              key={r.applicationId}
              href={r.href}
              aria-current={r.active ? "true" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors",
                r.active ? "bg-[color:var(--sel)]" : "hover:bg-[color:var(--hover)]",
              )}
            >
              <Avatar name={r.name} size="md" />
              <span className="grid min-w-0 flex-1">
                <b className="truncate text-[13px] font-medium">{r.name}</b>
                <span className="truncate text-xs text-muted-foreground">{r.line}</span>
              </span>
              <span className="flex-none text-xs text-faint">{r.when}</span>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

function RoutingBar({ routing }: { routing: NonNullable<Ticket["routing"]> }) {
  return (
    <form
      action={routeApplicantAction}
      className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-2 rounded-[12px] border border-[color:var(--line)] bg-card p-2.5 shadow-[var(--shadow)]"
    >
      <input type="hidden" name="applicationId" value={routing.applicationId} />
      {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
      <Button type="submit" name="route" value="interview">
        Interview
      </Button>
      <Button type="submit" name="route" value="screening" variant="outline">
        Move to screening
      </Button>
      <span className="ml-auto flex min-w-0 items-center gap-2">
        <label htmlFor="reasonId" className="sr-only">
          Rejection reason
        </label>
        <select id="reasonId" name="reasonId" defaultValue="" className={cn(selectClass, "w-[200px]")}>
          <option value="">Rejection reason…</option>
          {routing.reasons.map((r) => (
            <option key={r.reasonId} value={r.reasonId}>
              {r.name}
            </option>
          ))}
        </select>
        <Button type="submit" name="route" value="decline" variant="outline">
          Decline
        </Button>
      </span>
    </form>
  );
}

function Reader({ ticket }: { ticket: Ticket }) {
  const source = ticket.post ? `Job board · ${ticket.post}` : "Job board";
  return (
    <article className="grid content-start gap-5">
      <Link href="/client/applicants" className={cn(textLink, "md:hidden")}>
        ← All applicants
      </Link>
      <header className="flex items-center gap-3.5">
        <Avatar name={ticket.name} size="xl" />
        <div className="grid min-w-0 gap-0.5">
          <h2 className="m-0 truncate text-xl font-semibold tracking-[-0.02em]">{ticket.name}</h2>
          <p className="m-0 flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
            {ticket.email ? <span className="select-all">{ticket.email}</span> : null}
            {ticket.phone ? <span>{ticket.phone}</span> : null}
          </p>
        </div>
      </header>

      <KeyValues
        items={[
          [
            "Job",
            <Link key="job" href={ticket.jobHref} className={textLink}>
              {ticket.jobTitle}
            </Link>,
          ],
          ["Applied", ticket.applied],
          ["Source", source],
        ]}
      />

      <section aria-label="Application" className="grid gap-4 border-t border-[color:var(--line)] pt-5">
        {ticket.answers.length === 0 ? <p className="m-0 text-[13px] text-faint">No other answers.</p> : null}
        {ticket.answers.map((a) => (
          <div key={a.questionId} className="grid gap-1">
            <MiniTitle className="mt-0">{a.label}</MiniTitle>
            {a.href ? (
              <a href={a.href} target="_blank" rel="noopener noreferrer nofollow" className="text-[13.5px] break-all text-[color:var(--accent)] hover:underline">
                {a.value}
              </a>
            ) : (
              <p className="m-0 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">{a.value}</p>
            )}
          </div>
        ))}
      </section>

      {ticket.routing ? <RoutingBar routing={ticket.routing} /> : null}
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
}: {
  total: number;
  groups: TicketGroup[];
  ticket: Ticket | null;
  notice: string | null;
  error: string | null;
  open: boolean;
}) {
  return (
    <ListReader
      listLabel="New applicants"
      readerLabel="Application"
      open={open}
      list={<TicketList total={total} groups={groups} />}
      reader={
        <div className="mx-auto grid max-w-[760px] content-start gap-4">
          {error ? <Notice tone="error">{error}</Notice> : notice ? <Notice>{notice}</Notice> : null}
          {ticket ? (
            <Reader ticket={ticket} />
          ) : (
            <div className="grid place-items-center gap-1 py-24 text-center">
              <h2 className="m-0 text-[15px] font-semibold">No new applicants</h2>
              <p className="m-0 text-[13px] text-muted-foreground">Everyone who applied through a job post has been routed.</p>
            </div>
          )}
        </div>
      }
    />
  );
}
