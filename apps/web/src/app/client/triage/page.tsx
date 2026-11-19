import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { FlashToast } from "@/components/flash-toast";
import { LiveRefresh } from "@/components/live-refresh";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { groupByTeam, type QueueEntry } from "@/lib/client/applicant-queue";
import { readApplicantQueue } from "@/lib/client/applicants";
import { departmentScope, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { readInbox } from "@/lib/client/inbox";
import { selectedIssue, type Issue } from "@/lib/client/inbox-issues";
import { resolveClient } from "@/lib/client/session";
import { inTeam, triageGroups } from "@/lib/client/triage-rules";
import { APPLICANT_ERRORS, APPLICANT_NOTICES, isApplicantError, isApplicantNotice } from "../applicants/messages";
import { readTicket, teamOf } from "../applicants/tickets";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice } from "../inbox/messages";
import { REASON_SECTION, SECTIONS } from "../inbox/sections";
import { readIssueReader } from "../inbox/issue-reader";
import { Refusal } from "../refusal";
import { TriageView } from "./view";

// Triage (design/tacit-tickets's Triage): everything waiting on the member in
// one place, the Inbox and New Applicants together. Three panes: the queue on
// the left, Needs You first (the Inbox's issues, lib/client/inbox.ts's
// readInbox) and then the new applicants by how they came in, Referred, Applied
// and Sourced (New Applicants' queue, lib/client/applicants.ts); the picked one
// in the middle; what is known about them on the right. All on the member's own
// token, through the reads and actions those pages use.
// - `?a=<application id>` opens an applicant: their files in the middle, read in
//   place, and the composer under them (composer.tsx), New Applicants' own route,
//   draft and send, which come back here.
// - `?i=<issue key>` opens a Needs You item in place, with the Inbox's own card
//   and controls (inbox/issue-reader.tsx) and the candidate under it, plus a
//   link to it in the Inbox. Its writes come back here too.
// - `?department=` is a team from the sidebar: only its jobs.
// - Nothing picked opens the first applicant, as the prototype does.
// Left out from the prototype: Revisit (nothing returns declined applicants
// with a grade), Done (the Inbox keeps its own Done tab), the grade, Testbench
// results and the bot's team ranking (not in tATS).

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ClientTriage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Triage" />}>
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
  const member = { actorId, orgId: org.id, accessLevel };
  const [{ issues }, queueRead, structure] = await Promise.all([
    readInbox(db, member, now),
    // As the Inbox reads it: a failed queue leaves Needs You standing.
    readApplicantQueue(db, member).catch((e: unknown) => {
      console.error("triage applicants:", e instanceof Error ? e.message : "read failed");
      return null;
    }),
    readDepartments(db),
  ]);

  const scope = departmentScope(structure, one(sp.department));
  const team = scope.departmentId ? scope.options.find((o) => o.id === scope.departmentId) : null;
  const queue = (queueRead ?? []).filter((e) => inScope(scope, e.jobId));
  const needs = SECTIONS.flatMap((s) => issues.filter((i) => REASON_SECTION[i.reason] === s.key)).filter((i) => inTeam(scope.jobIds, i.job.id));
  const groups = triageGroups(queue);
  const order = groups.flatMap((g) => g.entries);

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (scope.departmentId) p.set("department", scope.departmentId);
    return `/client/triage?${p}`;
  };

  // A Needs You item wins over an applicant; nothing picked is the first applicant.
  const need: Issue | null = selectedIssue(needs, one(sp.i));
  const applicant: QueueEntry | null = need ? null : (order.find((e) => e.applicationId === one(sp.a)) ?? order[0] ?? null);
  const at = applicant ? order.indexOf(applicant) : -1;
  const next = at >= 0 ? (order[at + 1] ?? order[at - 1] ?? null) : null;
  const [issue, ticket] = await Promise.all([
    need ? readIssueReader(gate.ctx, { issues: needs, open: need, nowMs }) : null,
    applicant ? readTicket(gate.ctx, applicant, { team: teamOf(groupByTeam(queue, structure), applicant), next: next?.applicationId ?? null }, nowMs) : null,
  ]);

  const notice = one(sp.notice);
  const error = one(sp.error);
  const refusal = isApplicantError(error) ? APPLICANT_ERRORS[error] : isInboxError(error) ? INBOX_ERRORS[error] : null;
  const said = isApplicantNotice(notice) ? APPLICANT_NOTICES[notice] : isInboxNotice(notice) ? INBOX_NOTICES[notice] : null;
  const flash = refusal ? <Notice tone="error">{refusal}</Notice> : null;

  return (
    <>
      <MarkSeen mark="inbox" ids={issues.map((i) => i.key)} />
      <MarkSeen mark="tickets" ids={(queueRead ?? []).map((e) => e.applicationId)} />
      <LiveRefresh />
      {said && !refusal ? <FlashToast text={said} /> : null}
      <TriageView
        team={team?.name ?? null}
        needs={needs}
        groups={groups}
        need={need}
        applicant={applicant}
        issue={issue}
        ticket={ticket}
        flash={flash}
        laterHref={next ? qs({ a: next.applicationId }) : null}
        hrefOf={qs}
        queueFailed={queueRead === null}
        nowMs={nowMs}
      />
    </>
  );
}

