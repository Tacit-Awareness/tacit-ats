import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field h-[38px] w-full min-w-0 px-[11px] py-2 text-[14.5px] disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}
