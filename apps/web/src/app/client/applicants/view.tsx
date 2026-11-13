import Link from "next/link";
import { FlashToast } from "@/components/flash-toast";
import { ListReader, Notice, PageBar, Pill, textLink } from "@/components/page";
import { KeyList } from "@/components/keys";
import { Marked } from "@/components/marked";
import type { ReaderAnswer } from "@/lib/client/applicant-queue";
import type { ViewerFile } from "@/lib/client/file-view-rules";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileViewer } from "../files/viewer";
import { addApplicantAction } from "./actions";
import { ControlPanel } from "./control-panel";
import { IntakeButton, type IntakeProps } from "./intake-composer";
import { INTAKE_ERRORS } from "./messages";
import type { Reply } from "./reply-box";
import type { Routing } from "./routing-bar";

// New Applicants' markup, props only (page.tsx does the reads): the queue
// grouped by team on the left (a fixed 340px list of Testbench's list rows under
// group bands), the open application as one white page on the right, and
// design/tats's control panel under it (control-panel.tsx). J/K walk the
// tickets (components/keys.tsx). Everything an applicant typed is rendered as
// text; React escapes it, and only an http(s) URL becomes a link
// (applicant-queue.ts's safeHref). "Add applicant" sits in the title row, a
// raised button beside the count, so the ticket's black button stays the one
// primary on the page; it opens the intake composer (intake-composer.tsx).

export type TicketRow = {
  applicationId: string;
  href: string;
  name: string;
  /**
   * design/tats's `.m-src`: "Referral · Sam". The tag shows its first word; the sentence is its title.
   * Someone added by hand gets "Added" the same way, who added them in its title.
   */
  tag: { text: string; title: string } | null;
  line: string;
  when: string;
  active: boolean;
};
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
  referral: boolean;
  /** Added by hand by someone on the team (source `sourced`): no form, and the team's words are its note. */
  added: boolean;
  /** Where they came from, in words. */
  source: string;
  /** The team's notes: those on their file, and a referral's on the application. */
  notes: string[];
  /** Their file's resumes and attachments, read in the viewer under the application (files/viewer.tsx). */
  files: ViewerFile[];
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
    // Edge to edge in the list's pane: the bands and hairlines run across it, as Testbench's ticket list.
    <KeyList title="New Applicants" next="Next applicant" mode="select" className="-mx-2 -mt-2 grid content-start" data-tour="tickets">
      {groups.length === 0 ? <p className="m-0 px-5 pt-4 text-[13px] text-faint">No new applicants.</p> : null}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="grid">
          <h2 className="m-0 flex h-10 min-w-0 items-center gap-2.5 border-b border-[color:var(--line)] bg-[color:var(--band)] px-5 font-mono text-[13px] font-medium">
            <span title={g.title} className="truncate">
              {g.title}
            </span>
            <span className="font-normal text-faint tabular-nums">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => (
            <Link
              key={r.applicationId}
              href={r.href}
              data-key-item
              aria-current={r.active ? "true" : undefined}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-[color:var(--line)] px-5 py-3 transition-colors focus-visible:outline-none",
                r.active ? "bg-[color:var(--sel)] shadow-[inset_2px_0_0_var(--ink)]" : "hover:bg-[color:var(--surface)] focus-visible:bg-[color:var(--sel)] focus-visible:shadow-[inset_2px_0_0_var(--ink)]",
              )}
            >
              <b className="truncate font-medium">{r.name}</b>
              <span className="text-right text-[12px] whitespace-nowrap text-faint tabular-nums">{r.when}</span>
              <span className="col-span-2 flex min-w-0 items-center gap-2 text-[12px] text-faint">
                {/* The tag says it's a referral; who referred them is its hover, and the application's Source. */}
                {r.tag ? (
                  <Pill title={r.tag.title} className="h-5 flex-none px-1.5 text-[11.5px]">
                    {r.tag.text.split(" · ")[0]}
                  </Pill>
                ) : null}
                <span className="truncate">{r.line}</span>
              </span>
            </Link>
          ))}
        </section>
      ))}
    </KeyList>
  );
}

/**
 * The application as one white page (design/tats's `.pg`), the same in both
 * themes, like a document: the name and what they wrote in Mona Sans, the
 * fields and links in Geist Mono, on the light --n scale, which dark mode keeps.
 */
