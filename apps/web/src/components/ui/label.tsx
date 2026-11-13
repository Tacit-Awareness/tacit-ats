import * as React from "react";

import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 font-mono text-[13px] leading-[18px] font-medium text-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}
