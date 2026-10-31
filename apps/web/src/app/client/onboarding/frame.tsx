"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { SETUP_STEPS, stepOf, type Checklist, type SetupStep } from "@/lib/client/setup-checklist";
import { cn } from "@/lib/utils";

// design/tats's `#setup`: the step, its numbered trail and Back / Continue, with
// the checklist beside it. Client only for which step is on: a layout does not
// render again when the step changes. On a phone the checklist sits above the
// step, as a card of its own, and the trail wraps rather than scrolling the page.

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full border text-[color:var(--n0)]",
        done ? "border-transparent bg-[color:var(--green)]" : "border-[color:var(--line-strong)] bg-[color:var(--paper)]",
      )}
    >
      {done ? (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-2.5">
          <path d="M2.5 6.2 5 8.6l4.5-5" />
        </svg>
      ) : null}
    </span>
  );
}

function StepTrail({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  return (
    <nav aria-label="Onboarding steps" className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {checklist.items.map((item, n) => {
        const on = item.key === step;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? "step" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-[13px] transition-colors",
              on ? "bg-[color:var(--pick)] font-medium text-[color:var(--pick-ink)]" : "text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground",
            )}
          >
            <span className="tabular-nums">{n + 1}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SetupChecklist({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  const { items, done, total } = checklist;
  return (
    <section aria-label="Setup checklist" className="grid min-w-0 gap-2.5 border border-[color:var(--line)] bg-[color:var(--surface)] p-3.5 shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-2 text-[13.5px]">
        <b className="font-medium">Setup checklist</b>
        <span className="text-faint tabular-nums" aria-label={`${done} of ${total} done`}>
          {done}/{total}
        </span>
      </div>
      <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-[color:var(--soft-strong)]">
        <span className="block h-full bg-[color:var(--ink)] transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === step ? "step" : undefined}
              className={cn("flex min-w-0 items-start gap-2.5 px-1.5 py-1.5 transition-colors hover:bg-[color:var(--hover)]", item.key === step && "bg-[color:var(--soft)]")}
            >
              <Check done={item.done} />
              <span className="grid min-w-0">
                <b className="truncate text-[13px] font-medium">
                  {item.label}
                  <span className="sr-only">{item.done ? ", done" : ", not done"}</span>
                </b>
                <span className="truncate text-xs text-faint">{item.detail}</span>
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
    <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--line)] pt-3.5">
      <Link href="/client" className={textLink}>
        {complete ? "Back to tATS" : "Skip for now"}
      </Link>
      <span className="flex-1" />
      {before ? (
        <Link href={`/client/onboarding/${before.key}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      ) : null}
      <Link href={after ? `/client/onboarding/${after.key}` : "/client"} className={buttonVariants({ size: "sm" })}>
        {after ? "Continue" : "Open tATS"}
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
  return (
    <Page bar={<PageBar title="Onboarding" />}>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_288px]">
        <aside className="min-w-0 lg:order-last lg:sticky lg:top-6">
          <SetupChecklist step={step} checklist={checklist} />
        </aside>
        <div className="grid min-w-0 gap-4" data-tour="onboarding">
          <div className="grid gap-1">
            <p className="m-0 text-xs text-faint">{checklist.complete ? "People & teams" : `Step ${at + 1} of ${SETUP_STEPS.length}`}</p>
            <h2 className="m-0 text-[22px] font-medium tracking-[-0.012em] [overflow-wrap:anywhere]">{checklist.complete ? "Your hiring team" : `Set up ${org}'s hiring team`}</h2>
            <p className="m-0 max-w-[60ch] text-[13.5px] text-muted-foreground">
              {checklist.complete ? "Add people, move them between teams, and change what they interview for." : "Add who interviews, put them on teams, and say what they're best at."}
            </p>
          </div>
          <StepTrail step={step} checklist={checklist} />
          {access === "read" ? <Notice>You can read this. Only an admin at your company can change it.</Notice> : null}
          {children}
          <StepFoot step={step} complete={checklist.complete} />
        </div>
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
