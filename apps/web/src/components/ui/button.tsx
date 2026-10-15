import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[7px] rounded-full border-0 font-medium whitespace-nowrap transition-[box-shadow,background-color,color,opacity] duration-150 outline-none select-none focus-visible:shadow-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        // Dark pill for the one primary action.
        default: "bg-dark text-[#fafafa] shadow-[0_0_0_1px_var(--dark)] hover:bg-[color:var(--dark-hover)]",
        // A white bubble for the rest.
        outline: "bg-card text-[#27272a] shadow-[var(--bubble)] hover:shadow-[var(--bubble-hover)]",
        secondary: "bg-card text-[#27272a] shadow-[var(--bubble)] hover:shadow-[var(--bubble-hover)]",
        ghost: "text-primary hover:bg-[rgb(29_111_165/0.07)]",
        danger: "bg-card text-negative shadow-[0_0_0_1px_rgb(180_35_24/0.25),inset_0_1px_0_#fff] hover:shadow-[0_0_0_1px_rgb(180_35_24/0.4),0_4px_12px_-4px_rgb(180_35_24/0.25)]",
      },
      size: {
        default: "px-[15px] py-2 text-sm leading-5",
        sm: "px-3 py-1.5 text-[13px] leading-[18px]",
        lg: "px-5 py-2.5 text-[15px] leading-5",
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
