import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { groupByJob, inOrder, neighbour, readerAnswers, selected } from "@/lib/client/applicant-queue";
import { readApplicantQueue, readRouting } from "@/lib/client/applicants";
import { readReply } from "@/lib/client/email";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { replyStarters } from "@/lib/client/reply-starters";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { APPLICANT_ERRORS, APPLICANT_NOTICES, isApplicantError, isApplicantNotice } from "./messages";
import { ApplicantsView, type Ticket } from "./view";

// Applicant Tickets (design/tats's #triage): new job-board applicants, read
// like email. The list is core's listApplicationsInbox on the member's own
// token (lib/client/applicants.ts), grouped by job, newest first; `?a=` picks
// the one the reader shows. The routing bar under it appears only when
// can_on_role says the member may move people in that job, and the reply box
// only when can_edit_person says they may email this candidate.

export default async function ClientApplicants({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org, user } = gate.ctx;

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
  const notice = one(sp.notice);
  const error = one(sp.error);

  const now = Date.now();
  const groups = groupByJob(await readApplicantQueue(db, { actorId, orgId: org.id, accessLevel }));
  const order = inOrder(groups);
  const open = selected(order, one(sp.a));
  const mailer = webMailer();
  const [routing, reply] = open
    ? await Promise.all([readRouting(db, open.jobId), readReply(db, toolCtx(gate.ctx), mailer, { candidateId: open.candidateId, applicationId: open.applicationId })])
    : [null, null];

  let ticket: Ticket | null = null;
  if (open) {
    const { phone, answers } = readerAnswers(open.answers);
    ticket = {
      name: open.name ?? "Unnamed applicant",
      email: open.email,
      phone,
      jobTitle: open.jobTitle ?? "Untitled job",
      jobHref: `/client/jobs/${open.jobId}`,
      applied: ago(open.appliedAt, now),
      post: open.post,
      answers,
      routing: routing?.canEdit
        ? { applicationId: open.applicationId, next: neighbour(order, open.applicationId)?.applicationId ?? null, reasons: routing.reasons }
        : null,
      reply: reply?.canEmail
        ? {
            applicationId: open.applicationId,
            candidateId: open.candidateId,
            to: open.email,
            enabled: mailer !== null,
            draft: reply.draft,
            sender: reply.sender,
            failed: reply.failed,
            sent: reply.sent ? { when: ago(reply.sent.at, now), subject: reply.sent.subject, by: reply.sent.by } : null,
            starters: replyStarters({ candidateName: open.name, jobTitle: open.jobTitle, company: org.name, sender: user.name }),
            subjectMax: clientTools.EMAIL_SUBJECT_MAX,
            bodyMax: clientTools.EMAIL_BODY_MAX,
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
          jobId: g.jobId,
          jobTitle: g.jobTitle,
          rows: g.entries.map((e) => ({
            applicationId: e.applicationId,
            href: `/client/applicants?a=${e.applicationId}`,
            name: e.name ?? "Unnamed applicant",
            line: e.post ?? e.email ?? "Job board",
            when: ago(e.appliedAt, now),
            active: e.applicationId === open?.applicationId,
          })),
        }))}
        ticket={ticket}
        notice={isApplicantNotice(notice) ? APPLICANT_NOTICES[notice] : null}
        error={isApplicantError(error) ? APPLICANT_ERRORS[error] : null}
        open={Boolean(one(sp.a)) && open !== null}
      />
    </>
  );
}
