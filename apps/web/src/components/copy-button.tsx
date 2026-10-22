"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** A small copy-to-clipboard icon button, like the one next to a contact detail. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cn(
        "relative z-10 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
          <path d="M5 10.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
          <rect x="7" y="7" width="9.5" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M13 4.5v-.5A1.5 1.5 0 0 0 11.5 2.5h-7A1.5 1.5 0 0 0 3 4v7a1.5 1.5 0 0 0 1.5 1.5H5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  );
}
