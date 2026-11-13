import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full border-0 bg-[color:var(--paper)] px-3 py-2.5 text-[13px] leading-relaxed shadow-[inset_0_0_0_1px_var(--field)] transition-shadow duration-150 outline-none placeholder:text-faint hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
