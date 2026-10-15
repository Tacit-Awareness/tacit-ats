import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field flex min-h-16 w-full px-[11px] py-2 text-[14.5px] leading-[1.65]",
        className,
      )}
      {...props}
    />
  );
}
