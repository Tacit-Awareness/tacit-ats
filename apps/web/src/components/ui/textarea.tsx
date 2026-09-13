import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 hover:border-[color:var(--hairline)] focus-visible:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
