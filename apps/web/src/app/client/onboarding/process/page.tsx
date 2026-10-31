import { Section } from "@/components/page";
import { onboardingAccess } from "@/lib/client/onboarding";
import { readProcess } from "@/lib/client/process";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import "../onboarding.css";
import { ProcessEditor } from "./editor";

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
    <Section title="Design your interview process">
      <p className="m-0 text-[13px] text-muted-foreground">Draw the steps from applying to an offer. Each job keeps its own plan: this changes one only when you apply it.</p>
      <ProcessEditor read={read} canEdit={access === "edit"} />
    </Section>
  );
}
