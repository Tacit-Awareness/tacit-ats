"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import type { TargetKind, TargetMetric, TargetUnit } from "@/lib/client/home-target-rules";
import { cn } from "@/lib/utils";
import { saveTargetAction } from "./actions";
import { TARGET_ERRORS, answering, type TargetState } from "./target-messages";

// A card's target (design/tats's `.hm-t` and its setThr form): for an admin a
// chip that opens the dialog, "Set a target" or what is set, and for the hiring
// team what is set, read-only. The dialog is a native <dialog>, so the browser
// gives it the top layer and focus trap, and keys.ts's ignoreKey stops every
// page and shell key behind it. Nothing changes until Save.

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

const chip = "inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border px-2.5 text-[12.5px] whitespace-nowrap";
const set = "border-transparent bg-[color:var(--soft)] text-muted-foreground";

function Words({ label, shown, off, offNote }: Pick<TargetChipProps, "label" | "shown" | "off" | "offNote">) {
  return (
    <>
      {off ? (
        <>
          <i className="block size-[7px] rounded-full bg-[color:var(--red)]" aria-hidden />
          <span className="sr-only">{offNote}: </span>
        </>
      ) : null}
      {label} {shown}
    </>
  );
}

const IDLE: TargetState = { status: "idle" };
const save = answering(saveTargetAction);

export function TargetDialog({ metric, card, label, sub, kind, field, shown, close }: TargetChipProps & { close: () => void }) {
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
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // The browser lets a cancel be refused only once: a second Esc closes it anyway.
      // Mid-save it comes straight back, or a refusal would land in a closed dialog.
      onClose={() => (pending ? dialog.current?.showModal() : close())}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current && !pending) dialog.current?.close();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[420px] rounded-xl border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      {/*
        Not <form action>: React resets that when the action settles, and the
        select, having no default, would go back to Days with the state still on
        Hours, so a Save after a refusal would store 5 hours as 5 days.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const post = new FormData(e.currentTarget);
          startTransition(() => action(post));
        }}
        className="grid gap-3.5 p-5"
      >
        <input type="hidden" name="metric" value={metric} />
        <div>
          <h2 id={titleId} className="m-0 text-[15px] font-medium">
            {card}
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{sub}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={cn("grid gap-1 text-[12.5px] text-muted-foreground", kind === "time" ? "" : "col-span-2")}>
            {label}
            <Input
              name="value"
              type="number"
              min={0}
              step={kind === "count" ? 1 : "any"}
              inputMode={kind === "count" ? "numeric" : "decimal"}
              placeholder={kind === "count" ? "e.g. 20" : kind === "hours" ? "e.g. 40" : "e.g. 2"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              readOnly={clear || pending}
              autoFocus
            />
          </label>
          {kind === "time" ? (
            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              Unit
              <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as TargetUnit)} disabled={clear || pending} className={selectClass}>
                <option value="d">Days</option>
                <option value="h">Hours</option>
              </select>
            </label>
          ) : null}
        </div>
        {shown !== null ? (
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" name="clear" checked={clear} onChange={(e) => setClear(e.target.checked)} disabled={pending} />
            Remove this target
          </label>
        ) : null}
        <p className="m-0 text-[12.5px] text-faint">Your company&apos;s, and the same number whichever period, department or job the page is showing.</p>
        {state.status === "error" ? (
          <p role="alert" className="m-0 text-[13px] text-[color:var(--red)]">
            {TARGET_ERRORS[state.error]}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
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
      <span className={cn(chip, set)} title={p.off ? p.offNote : undefined}>
        <Words {...p} />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={p.off ? p.offNote : undefined}
        className={cn(chip, "hover:text-foreground", p.shown === null ? "border-dashed border-[color:var(--line-strong)] text-faint" : set)}
      >
        {p.shown === null ? "Set a target" : <Words {...p} />}
      </button>
      {/* Mounted only while open, so each opening starts from what is stored and leaves no old refusal behind. */}
      {open ? <TargetDialog {...p} close={() => setOpen(false)} /> : null}
    </>
  );
}
