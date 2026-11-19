import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Tacit Tickets' `Field`: a bordered face; focus darkens the edge and shows the caret, never a ring.
        "h-9 w-full min-w-0 border-0 bg-[color:var(--paper)] px-3 py-1 text-[13px] shadow-[inset_0_0_0_1px_var(--field)] transition-shadow duration-150 outline-none placeholder:text-faint hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-visible:shadow-[inset_0_0_0_1px_var(--faint)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A native <select> styled like Input (the pages use plain selects, no Radix). */
export const selectClass =
  "h-9 w-full border-0 bg-[color:var(--paper)] px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--field)] outline-none transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-visible:shadow-[inset_0_0_0_1px_var(--faint)] focus-visible:outline-none disabled:opacity-50";
