import { notFound } from "next/navigation";
import { Pill, Section } from "@/components/page";
import { onboardingAccess } from "@/lib/client/onboarding";
import { resolveClient } from "@/lib/client/session";

// The steps not built yet. They say so, with no sample data; each is replaced by
// a folder of its own, which wins over this route. The checklist beside them
// already reads the real tables, so what the company has is counted either way.

const COMING = {
  teams: { title: "Put people on teams", body: "Say who is on which team, and who leads it. Someone can be on more than one." },
  skills: { title: "Say what each person interviews for", body: "List the kinds of interview your company runs, who runs each, and who to ask first." },
  process: { title: "Design your interview process", body: "Draw the steps from applying to an offer." },
  review: { title: "Review", body: "See who would be asked for each kind of interview, and which ones have nobody." },
} as const;

const isComing = (step: string): step is keyof typeof COMING => Object.hasOwn(COMING, step);

export default async function OnboardingComingNext({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!isComing(step)) notFound();
  const gate = await resolveClient();
  if (gate.status !== "ok" || (await onboardingAccess(gate.ctx.db, gate.ctx.accessLevel)) === "none") return null;
  return (
    <Section title={COMING[step].title} aside={<Pill>Coming next</Pill>}>
      <p className="m-0 text-[13px] text-muted-foreground">{COMING[step].body}</p>
      <p className="m-0 text-xs text-faint">This step isn&apos;t built yet, so there&apos;s nothing to do here for now.</p>
    </Section>
  );
}
