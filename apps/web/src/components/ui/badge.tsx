import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Testbench's `.chip` and `.tag`: 6px corners, Geist Mono 12px, colour only
// when it means something (positive = now/done, negative = overdue or failed).
// The status tag with a tinted fill is `Pill` in components/page.tsx.
export const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[6px] border px-2 font-mono text-[12px] leading-none font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[color:var(--primary)] text-[color:var(--primary-ink)]",
        secondary: "border-transparent bg-[color:var(--soft-strong)] text-muted-foreground",
        outline: "border-[color:var(--line-strong)] text-muted-foreground",
        accent: "border-transparent bg-[color:var(--soft-strong)] text-foreground",
        positive: "border-transparent bg-positive-soft text-positive",
        negative: "border-transparent bg-negative-soft text-negative",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}
