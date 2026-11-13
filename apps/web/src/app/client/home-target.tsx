"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { StatusGlyph } from "@/components/page";
import type { TargetKind, TargetMetric, TargetUnit } from "@/lib/client/home-target-rules";
import { cn } from "@/lib/utils";
import { saveTargetAction } from "./actions";
import { TARGET_ERRORS, answering, type TargetState } from "./target-messages";

// A card's target (design/tats's `.hm-t` and its setThr form): for an admin a
// small button that opens the dialog, "Set a target" or what is set, and for the
// hiring team what is set, as a read-only tag. Both read as plain words ("At
// least 20", "Within 2d"), and the dialog is one sentence with the number in it
// ("Let me know when new applications drop under [20] in a period"), not a tool's
// "Alert below" field. A missed target wears Testbench's red alert square, never
// a dot. The dialog is a native <dialog>, so the browser gives it the top layer
// and focus trap, and keys.ts's ignoreKey stops every page and shell key behind
// it. That the target is the company's, whatever the page is filtered to, is
// the dialog's description and the title's hover, not a grey line. Nothing
// changes until Save, and it saves what it always did: the metric, the number,
// its unit, or the removal.

export type TargetChipProps = {
  metric: TargetMetric;
  /** The card's name, the dialog's title. */
  card: string;
  /** "Target", "Cap" or "Alert below". */
  label: string;
  /** The target in the card's words, or null with none set. */
  shown: string | null;
  off: boolean;
  /** Said for whoever cannot see the dot. */
  offNote: string;
  sub: string;
  kind: TargetKind;
  field: { value: string; unit: TargetUnit };
  canEdit: boolean;
};

/**
 * Each target in words: the dialog's sentence round the number (`lead` [n] `tail`,
 * the unit between for a time), the short words a card's foot shows once one is
 * set, and the longer ones its hover says.
 */
const WORDS: Record<TargetMetric, { lead: string; tail: string; short: (v: string) => string; long: (v: string) => string }> = {
  new_applications: {
    lead: "Let me know when new applications drop under",
    tail: "in a period.",
    short: (v) => `At least ${v}`,
    long: (v) => `Aiming for at least ${v} new applications in a period`,
  },
  review: {
    lead: "New candidates should typically be reviewed within",
    tail: ".",
    short: (v) => `Within ${v}`,
    long: (v) => `New candidates typically reviewed within ${v}`,
  },
  schedule: {
    lead: "Candidates should typically be scheduled within",
    tail: ".",
    short: (v) => `Within ${v}`,
    long: (v) => `Candidates typically scheduled within ${v}`,
  },
  feedback: {
    lead: "Interviewers should typically send their feedback within",
    tail: ".",
    short: (v) => `Within ${v}`,
    long: (v) => `Interviewer feedback typically in within ${v}`,
  },
  workload: {
    lead: "The team should spend no more than",
    tail: "hours in interviews.",
    short: (v) => `Up to ${v}`,
    long: (v) => `The team's interviews kept to ${v}`,
  },
};

/** Testbench's `.tag`: 6px corners, Geist Mono at the card's size. */
const chip = "inline-flex h-[26px] items-center gap-1.5 rounded-[6px] px-2 font-mono text-[12.5px] font-medium whitespace-nowrap";
/** Read-only: the tag's soft fill, nothing to press. */
const set = "bg-[color:var(--soft-strong)] text-muted-foreground";
/** For an admin: a small raised button with the inset ring, as Testbench's `.btn`. */
const press = "bg-[color:var(--paper)] text-muted-foreground shadow-[var(--btn-ring)] transition-colors hover:bg-[color:var(--hover)] hover:text-foreground";

function Words({ metric, shown, off, offNote }: Pick<TargetChipProps, "metric" | "shown" | "off" | "offNote">) {
  return (
    <>
      {off ? (
        <>
          <StatusGlyph kind="alert" className="size-[13px]" />
          <span className="sr-only">{offNote}: </span>
        </>
      ) : null}
      <span className={off ? "text-negative" : undefined}>{shown === null ? null : WORDS[metric].short(shown)}</span>
    </>
  );
}

