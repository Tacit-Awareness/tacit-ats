import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { homeSubBase, hrefAt } from "@/lib/client/home-tabs";
import { groupByTeam, inOrder, isReferral, neighbour, readerAnswers, selected, referralTag, sourceWords } from "@/lib/client/applicant-queue";
import { readApplicantQueue, readApplicationNotes, readPersonNotes, readRouting } from "@/lib/client/applicants";
import { readDepartments } from "@/lib/client/departments";
import { viewerFiles } from "@/lib/client/file-view-rules";
import { readReply } from "@/lib/client/email";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { replyStarters } from "@/lib/client/reply-starters";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { APPLICANT_ERRORS, APPLICANT_NOTICES, isApplicantError, isApplicantNotice } from "./messages";
import { ApplicantsView, type Ticket } from "./view";

// New Applicants (design/tats's #triage): new job-board applicants and
// referrals, read like email. The list is core's listApplicationsInbox on the member's own
// token (lib/client/applicants.ts), grouped by team (by job in an org with no
// departments), newest first; `?a=` picks the one the reader shows. The control
// panel under it offers the next step only when can_on_role says the member may
// move people in that job, and the reply only when can_edit_person says they
// may email this candidate.

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
  const [queue, structure] = await Promise.all([readApplicantQueue(db, { actorId, orgId: org.id, accessLevel }), readDepartments(db)]);
  const groups = groupByTeam(queue, structure);
  const order = inOrder(groups);
  const open = selected(order, one(sp.a));
  const mailer = webMailer();
  const referral = open !== null && isReferral(open);
  const [routing, reply, notes, personNotes, files] = open
    ? await Promise.all([
        readRouting(db, open.jobId),
        readReply(db, toolCtx(gate.ctx), mailer, { candidateId: open.candidateId, applicationId: open.applicationId }),
        // A referral has no form to read; what the referrer said is its note.
        referral ? readApplicationNotes(db, open.applicationId) : [],
        readPersonNotes(db, open.candidateId),
        clientTools.listFiles(db, toolCtx(gate.ctx), { candidateId: open.candidateId }),
      ])
    : [null, null, [], [], []];

  let ticket: Ticket | null = null;
  if (open) {
    const { phone, answers } = readerAnswers(open.answers, open.linkedinUrl);
    const group = groups.find((g) => g.entries.includes(open));
    ticket = {
      applicationId: open.applicationId,
      name: open.name ?? "Unnamed applicant",
      email: open.email,
      phone,
      jobTitle: open.jobTitle ?? "Untitled job",
      jobHref: `/client/jobs/${open.jobId}`,
      applied: ago(open.appliedAt, now),
      referral,
      source: sourceWords(open),
      notes: [...notes, ...personNotes],
      files: viewerFiles(files, (iso) => ago(iso, now)),
      team: group?.isTeam ? group.title : null,
      answers,
      routing: routing?.canEdit
        ? { applicationId: open.applicationId, next: neighbour(order, open.applicationId)?.applicationId ?? null, reasons: routing.reasons, home }
        : null,
      reply: reply?.canEmail
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
            subjectMax: clientTools.EMAIL_SUBJECT_MAX,
            bodyMax: clientTools.EMAIL_BODY_MAX,
            home,
          }
        : null,
    };
  }

  return (
    <>
      <MarkSeen mark="tickets" ids={order.map((e) => e.applicationId)} />
      <ApplicantsView
        total={order.length}
        groups={groups.map((g) => ({
          key: g.key,
          title: g.title,
          rows: g.entries.map((e) => ({
            applicationId: e.applicationId,
            href: hrefAt(base, new URLSearchParams({ a: e.applicationId })),
            name: e.name ?? "Unnamed applicant",
            tag: referralTag(e),
            // Under a team the row has to name the job; under a job it says where they applied, or the tag does.
            line: g.isTeam ? (e.jobTitle ?? "Untitled job") : isReferral(e) ? (e.email ?? "") : (e.post ?? e.email ?? "Job board"),
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
