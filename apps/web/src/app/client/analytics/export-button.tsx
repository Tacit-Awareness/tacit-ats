"use client";

// design/tats's Export: the period's applications per day and channel as a
// CSV, built in the browser from the rows the page already has, so no route
// reads anything twice. Client only to hand the file over.

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
      className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[color:var(--line-strong)] bg-[color:var(--paper)] px-3 text-[13.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-[color:var(--hover)]"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[15px] text-muted-foreground" aria-hidden>
        <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 13.5h10" />
      </svg>
      Export
    </button>
  );
}