function Paper({ ticket }: { ticket: Ticket }) {
  // sourceWords says "Job board · <the posting they came through>", and someone added by hand "Added by <who> · <the
  // detail they gave>": two facts, so two fields, never a dot between them.
  const [source, ...posting] = ticket.source.split(" · ");
  const fields: [string, React.ReactNode][] = [
    [
      "Job",
      <Link key="job" href={ticket.jobHref} className="text-[color:var(--n900)] underline decoration-[color:var(--n300)] underline-offset-[3px] hover:decoration-[color:var(--n900)]">
        {ticket.jobTitle}
      </Link>,
    ],
    [ticket.referral ? "Referred" : ticket.added ? "Added" : "Applied", ticket.applied],
    ["Source", source],
    ...(posting.length ? [[ticket.added ? "Detail" : "Posting", posting.join(" ")] as [string, React.ReactNode]] : []),
  ];
  const h2 = "m-0 mt-7 mb-1.5 font-sans text-[13.5px] leading-5 font-semibold text-[color:var(--n900)]";
  const link = "font-mono text-[12.5px] break-all text-[color:var(--n900)] underline decoration-[color:var(--n300)] underline-offset-[3px] hover:decoration-[color:var(--n900)]";
  return (
    <article className="relative mx-auto w-[680px] max-w-full rounded-[6px] bg-[color:var(--n0)] px-[26px] pt-8 pb-9 font-sans text-[14px] leading-[22px] text-[color:var(--n900)] [color-scheme:light] shadow-[0_0_0_1px_oklch(var(--ink-a)/0.08),0_1px_2px_oklch(var(--ink-a)/0.05),0_12px_32px_-12px_oklch(var(--ink-a)/0.18)] md:min-h-[828px] md:px-14 md:pt-[52px] md:pb-12">
      <header className="mb-5 border-b border-[color:var(--n150)] pb-4">
        <h1 className="m-0 font-sans text-[26px] leading-[32px] font-semibold tracking-[-0.02em] break-words">{ticket.name}</h1>
        <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 font-mono text-[12.5px] leading-5 text-[color:var(--n700)]">
          {ticket.email ? <span className="max-w-full min-w-0 select-all [overflow-wrap:anywhere]">{ticket.email}</span> : null}
          {ticket.phone ? <span>{ticket.phone}</span> : null}
        </p>
      </header>
      <dl className="m-0 grid font-mono text-[12.5px] leading-5">
        {fields.map(([k, v]) => (
          <div key={k} className="grid gap-0 py-1 md:grid-cols-[140px_minmax(0,1fr)] md:gap-3">
            <dt className="text-[color:var(--n700)]">{k}</dt>
            <dd className="m-0 min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {ticket.answers.length === 0 && !ticket.referral && !ticket.added ? <p className="m-0 mt-7 text-[color:var(--n700)]">No other answers.</p> : null}
      {ticket.answers.map((a) => (
        <section key={a.questionId}>
          <h2 className={h2}>
            <Marked text={a.label} />
          </h2>
          {a.href ? (
            <a href={a.href} target="_blank" rel="noopener noreferrer nofollow" className={link}>
              {a.value}
            </a>
          ) : (
            <p className="m-0 break-words whitespace-pre-wrap">{a.value}</p>
          )}
        </section>
      ))}
      {ticket.notes.length > 0 ? (
        <section>
          <h2 className={h2}>Notes</h2>
          {ticket.notes.map((n, i) => (
            <p key={i} className="m-0 mb-2 break-words whitespace-pre-wrap">
              {n}
            </p>
          ))}
        </section>
      ) : null}
    </article>
  );
}

/**
 * The open ticket: the application, the pages they sent with it, then the
 * control panel, which sticks to the foot of whatever scrolls it. New
 * Applicants' reader and the Inbox's pop-up both draw it. `back` is the way to
 * the list on a phone, where the list and the reader take turns; the pop-up has
 * its own close.
 */
export function TicketReader({ ticket, flash, back = null }: { ticket: Ticket; flash: React.ReactNode; back?: string | null }) {
  return (
    <div className="flex min-h-full flex-col bg-[color:var(--soft)]">
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 p-3 md:px-8 md:pt-8 md:pb-12">
        {back ? (
          <Link href={back} className={cn(textLink, "md:hidden")}>
            ← All applicants
          </Link>
        ) : null}
        {flash ? <div className="mx-auto w-[680px] max-w-full">{flash}</div> : null}
        <Paper ticket={ticket} />
        {/* design/tats's ticket: the application, then the pages they sent with it */}
        {ticket.files.length > 0 ? (
          <div className="mx-auto w-[680px] max-w-full">
            <FileViewer key={ticket.applicationId} files={ticket.files} label={`${ticket.name}'s files`} />
          </div>
        ) : null}
      </div>
      {ticket.reply || ticket.routing ? <ControlPanel key={ticket.applicationId} routing={ticket.routing} reply={ticket.reply} team={ticket.team} /> : null}
    </div>
  );
}

export function ApplicantsView({
  total,
  intake = null,
  groups,
  ticket,
  notice,
  error,
  open,
  base = "/client/applicants",
  home = false,
}: {
  total: number;
  /** What "Add applicant" needs; null when the member may add people to no open job (or in Home's tab), and there is no button. */
  intake?: Omit<IntakeProps, "kind" | "action" | "errors"> | null;
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
  const flash = error ? <Notice tone="error">{error}</Notice> : notice ? <FlashToast text={notice} /> : null;
  return (
    <ListReader
      listLabel="New applicants"
      readerLabel="Application"
      open={open}
      narrowList
      flushReader
      // Testbench's title on the surface over the card, ticket open or not; in Home's tab, Home's own bar says where you are.
      bar={
        home ? undefined : (
          <PageBar title="New Applicants" count={total}>
            {intake ? <IntakeButton kind="applicant" label="Add applicant" variant="outline" action={addApplicantAction} errors={INTAKE_ERRORS} {...intake} /> : null}
          </PageBar>
        )
      }
      list={<TicketList groups={groups} />}
      reader={
        ticket ? (
          <TicketReader ticket={ticket} flash={flash} back={base} />
        ) : (
          <div className="mx-auto grid max-w-[760px] content-start gap-4">
            {flash}
            <div className="grid place-items-center gap-2 py-24 text-center">
              <h2 className="m-0 font-sans text-[18px] leading-6 font-semibold">No new applicants</h2>
              <p className="m-0 text-[13px] text-muted-foreground">Everyone who applied or was referred has been routed.</p>
              <Link href="/client/inbox" className={cn(buttonVariants({ variant: "outline" }), "mt-3")}>
                Back to Inbox
              </Link>
            </div>
          </div>
        )
      }
    />
  );
}
