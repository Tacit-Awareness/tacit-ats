import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The testbench's status pill: a soft grey chip, the colour carried by the label.
export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full bg-[rgb(24_24_27/0.05)] px-2.5 py-0.5 text-[13px] leading-[19px] font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-dark text-[#fafafa]",
        secondary: "text-text",
        outline: "text-muted-foreground",
        accent: "text-primary",
        positive: "text-positive",
        negative: "text-negative",
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
