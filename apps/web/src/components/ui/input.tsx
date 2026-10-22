import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-frame px-[11px] py-1 text-[13px] transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 hover:border-[color:var(--hairline)] focus-visible:border-[color:var(--green)] focus-visible:ring-3 focus-visible:ring-[color:color-mix(in_srgb,var(--green-bright)_18%,transparent)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A native <select> styled like Input (the pages use plain selects, no Radix). */
export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-frame px-2.5 text-[13px] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--hairline)] focus-visible:border-[color:var(--green)] focus-visible:ring-3 focus-visible:ring-[color:color-mix(in_srgb,var(--green-bright)_18%,transparent)] disabled:opacity-50";
