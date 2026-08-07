import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The brand's pill: hairline outline, dimmed label, no fill — see
// Downloads/Tacit Brand Kit/05 Web/tokens.css .pill
export const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-3.5 py-0.5 text-[13px] tracking-[0.04em] whitespace-nowrap transition-all",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-[color:var(--pill-outline)] text-[color:rgba(var(--fg-rgb),0.6)]",
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
