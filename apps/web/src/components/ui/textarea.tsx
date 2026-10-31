import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full border border-input bg-frame px-[11px] py-2 text-[13px] leading-relaxed transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 hover:border-[color:var(--hairline)] focus-visible:border-[color:var(--green)] focus-visible:ring-3 focus-visible:ring-[color:color-mix(in_srgb,var(--green-bright)_18%,transparent)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
