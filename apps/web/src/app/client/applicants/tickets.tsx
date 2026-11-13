import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { homeSubBase, hrefAt } from "@/lib/client/home-tabs";
import { groupByTeam, inOrder, isReferral, neighbour, readerAnswers, selected, referralTag, sourceWords } from "@/lib/client/applicant-queue";
import { readApplicantQueue, readApplicationNotes, readPersonNotes, readRouting } from "@/lib/client/applicants";
import type { QueueEntry, QueueGroup } from "@/lib/client/applicant-queue";
import { readDepartments } from "@/lib/client/departments";
import { viewerFiles } from "@/lib/client/file-view-rules";
import { readReply } from "@/lib/client/email";
import { templateStarters } from "@/lib/client/email-template-rules";
import { readTemplates } from "@/lib/client/email-templates";
import { webMailer } from "@/lib/client/mailer";
import { readAddedBy } from "@/lib/client/intake";
import { ago } from "@/lib/client/pipeline-columns";
import { referrerName } from "@/lib/client/referral-table";
import { RESUME_ACCEPT, readAddForm } from "@/lib/client/referrals";
import { replyStarters } from "@/lib/client/reply-starters";
import { resolveClient, type ClientContext } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { APPLICANT_ERRORS, APPLICANT_NOTICES, isApplicantError, isApplicantNotice } from "./messages";
import { ApplicantsView, type Ticket } from "./view";

// New Applicants (design/tats's #triage): new job-board applicants, referrals
// and the people the team added by hand, read like email. The list is core's
// listApplicationsInbox on the member's own token (lib/client/applicants.ts),
// grouped by team (by job in an org with no departments), newest first; `?a=`
// picks the one the reader shows. The control panel under it offers the next
// step only when can_on_role says the member may move people in that job, and
// the reply only when can_edit_person says they may email this candidate.
// "Add applicant" in the title row is the intake composer, offered when the
// member may add people to an open job (lib/client/referrals.ts's
// readAddForm); it starts on the open ticket's job, or its team's. The Inbox
// opens a new applicant's ticket in its pop-up with this file's readTicket and
// view.tsx's TicketReader, so it reads and routes there exactly as here.

const isAdded = (e: Pick<QueueEntry, "source">) => e.source === "sourced";

/** A referral with its referrer's name alone, so "Referred by …" is said once ("Referred by Sam Whitaker", not twice over). */
const named = (e: QueueEntry): QueueEntry => ({ ...e, referredBy: referrerName(e.referredBy) });

/** The ticket's Source: how a referral was recorded when that says more than a name ("Backchannel from Daniel"), else in words. */
const sourceOf = (e: QueueEntry): string => (isReferral(e) && e.referredBy && referrerName(e.referredBy) !== e.referredBy ? e.referredBy : sourceWords(named(e)));

/** The list's tag for someone added by hand, one word as a referral's is; who added them (and the detail) is its hover. */
const addedTag = (source: string) => ({ text: "Added", title: source.replace(" · ", ": ") });

/** Core's inbox entry carries the detail someone added by hand came with; the queue's type predates it, so it is read, not assumed. */
const detailOf = (e: QueueEntry): string | null => ("sourceDetail" in e && typeof e.sourceDetail === "string" ? e.sourceDetail : null);

/** Someone added by hand, in words: who added them, and the detail they gave, if any. */
function addedWords(e: QueueEntry, by: string | undefined): string {
  const who = by ? `Added by ${by}` : "Added by hand";
  const detail = detailOf(e);
  return detail ? `${who} · ${detail}` : who;
}

/** The team a ticket's routing bar names: its group's, when the list is by team. */
export function teamOf(groups: QueueGroup[], open: QueueEntry): string | null {
  const group = groups.find((g) => g.entries.includes(open));
  return group?.isTeam ? group.title : null;
}

/** Where a ticket is drawn: its team (null when the list isn't by team), who opens once it is routed, and which page a post comes back to. */
export type TicketPlace = { team: string | null; next: string | null; home?: boolean; inbox?: number };

/**
 * One applicant's ticket as the reader shows it: the application, their files,
 * and the routing bar and the reply when this member may use them. New
 * Applicants' reader and the Inbox's pop-up both draw it from here. `addedBy`
 * is a read already under way that covers them; left out, it is read here.
 */
