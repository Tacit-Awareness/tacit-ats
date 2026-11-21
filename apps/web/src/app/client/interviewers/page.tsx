import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { InterviewersViewSwitch } from "./view-switch";
import { awayLabel } from "@/lib/client/interviewer-profile";
import { readInterviewers, readOwnProfile } from "@/lib/client/interviewers";
import { onboardingAccess, readPeople, readTitles } from "@/lib/client/onboarding";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { TeamSections } from "./team";
import { InterviewersView, OnboardingLink, OwnProfile, type InterviewerViewGroup } from "./view";

// Who interviews (design/tats's Interviewers, `#bots~people`), read with the
// signed-in member's own token (lib/client/interviewers.ts): one row per
// member on a hiring team as an interviewer or with interviews, grouped by
// department when their jobs have one, with what they said about interviewing.
// A member edits their own of that, an admin anyone's; the rest is counts. The
// team and its invitations are on Onboarding's People step, which the title
// row's action opens, except for an external recruiter, whom Onboarding turns
// away: they keep the list here, under the table. Whether someone is an admin
// is the database's answer (current_access_level).

export default async function ClientInterviewers() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org, user } = gate.ctx;
  const now = new Date();

  if (accessLevel === "limited") {
    const [own, titles] = await Promise.all([readOwnProfile(db, actorId), readTitles(db)]);
    return (
      <Page bar={<PageBar title="Interviewers" lead={<InterviewersViewSwitch current="people" />} />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
        <OwnProfile actorId={actorId} name={user.name} profile={own} away={awayLabel(own?.awayUntil ?? null, now)} title={titles[actorId] ?? null} />
      </Page>
    );
  }

  const isAdmin = accessLevel === "admin";
  const [{ groups, feedback, truncated, own }, access] = await Promise.all([
    readInterviewers(db, { actorId, orgId: org.id, accessLevel }, now),
    onboardingAccess(db, accessLevel),
  ]);
  const outside = access === "none" ? await readPeople(db, false) : null;
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
  // Below the hiring team's table: on Onboarding for them, their title with the rest of their own.
  const title = onTable ? null : outside ? (outside.titles[actorId] ?? null) : undefined;

  return (
    <InterviewersView
      groups={view}
      feedback={feedback}
      note={truncated ? "Counted from the first 5,000 interviews; there are more." : null}
      empty={view.length === 0 ? "Nobody interviews yet. Add interviewers to a job's hiring team, or schedule an interview." : null}
      actions={outside ? null : <OnboardingLink isAdmin={isAdmin} />}
    >
      {onTable ? null : <OwnProfile actorId={actorId} name={user.name} profile={own} away={awayLabel(own?.awayUntil ?? null, now)} title={title} />}
      {outside ? (
        <TeamSections members={outside.members} membersTruncated={outside.truncated} pending={[]} actorId={actorId} isAdmin={false} titles={outside.titles} rendered={Date.now()} />
      ) : null}
    </InterviewersView>
  );
}
