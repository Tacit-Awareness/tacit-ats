import { FlashToast } from "@/components/flash-toast";
import { Notice } from "@/components/page";
import { onboardingAccess, readPeople } from "@/lib/client/onboarding";
import { resolveClient } from "@/lib/client/session";
import { TeamSections } from "../../interviewers/team";
import { TEAM_ERRORS, TEAM_NOTICES, isTeamError, isTeamNotice } from "../messages";

// Onboarding's first step: who is on the team, and for an admin who is invited,
// access, titles and the invite form (interviewers/team.tsx), read with the
// member's own token. The layout gates too, but it keeps its render across a step
// change, so this page reads nothing for someone with no access: they get only
// what their last action said, above the layout's pointer home.

export default async function OnboardingPeople({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const { db, actorId, accessLevel } = gate.ctx;
  const { notice, error } = await searchParams;
  const notices = (
    <>
      {isTeamNotice(notice) ? <FlashToast text={TEAM_NOTICES[notice]} /> : null}
      {isTeamError(error) ? <Notice tone="error">{TEAM_ERRORS[error]}</Notice> : null}
    </>
  );
  if ((await onboardingAccess(db, accessLevel)) === "none") return notices;

  const isAdmin = accessLevel === "admin";
  const { members, truncated, pending, titles } = await readPeople(db, isAdmin);
  return (
    <>
      {notices}
      {members.length + pending.length === 1 && isAdmin ? <Notice>It&apos;s just you so far. Invite the people who interview, and anyone else who works on hiring.</Notice> : null}
      <TeamSections members={members} membersTruncated={truncated} pending={pending} actorId={actorId} isAdmin={isAdmin} titles={titles} rendered={Date.now()} />
    </>
  );
}
