"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Notice, Page, PageBar, Section, StatusGlyph, pillOption, pillTrack, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { SETUP_STEPS, stepOf, type Checklist, type SetupStep } from "@/lib/client/setup-checklist";
import { cn } from "@/lib/utils";

// Onboarding's frame, on Testbench's Assessment Creator: one step at a time.
// The company's heading is the page's title (which step this is, and what the
// five are for, are its hover title). Under it the five steps on a segmented
// track, each ticked once it is done and the one you are on raised; then the
// step's cards, Skip / Back / Continue under them, and the checklist card
// beside, its rows ticked the same way. Client only for which step is on: a
// layout does not render again when the step changes. Below 1180px the
// checklist goes under the step; on a phone the track names only the step you
// are on.

const ICONS = { left: "M10 3.5 5.5 8l4.5 4.5", right: "M6 3.5 10.5 8 6 12.5" };

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function StepTrail({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  return (
    <nav aria-label="Onboarding steps" className={pillTrack}>
      {checklist.items.map((item) => {
        const on = item.key === step;
        return (
          <Link key={item.key} href={item.href} aria-current={on ? "step" : undefined} title={on ? undefined : item.label} className={pillOption(on)}>
            <StatusGlyph kind={item.done ? "done" : "empty"} />
            <span className={cn(!on && "sr-only sm:not-sr-only")}>
              {item.label}
              {item.done ? <span className="sr-only">, done</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SetupChecklist({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  const { items, done, total } = checklist;
  return (
    <section aria-label="Setup checklist" className="grid min-w-0 gap-3 rounded-[14px] bg-card p-3 pt-4 shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-2 px-2">
        <h2 className="m-0 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">Setup checklist</h2>
        <span className="font-mono text-[12.5px] text-faint tabular-nums" title={`${done} of ${total} done`}>
          {done}/{total}
        </span>
      </div>
      <span aria-hidden className="mx-2 block h-1.5 overflow-hidden rounded-[3px] bg-[color:var(--soft-strong)]">
        <span className="block h-full rounded-[3px] bg-[color:var(--ink)] transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === step ? "step" : undefined}
              className={cn(
                "grid min-w-0 grid-cols-[14px_minmax(0,1fr)] gap-3 rounded-[8px] px-2 py-2.5 transition-colors",
                item.key === step ? "bg-[color:var(--sel)]" : "hover:bg-[color:var(--hover)]",
              )}
            >
              <StatusGlyph kind={item.done ? "done" : "empty"} className="mt-[3px]" />
              <span className="grid min-w-0 gap-0.5">
                <b className="truncate font-sans text-[13.5px] leading-5 font-medium">
                  {item.label}
                  <span className="sr-only">{item.done ? ", done" : ", not done"}</span>
                </b>
                <span className="truncate text-[12px] leading-4 text-faint" title={item.detail}>
                  {item.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StepFoot({ step, complete }: { step: SetupStep; complete: boolean }) {
  const at = SETUP_STEPS.findIndex((s) => s.key === step);
  const before = SETUP_STEPS[at - 1];
  const after = SETUP_STEPS[at + 1];
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Link href="/client" className={buttonVariants({ variant: "ghost" })}>
        {complete ? "Back to tATS" : "Skip for now"}
      </Link>
      <span className="flex-1" />
      {before ? (
        <Link href={`/client/onboarding/${before.key}`} className={buttonVariants({ variant: "outline" })}>
          <Chevron d={ICONS.left} />
          Back
        </Link>
      ) : null}
      <Link href={after ? `/client/onboarding/${after.key}` : "/client"} className={buttonVariants()}>
        {after ? "Continue" : "Open tATS"}
        <Chevron d={ICONS.right} />
      </Link>
    </div>
  );
}

export function OnboardingFrame({
  org,
  access,
  checklist,
  children,
}: {
  org: string;
  access: "edit" | "read";
  checklist: Checklist;
  children: React.ReactNode;
}) {
  const step = stepOf(usePathname());
  const at = SETUP_STEPS.findIndex((s) => s.key === step);
  // The flowchart wants the width: design/tats's `.su-wide`.
  const wide = step === "process";
  const { complete } = checklist;
  const where = complete ? "People & teams" : `Step ${at + 1} of ${SETUP_STEPS.length}`;
  const about = complete ? "Add people, move them between teams, and change what they interview for." : "Add who interviews, put them on teams, and say what they're best at.";
  return (
    <Page
      bar={
        <PageBar
          title={
            <span title={`${where}. ${about}`}>
              {complete ? "Your hiring team" : `Set up ${org}'s hiring team`}
              <span className="sr-only">, {where}</span>
            </span>
          }
        />
      }
    >
      <div
        className={cn(
          "mx-auto grid w-full min-w-0 items-start gap-6",
          wide ? "max-w-[1180px]" : "max-w-[1084px] min-[1180px]:grid-cols-[minmax(0,760px)_300px] min-[1180px]:justify-center",
        )}
      >
        <div className="grid min-w-0 content-start gap-4" data-tour="onboarding">
          <StepTrail step={step} checklist={checklist} />
          {access === "read" ? <Notice>You can read this. Only an admin at your company can change it.</Notice> : null}
          {children}
          <StepFoot step={step} complete={complete} />
        </div>
        {wide ? null : (
          <aside className="min-w-0 min-[1180px]:sticky min-[1180px]:top-6">
            <SetupChecklist step={step} checklist={checklist} />
          </aside>
        )}
      </div>
    </Page>
  );
}

/** Someone Onboarding is not for: what their last action said, then where to go. */
export function OnboardingPointer({ interviewer, children }: { interviewer: boolean; children: React.ReactNode }) {
  return (
    <Page bar={<PageBar title="Onboarding" />}>
      {children}
      <Section>
        <p className="m-0 text-[13px] text-muted-foreground">
          {interviewer ? "You're an interviewer here. The people you interview are on your " : "Onboarding is for your company's own team. Your jobs and candidates are on your "}
          <Link href="/client" className={textLink}>
            home page
          </Link>
          .
        </p>
      </Section>
    </Page>
  );
}