export async function readTicket(ctx: ClientContext, open: QueueEntry, place: TicketPlace, now: number, addedBy?: Promise<Map<string, string>>): Promise<Ticket> {
  const { db, org, user } = ctx;
  const mailer = webMailer();
  const referral = isReferral(open);
  const added = isAdded(open);
  const [routing, reply, notes, personNotes, files, templates, by] = await Promise.all([
    readRouting(db, open.jobId),
    readReply(db, toolCtx(ctx), mailer, { candidateId: open.candidateId, applicationId: open.applicationId }),
    // A referral or someone added by hand has no form to read; what the team said is its note.
    referral || added ? readApplicationNotes(db, open.applicationId) : [],
    readPersonNotes(db, open.candidateId),
    clientTools.listFiles(db, toolCtx(ctx), { candidateId: open.candidateId }),
    readTemplates(db, toolCtx(ctx)),
    addedBy ?? (added ? readAddedBy(db, [open.applicationId]) : new Map<string, string>()),
  ]);
  const { phone, answers } = readerAnswers(open.answers, open.linkedinUrl);
  return {
    applicationId: open.applicationId,
    name: open.name ?? "Unnamed applicant",
    email: open.email,
    phone,
    jobTitle: open.jobTitle ?? "Untitled job",
    jobHref: `/client/jobs/${open.jobId}`,
    applied: ago(open.appliedAt, now),
    referral,
    added,
    source: added ? addedWords(open, by.get(open.applicationId)) : sourceOf(open),
    notes: [...notes, ...personNotes],
    files: viewerFiles(files, (iso) => ago(iso, now)),
    team: place.team,
    answers,
    routing: routing.canEdit
      ? { applicationId: open.applicationId, next: place.next, reasons: routing.reasons, home: place.home, inbox: place.inbox }
      : null,
    reply: reply.canEmail
      ? {
          applicationId: open.applicationId,
          candidateId: open.candidateId,
          to: reply.to,
          enabled: mailer !== null,
          draft: reply.draft,
          sender: reply.sender,
          failed: reply.failed,
          sent: reply.sent ? { when: ago(reply.sent.at, now), subject: reply.sent.subject, by: reply.sent.by } : null,
          starters: replyStarters({ candidateName: open.name, jobTitle: open.jobTitle, company: org.name, sender: user.name }),
          templates: templateStarters(templates, { candidateName: open.name, jobTitle: open.jobTitle, company: org.name, sender: user.name }),
          subjectMax: clientTools.EMAIL_SUBJECT_MAX,
          bodyMax: clientTools.EMAIL_BODY_MAX,
          home: place.home,
          inbox: place.inbox,
        }
      : null,
  };
}

/** The page, on its own route or inside Home's tab (`home`), where its links and its posts stay in the tab. */
export async function ApplicantsContent({ sp, home = false }: { sp: Record<string, string | string[] | undefined>; home?: boolean }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org, user } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="New Applicants" />}>
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

  const base = home ? homeSubBase("tickets") : "/client/applicants";
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const notice = one(sp.notice);
  const error = one(sp.error);

  const now = Date.now();
  const [queue, structure, intake] = await Promise.all([
    readApplicantQueue(db, { actorId, orgId: org.id, accessLevel }),
    readDepartments(db),
    // Only on its own route: Home's tab has no title row to put the button in.
    home ? null : readAddForm(db),
  ]);
  const groups = groupByTeam(queue, structure);
  const order = inOrder(groups);
  const open = selected(order, one(sp.a));
  // Who was added by whom, for the list's tags. Read with the open ticket, as it always was, and the ticket shares it.
  const addedByRead = open ? readAddedBy(db, order.filter(isAdded).map((e) => e.applicationId)) : Promise.resolve(new Map<string, string>());
  const [ticket, addedBy] = await Promise.all([
    open ? readTicket(gate.ctx, open, { team: teamOf(groups, open), next: neighbour(order, open.applicationId)?.applicationId ?? null, home }, now, addedByRead) : null,
    addedByRead,
  ]);

  // The job in view: the open ticket's, else one of its team's the member may add to.
  const addable = new Set(intake?.jobs.map((j) => j.jobId));
  const departmentOf = new Map(structure.jobs.map((j) => [j.jobId, j.departmentId]));
  const team = open ? departmentOf.get(open.jobId) : undefined;
  const preferJob = !open ? null : addable.has(open.jobId) ? open.jobId : (intake?.jobs.find((j) => team && departmentOf.get(j.jobId) === team)?.jobId ?? null);

  return (
    <>
      <MarkSeen mark="tickets" ids={order.map((e) => e.applicationId)} />
      <ApplicantsView
        total={order.length}
        intake={
          intake?.jobs.length
            ? {
                jobs: intake.jobs,
                preferJob,
                me: user.name ?? null,
                teammates: intake.teammates,
                resumeMaxBytes: clientTools.FILE_MAX_BYTES,
                resumeAccept: RESUME_ACCEPT,
              }
            : null
        }
        groups={groups.map((g) => ({
          key: g.key,
          title: g.title,
          rows: g.entries.map((e) => ({
            applicationId: e.applicationId,
            href: hrefAt(base, new URLSearchParams({ a: e.applicationId })),
            name: e.name ?? "Unnamed applicant",
            tag: isAdded(e) ? addedTag(addedWords(e, addedBy.get(e.applicationId))) : referralTag(named(e)),
            // Under a team the row has to name the job; under a job it says where they applied, or the tag does.
            line: g.isTeam ? (e.jobTitle ?? "Untitled job") : isReferral(e) || isAdded(e) ? (e.email ?? "") : (e.post ?? e.email ?? "Job board"),
            when: ago(e.appliedAt, now),
            active: e.applicationId === open?.applicationId,
          })),
        }))}
        ticket={ticket}
        notice={isApplicantNotice(notice) ? APPLICANT_NOTICES[notice] : null}
        error={isApplicantError(error) ? APPLICANT_ERRORS[error] : null}
        open={Boolean(one(sp.a)) && open !== null}
        base={base}
        home={home}
      />
    </>
  );
}
