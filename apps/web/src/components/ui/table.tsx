import * as React from "react";

import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-[color:var(--line)] [&_tr:hover]:bg-transparent", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody data-slot="table-body" className={className} {...props} />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-[color:var(--line)] transition-colors last:border-0 hover:bg-[color:var(--surface)]",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-4 text-left align-middle font-mono text-[12px] font-normal whitespace-nowrap text-faint",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("h-12 px-4 align-middle whitespace-nowrap text-foreground", className)}
      {...props}
    />
  );
}
