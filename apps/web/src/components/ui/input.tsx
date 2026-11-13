import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Testbench's `.input`: a raised face with a hard 3:1 edge (a field is input), ink and a soft ring on focus.
        "h-9 w-full min-w-0 border-0 bg-[color:var(--paper)] px-3 py-1 text-[13px] shadow-[inset_0_0_0_1px_var(--field)] transition-shadow duration-150 outline-none placeholder:text-faint hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A native <select> styled like Input (the pages use plain selects, no Radix). */
export const selectClass =
  "h-9 w-full border-0 bg-[color:var(--paper)] px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--field)] outline-none transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] focus-visible:outline-none disabled:opacity-50";
