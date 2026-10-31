import Link from "next/link";
import { Notice, textLink } from "@/components/page";
import { onboardingAccess } from "@/lib/client/onboarding";
import { readSkillSheet } from "@/lib/client/onboarding-teams";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { SkillsStep } from "./sheet";

// Onboarding's Interview skills step, read with the member's own token. The layout
// gates too, but it keeps its render across a step change, so this page reads
// nothing for someone with no access.

export default async function OnboardingSkills() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const { db, accessLevel } = gate.ctx;
  const access = await onboardingAccess(db, accessLevel);
  if (access === "none") return null;
  const { sheet, truncated } = await readSkillSheet(db, toolCtx(gate.ctx));
  return (
    <>
      {truncated ? <Notice>This list stopped short of your whole team.</Notice> : null}
      {access === "read" ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          Your own skills are on the{" "}
          <Link href="/client/interviewers" className={textLink}>
            Interviewers page
          </Link>
          .
        </p>
      ) : null}
      <SkillsStep sheet={sheet} editable={access === "edit"} />
    </>
  );
}
