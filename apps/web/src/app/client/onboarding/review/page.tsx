import { coverageOf } from "@/lib/client/coverage";
import { onboardingAccess, readChecklist } from "@/lib/client/onboarding";
import { readSkillSheet } from "@/lib/client/onboarding-teams";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { ReviewStep } from "./view";

// Onboarding's Review step (design/tats's `#setup~review`), read with the member's
// own token. It writes nothing: done-ness is computed by the checklist. The layout
// gates too, but it keeps its render across a step change, so this page reads
// nothing for someone with no access.

export default async function OnboardingReview() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const { db, accessLevel } = gate.ctx;
  const access = await onboardingAccess(db, accessLevel);
  if (access === "none") return null;
  const ctx = toolCtx(gate.ctx);
  const [{ sheet, teams, truncated }, checklist] = await Promise.all([readSkillSheet(db, ctx), readChecklist(db, ctx)]);
  return <ReviewStep coverage={coverageOf(sheet, teams)} ready={checklist.complete} canEdit={access === "edit"} truncated={truncated} />;
}
