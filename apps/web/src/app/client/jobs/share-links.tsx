"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** design/tats's share-the-post links: one per channel Analytics names. Copying
 *  one stamps ?utm_source=<channel> on the public link, so a share that lands
 *  is recorded as that channel when someone applies (lib/public/channel.ts). */
const SHARE = [
  ["linkedin", "LinkedIn"],
  ["hackernews", "HN"],
  ["x", "X"],
  ["indeed", "Indeed"],
  ["wellfound", "Wellfound"],
  ["blind", "Blind"],
  ["google", "Google"],
] as const;

export function ShareLinks({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const link = (channel: string) => `${url}${url.includes("?") ? "&" : "?"}utm_source=${channel}`;
  return (
    <span className="relative">
      <button
        type="button"
        aria-label="Copy a link tagged for a channel"
        title="Share links"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center rounded-full px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Share
        <svg viewBox="0 0 10 10" className="ml-1 size-2.5" aria-hidden><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open ? (
        <span className="absolute right-0 top-8 z-20 flex w-36 flex-col border border-[color:var(--line-strong)] bg-raised p-1 shadow-[var(--pop-shadow)]">
          {SHARE.map(([channel, label]) => (
            <button
              key={channel}
              type="button"
              className={cn("flex items-center justify-between px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-accent")}
              onClick={() => {
                void navigator.clipboard.writeText(link(channel)).then(() => {
                  setCopied(channel);
                  setTimeout(() => setCopied(null), 1500);
                  setOpen(false);
                });
              }}
            >
              {label}
              {copied === channel ? <span className="text-[11px] text-muted-foreground">copied</span> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
