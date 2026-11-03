"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { SETUP_STEPS, stepOf, type Checklist, type SetupStep } from "@/lib/client/setup-checklist";
import { cn } from "@/lib/utils";

// design/tats's `#setup` as design/tats-ui-update draws it: the step and the
// company's heading, the numbered trail joined by rules, the step's card in a
// soft frame with Skip / Back / Continue under it, and the checklist beside it
// (`.su`, `.su-steps`, `.su-frame`, `.su-foot`, `.su-check`). Client only for
// which step is on: a layout does not render again when the step changes. Below
// 1180px the checklist goes under the step, as the prototype's; on a phone the
// trail keeps its numbers and names only the step you are on.

const ICONS = { check: "M3.5 8.5l3 3 6-7", left: "M10 3.5 5.5 8l4.5 4.5", right: "M6 3.5 10.5 8 6 12.5" };

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cn("size-3 shrink-0", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}

function StepTrail({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  return (
    <nav aria-label="Onboarding steps" className="flex min-w-0 items-center gap-2 sm:gap-3">
      {checklist.items.map((item, n) => {
        const on = item.key === step;
        const done = item.done && !on;
        return (
          <Fragment key={item.key}>
            {n ? <i aria-hidden className="h-px min-w-2 flex-1 bg-[color:var(--line-strong)]" /> : null}
            <Link
              href={item.href}
              aria-current={on ? "step" : undefined}
              className={cn("inline-flex shrink-0 items-center gap-2 text-sm whitespace-nowrap transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border text-xs tabular-nums",
                  on ? "border-[color:var(--ink)] bg-[color:var(--raised)]" : done ? "border-transparent bg-[color:var(--soft)] text-foreground" : "border-[color:var(--line-strong)] bg-[color:var(--raised)]",
                )}
              >
                {done ? <Glyph d={ICONS.check} /> : n + 1}
              </span>
              <span className={cn(!on && "sr-only sm:not-sr-only")}>
                {item.label}
                {item.done ? <span className="sr-only">, done</span> : null}
              </span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

function SetupChecklist({ step, checklist }: { step: SetupStep; checklist: Checklist }) {
  const { items, done, total } = checklist;
  return (
    <section aria-label="Setup checklist" className="grid min-w-0 gap-0.5 rounded-[14px] bg-[color:var(--paper)] p-4 shadow-[var(--shadow)]">
      <div className="flex items-center justify-between gap-2 px-2 text-sm">
        <b className="font-semibold">Setup checklist</b>
        <span className="text-muted-foreground tabular-nums" aria-label={`${done} of ${total} done`}>
          {done}/{total}
        </span>
      </div>
      <span aria-hidden className="mx-2 my-3 block h-1 overflow-hidden rounded-full bg-[color:var(--soft-strong)]">
        <span className="block h-full rounded-full bg-[color:var(--ink)] transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === step ? "step" : undefined}
              className={cn(
                "grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-[10px] px-2 py-3 transition-colors",
                item.key === step ? "bg-[color:var(--raised)] shadow-[0_0_0_1px_var(--line)]" : "hover:bg-[color:var(--hover)]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-px grid size-5 place-items-center rounded-full border-[1.5px] text-[color:var(--paper)]",
                  item.done ? "border-[color:var(--ink)] bg-[color:var(--ink)]" : "border-[color:var(--line-strong)]",
                )}
              >
                {item.done ? <Glyph d={ICONS.check} className="size-[11px]" /> : null}
              </span>
              <span className="grid min-w-0">
                <b className="truncate text-sm font-medium">
                  {item.label}
                  <span className="sr-only">{item.done ? ", done" : ", not done"}</span>
                </b>
                <span className="truncate text-[12.5px] text-muted-foreground">{item.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const footButton = "inline-flex h-[38px] items-center gap-1.5 rounded-[10px] px-4 text-sm font-medium transition-colors";

function StepFoot({ step, complete }: { step: SetupStep; complete: boolean }) {
  const at = SETUP_STEPS.findIndex((s) => s.key === step);
  const before = SETUP_STEPS[at - 1];
  const after = SETUP_STEPS[at + 1];
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 pr-3 pl-4 sm:pt-3 sm:pl-5">
      <Link href="/client" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
        {complete ? "Back to tATS" : "Skip for now"}
      </Link>
      <span className="flex-1" />
      {before ? (
        <Link href={`/client/onboarding/${before.key}`} className={cn(footButton, "border border-[color:var(--line-strong)] bg-[color:var(--raised)] hover:bg-[color:var(--hover)]")}>
          <Glyph d={ICONS.left} className="size-[13px]" />
          Back
        </Link>
      ) : null}
      <Link href={after ? `/client/onboarding/${after.key}` : "/client"} className={cn(footButton, "bg-[color:var(--ink)] text-[color:var(--paper)] hover:opacity-90")}>
        {after ? "Continue" : "Open tATS"}
        <Glyph d={ICONS.right} className="size-[13px]" />
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
  return (
    <div
      className={cn(
        "mx-auto grid w-full min-w-0 items-start gap-6 md:pt-6",
        wide ? "max-w-[1180px]" : "max-w-[1084px] min-[1180px]:grid-cols-[minmax(0,760px)_300px] min-[1180px]:justify-center",
      )}
    >
      <div className="grid min-w-0 content-start" data-tour="onboarding">
        <p className="m-0 text-[13.5px] text-muted-foreground">{checklist.complete ? "People & teams" : `Step ${at + 1} of ${SETUP_STEPS.length}`}</p>
        <h1 className="mt-2 mb-0 text-[26px] leading-tight font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[30px]">
          {checklist.complete ? "Your hiring team" : `Set up ${org}'s hiring team`}
        </h1>
        <p className="mt-2 mb-0 max-w-[62ch] text-[15px] text-muted-foreground">
          {checklist.complete ? "Add people, move them between teams, and change what they interview for." : "Add who interviews, put them on teams, and say what they're best at."}
        </p>
        <div className="my-6">
          <StepTrail step={step} checklist={checklist} />
        </div>
        {access === "read" ? (
          <div className="mb-4">
            <Notice>You can read this. Only an admin at your company can change it.</Notice>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-1 rounded-[16px] bg-[color:var(--soft)] p-1">
          <div className="grid min-w-0 gap-1">{children}</div>
          <StepFoot step={step} complete={checklist.complete} />
        </div>
      </div>
      {wide ? null : (
        <aside className="min-w-0 min-[1180px]:sticky min-[1180px]:top-6 min-[1180px]:pt-[104px]">
          <SetupChecklist step={step} checklist={checklist} />
        </aside>
      )}
    </div>
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
