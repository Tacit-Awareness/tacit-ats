import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 border border-input bg-[color:var(--paper)] px-[11px] py-1 text-[13px] transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 hover:border-[color:var(--hairline)] focus-visible:border-[color:color-mix(in_srgb,var(--accent)_45%,var(--line-strong))] focus-visible:ring-3 focus-visible:ring-[color:var(--accent-soft)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A native <select> styled like Input (the pages use plain selects, no Radix). */
export const selectClass =
  "h-8 w-full border border-input bg-[color:var(--paper)] px-2.5 text-[13px] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--hairline)] focus-visible:border-[color:color-mix(in_srgb,var(--accent)_45%,var(--line-strong))] focus-visible:ring-3 focus-visible:ring-[color:var(--accent-soft)] disabled:opacity-50";
