import { onboardingAccess } from "@/lib/client/onboarding";
import { readProcess } from "@/lib/client/process";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import "../onboarding.css";
import { ProcessEditor } from "./editor";
import { StepCard } from "../step-card";

// Onboarding's Interview process step (design/tats's `#setup~process`). One process
// per company, with a branch per team. Admins edit; the company's own hiring team
// reads the same canvas. A layout keeps its render across a step change, so this
// page asks again who may see it and, for anyone else, reads nothing.

export default async function ProcessPage() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const member = gate.ctx;
  const access = await onboardingAccess(member.db, member.accessLevel);
  if (access === "none") return null;
  const read = await readProcess(member.db, toolCtx(member));
  return (
    <StepCard title="Design your interview process" sub="Draw the steps from applying to an offer. Each job keeps its own plan: this changes one only when you apply it.">
      <ProcessEditor read={read} canEdit={access === "edit"} />
    </StepCard>
  );
}
