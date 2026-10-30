import Link from "next/link";
import { listPendingInvites } from "@tacit-ats/core";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { readInterviewers } from "@/lib/client/interviewers";
import { readMembers } from "@/lib/client/member-access";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { TEAM_ERRORS, TEAM_NOTICES, isTeamError, isTeamNotice } from "./messages";
import { TeamSections, type TeamMember } from "./team";
import { InterviewersView, type InterviewerViewGroup } from "./view";

// Who interviews (design/tats's Interviewers, `#bots~people`), read with the
// signed-in member's own token (lib/client/interviewers.ts): one row per
// member on a hiring team as an interviewer or with interviews, grouped by
// department when their jobs have one. Read-only, and counts only. Under them
// the whole team (team.tsx); an admin also changes access, invites, re-sends
// and withdraws. Whether someone is an admin is the database's answer (current_access_level).

export default async function ClientInterviewers({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  const { notice, error } = await searchParams;
  const notices = (
    <>
      {isTeamNotice(notice) ? <Notice>{TEAM_NOTICES[notice]}</Notice> : null}
      {isTeamError(error) ? <Notice tone="error">{TEAM_ERRORS[error]}</Notice> : null}
    </>
  );

  // An admin who just stepped down to interviewer lands here, so the notice shows too.
  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Interviewers" />}>
        {notices}
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

  const isAdmin = accessLevel === "admin";
  const [{ groups, feedback, truncated }, team, pending] = await Promise.all([
    readInterviewers(db, { actorId, orgId: org.id, accessLevel }, new Date()),
    readMembers(db),
    isAdmin ? listPendingInvites(db) : Promise.resolve([]),
  ]);
  const pendingIds = new Set(pending.map((p) => p.actorId));
  const members = team.rows.filter((m) => m.id && !pendingIds.has(m.id)) as TeamMember[];
  const view: InterviewerViewGroup[] = groups.map((g) => ({
    label: g.label,
    rows: g.interviewers.map((i) => ({
      actorId: i.actorId,
      name: i.name,
      thisWeek: i.load.thisWeek,
      nextWeek: i.load.nextWeek,
      last30: i.load.last30,
      feedback: i.feedback,
      jobs: i.jobs.map((j) => j.title),
    })),
  }));

  return (
    <InterviewersView
      groups={view}
      feedback={feedback}
      note={truncated ? "Counted from the first 5,000 interviews; there are more." : null}
      empty={view.length === 0 ? "Nobody interviews yet. Add interviewers to a job's hiring team, or schedule an interview." : null}
      notices={notices}
    >
      <TeamSections members={members} membersTruncated={team.truncated} pending={pending} actorId={actorId} isAdmin={isAdmin} rendered={Date.now()} />
    </InterviewersView>
  );
}
