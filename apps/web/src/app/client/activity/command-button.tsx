"use client";

import { useRef, useState } from "react";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { BotFix } from "@/lib/client/bot-activity";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../inbox/confirm-dialog";
import { button, plain, primary } from "../inbox/fix-bar";
import { botCommandAction } from "./actions";

// Retry or Nudge. The press only opens the confirmation: a command makes the
// bot act outside this app, and a retry on a rejection really emails the
// candidate, so it says what will happen first. In the Inbox the same press is
// F (`keyed`); in Activity's Needs you it is a button a row, with no key of its
// own, because a list of them has no one to mean.

function InboxKey({ open, shown, label }: { open: () => void; shown: () => boolean; label: string }) {
  useKeys({ f: () => void (shown() && open()) });
  useKeyHelp("Inbox", [{ keys: "F", label: `${label}, after you confirm` }]);
  return null;
}

export function BotCommandButton({ fix, from, next = null, keyed = false, quiet = false }: { fix: BotFix; from: "inbox" | "activity"; next?: string | null; keyed?: boolean; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const self = useRef<HTMLButtonElement>(null);
  return (
    <>
      {keyed ? <InboxKey open={() => setOpen(true)} shown={() => isShown(self.current)} label={fix.label} /> : null}
      <button
        ref={self}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts={keyed ? "F" : undefined}
        className={cn(button, quiet ? plain : primary)}
      >
        {fix.label}
        {keyed ? (
          <Kbd decorative className="border-transparent bg-white/20 text-current">
            F
          </Kbd>
        ) : null}
      </button>
      {open ? (
        <ConfirmDialog action={botCommandAction} copy={fix.copy} close={() => setOpen(false)}>
          <input type="hidden" name="taskId" value={fix.taskId} />
          <input type="hidden" name="command" value={fix.command} />
          <input type="hidden" name="from" value={from} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
