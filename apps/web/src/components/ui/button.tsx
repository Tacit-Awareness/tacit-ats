import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/88",
        outline:
          "border-[color:var(--line-strong)] bg-surface hover:bg-accent hover:text-accent-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-[color:var(--soft-strong)]",
        ghost: "border-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-8 px-[13px]",
        sm: "h-[26px] rounded-[7px] px-2.5 text-xs",
        lg: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
