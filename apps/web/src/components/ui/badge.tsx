import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The mockup's chip: a hairline pill, colour only when it means something
// (positive = now/done, negative = overdue or failed). The mono status pill
// with a tinted fill is `Pill` in components/page.tsx.
export const badgeVariants = cva(
  "inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-[color:var(--line)] text-foreground/75",
        accent: "border-transparent bg-[color:var(--soft-strong)] text-foreground",
        positive: "border-[color:color-mix(in_srgb,var(--green)_45%,transparent)] bg-positive-soft text-positive",
        negative: "border-[color:color-mix(in_srgb,var(--red)_45%,transparent)] bg-negative-soft text-negative",
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