/** The chip's hover: the target in full, and when it is missed, that too. */
const hover = (p: TargetChipProps) => (p.shown === null ? undefined : `${WORDS[p.metric].long(p.shown)}${p.off ? `. ${p.offNote}` : ""}`);

const IDLE: TargetState = { status: "idle" };
const save = answering(saveTargetAction);

export function TargetDialog({ metric, card, sub, kind, field, shown, close }: TargetChipProps & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(save, IDLE);
  const [value, setValue] = useState(field.value);
  const [unit, setUnit] = useState(field.unit);
  const [clear, setClear] = useState(false);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (state.status === "saved") dialog.current?.close();
  }, [state]);

  const titleId = `target-title-${metric}`;
  const scope = "It's your company's, the same whichever period, department or job the page shows.";
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-description={[sub, scope].filter(Boolean).join(" ")}
      // The browser lets a cancel be refused only once: a second Esc closes it anyway.
      // Mid-save it comes straight back, or a refusal would land in a closed dialog.
      onClose={() => (pending ? dialog.current?.showModal() : close())}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current && !pending) dialog.current?.close();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[440px] rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      {/*
        Not <form action>: React resets that when the action settles, and the
        select, having no default, would go back to days with the state still on
        hours, so a Save after a refusal would store 5 hours as 5 days.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const post = new FormData(e.currentTarget);
          startTransition(() => action(post));
        }}
        className="grid"
      >
        <input type="hidden" name="metric" value={metric} />
        <div className="grid gap-5 p-6">
          <h2 id={titleId} title={scope} className="m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.01em]">
            {card}
          </h2>
          {/* One sentence, the number (and for a time its unit) inside it. */}
          <p className="m-0 font-sans text-[16px] leading-[38px] text-foreground">
            {WORDS[metric].lead}{" "}
            <Input
              name="value"
              type="number"
              min={0}
              step={kind === "count" ? 1 : "any"}
              inputMode={kind === "count" ? "numeric" : "decimal"}
              placeholder={kind === "count" ? "20" : kind === "hours" ? "40" : "2"}
              aria-label={`${card}: the number`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              readOnly={clear || pending}
              autoFocus
              // A number field without the browser's spin arrows, so it reads as a word in the sentence rather than a control.
              className="mx-0.5 inline-block h-9 w-[68px] [appearance:textfield] rounded-[7px] px-2 text-center align-middle font-mono text-[14px] tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {kind === "time" ? (
              <>
                {" "}
                <select
                  name="unit"
                  aria-label="Days or hours"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as TargetUnit)}
                  disabled={clear || pending}
                  className={cn(selectClass, "mx-0.5 inline-block w-auto rounded-[7px] pr-8 align-middle font-mono text-[14px]")}
                >
                  <option value="d">days</option>
                  <option value="h">hours</option>
                </select>
              </>
            ) : null}
            {WORDS[metric].tail === "." ? "." : <> {WORDS[metric].tail}</>}
          </p>
          {shown !== null ? (
            <label className="flex items-center gap-2 font-sans text-[14px] text-muted-foreground">
              <input type="checkbox" name="clear" checked={clear} onChange={(e) => setClear(e.target.checked)} disabled={pending} className="size-4 accent-[color:var(--ink)]" />
              Remove this target
            </label>
          ) : null}
          {state.status === "error" ? (
            <p role="alert" className="m-0 font-sans text-[14px] text-[color:var(--red)]">
              {TARGET_ERRORS[state.error]}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function TargetChip(p: TargetChipProps) {
  const [open, setOpen] = useState(false);
  if (!p.canEdit) {
    return (
      <span className={cn(chip, set)} title={hover(p)}>
        <Words {...p} />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={hover(p) ?? `Set a target for ${p.card.toLowerCase()}`}
        className={cn(chip, press)}
      >
        {p.shown === null ? (
          <>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="size-3 text-faint" aria-hidden>
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            Set a target
          </>
        ) : (
          <Words {...p} />
        )}
      </button>
      {/* Mounted only while open, so each opening starts from what is stored and leaves no old refusal behind. */}
      {open ? <TargetDialog {...p} close={() => setOpen(false)} /> : null}
    </>
  );
}
