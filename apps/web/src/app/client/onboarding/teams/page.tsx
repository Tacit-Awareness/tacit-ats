import { Notice } from "@/components/page";
import { onboardingAccess } from "@/lib/client/onboarding";
import { readTeamMatrix } from "@/lib/client/onboarding-teams";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { TeamsStep } from "./matrix";

// Onboarding's Teams step, read with the member's own token. The layout gates too,
// but it keeps its render across a step change, so this page reads nothing for
// someone with no access.

export default async function OnboardingTeams() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const { db, accessLevel } = gate.ctx;
  const access = await onboardingAccess(db, accessLevel);
  if (access === "none") return null;
  const { matrix, truncated } = await readTeamMatrix(db, toolCtx(gate.ctx));
  return (
    <>
      {truncated ? <Notice>This list stopped short of your whole team.</Notice> : null}
      <TeamsStep matrix={matrix} editable={access === "edit"} />
    </>
  );
}
