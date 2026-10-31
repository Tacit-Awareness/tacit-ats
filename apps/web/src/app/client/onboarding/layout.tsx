import { readChecklist, onboardingAccess } from "@/lib/client/onboarding";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { OnboardingFrame, OnboardingPointer } from "./frame";

// Onboarding's frame (design/tats's `#setup`): the steps, and the checklist beside
// them. A layout keeps its render across a step change, so each page gates itself
// too; the actions revalidate this one. Someone with no access gets the pointer
// home, and the step under it, which then shows only what its last action said:
// an admin who steps down to interviewer lands here.

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const member = gate.ctx;
  const access = await onboardingAccess(member.db, member.accessLevel);
  if (access === "none") return <OnboardingPointer interviewer={member.accessLevel === "limited"}>{children}</OnboardingPointer>;
  return (
    <OnboardingFrame org={member.org.name} access={access} checklist={await readChecklist(member.db, toolCtx(member))}>
      {children}
    </OnboardingFrame>
  );
}
