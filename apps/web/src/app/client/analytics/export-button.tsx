"use client";

import { buttonVariants } from "@/components/ui/button";

// design/tats's Export: the period's applications per day and channel as a
// CSV, built in the browser from the rows the page already has, so no route
// reads anything twice. Client only to hand the file over. Testbench's raised
// `.btn`, the same height as the range track beside it.

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function ExportButton({ rows, filename }: { rows: string[][]; filename: string }) {
  const download = () => {
    const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={download}
      title="Download this period's applications per day and channel as a CSV"
      className={buttonVariants({ variant: "outline" })}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 13.5h10" />
      </svg>
      Export
    </button>
  );
}
