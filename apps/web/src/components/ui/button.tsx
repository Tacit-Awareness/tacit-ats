import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  // Tacit Tickets' `Btn`: 8px corners, the page's own face at 13px, a bordered face
  // (the inset ring); the primary is ink, a ghost has no face. A press settles to .98.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[8px] border-0 text-[13px] leading-none font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 select-none ease-[var(--ease)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[15px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color:var(--primary-hover)]",
        outline: "bg-[color:var(--paper)] text-foreground shadow-[var(--btn-ring)] hover:bg-[color:var(--hover)] [&_svg]:text-muted-foreground",
        secondary: "bg-[color:var(--soft-strong)] text-foreground hover:bg-[color:var(--press)]",
        ghost: "text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-[30px] rounded-[8px] px-2.5 text-[13px]",
        lg: "h-11 px-4 text-[14px]",
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
