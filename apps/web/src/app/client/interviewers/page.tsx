import Link from "next/link";
import { listPendingInvites } from "@tacit-ats/core";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { awayLabel } from "@/lib/client/interviewer-profile";
import { readInterviewers, readOwnProfile } from "@/lib/client/interviewers";
import { readMembers } from "@/lib/client/member-access";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { TEAM_ERRORS, TEAM_NOTICES, isTeamError, isTeamNotice } from "./messages";
import { TeamSections, type TeamMember } from "./team";
import { InterviewersView, OwnProfile, type InterviewerViewGroup } from "./view";

// Who interviews (design/tats's Interviewers, `#bots~people`), read with the
// signed-in member's own token (lib/client/interviewers.ts): one row per
// member on a hiring team as an interviewer or with interviews, grouped by
// department when their jobs have one, with what they said about interviewing.
// A member edits their own of that, an admin anyone's; the rest is counts. Under
// them the whole team (team.tsx); an admin also changes access, invites, re-sends
// and withdraws. Whether someone is an admin is the database's answer (current_access_level).

export default async function ClientInterviewers({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org, user } = gate.ctx;
  const now = new Date();
  const { notice, error } = await searchParams;
  const notices = (
    <>
      {isTeamNotice(notice) ? <FlashToast text={TEAM_NOTICES[notice]} /> : null}
      {isTeamError(error) ? <Notice tone="error">{TEAM_ERRORS[error]}</Notice> : null}
    </>
  );

  // An admin who just stepped down to interviewer lands here, so the notice shows too.
  if (accessLevel === "limited") {
    const own = await readOwnProfile(db, actorId);
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
        <OwnProfile actorId={actorId} name={user.name} profile={own} away={awayLabel(own?.awayUntil ?? null, now)} />
      </Page>
    );
  }

  const isAdmin = accessLevel === "admin";
  const [{ groups, feedback, truncated, own }, team, pending] = await Promise.all([
    readInterviewers(db, { actorId, orgId: org.id, accessLevel }, now),
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
      profile: i.profile,
      away: awayLabel(i.profile?.awayUntil ?? null, now),
      editable: isAdmin || i.actorId === actorId,
      self: i.actorId === actorId,
    })),
  }));
  const onTable = groups.some((g) => g.interviewers.some((i) => i.actorId === actorId));

  return (
    <InterviewersView
      groups={view}
      feedback={feedback}
      note={truncated ? "Counted from the first 5,000 interviews; there are more." : null}
      empty={view.length === 0 ? "Nobody interviews yet. Add interviewers to a job's hiring team, or schedule an interview." : null}
      notices={notices}
    >
      {onTable ? null : <OwnProfile actorId={actorId} name={user.name} profile={own} away={awayLabel(own?.awayUntil ?? null, now)} />}
      <TeamSections members={members} membersTruncated={team.truncated} pending={pending} actorId={actorId} isAdmin={isAdmin} rendered={Date.now()} />
    </InterviewersView>
  );
}
