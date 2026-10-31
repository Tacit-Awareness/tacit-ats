"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DigestSource } from "@/lib/client/inbox-digest";

// design/tats's opening of the Inbox (`ibThink`), without its Grokbot: the card
// ticks off what this read really covered, with the counts it found, then lays
// out the rows. Under a second. The motion is CSS (globals.css, `.inbox-opening`),
// so a server render starts it and reduced motion never sees it; this only ends
// it. `play` counts on mount alone: a range change or a closed pop-up keeps the
// card mounted and doesn't replay it. A click or a key skips to the end.

const OPENING_MS = 900;

export function OpeningCard({ play, sources, reading, worth, range, children }: { play: boolean; sources: DigestSource[]; reading: string; worth: string; range: ReactNode; children: ReactNode }) {
  const [opening, setOpening] = useState(play);
  useEffect(() => {
    if (!opening) return;
    const done = window.setTimeout(() => setOpening(false), OPENING_MS);
    return () => window.clearTimeout(done);
  }, [opening]);
  const skip = () => setOpening(false);

  return (
    <section
      data-tour="inbox"
      data-inbox-card
      tabIndex={-1}
      aria-labelledby="inbox-title"
      onClickCapture={skip}
      onKeyDownCapture={skip}
      className={`${opening ? "inbox-opening " : ""}mx-auto grid w-[760px] max-w-full grid-cols-[minmax(0,1fr)] gap-5 bg-[color:var(--raised)] p-4 pb-3 shadow-[var(--shadow)] outline-none sm:p-6 sm:pb-3`}
    >
      <header className="flex flex-col gap-x-4 gap-y-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <h1 id="inbox-title" className="m-0 text-[18px] font-semibold tracking-[-0.01em]">
            Welcome back
          </h1>
          <p className="m-0 text-[14.5px] text-muted-foreground">
            <span className="opening-worth">{worth}</span>
            {opening ? (
              <span aria-hidden className="opening-reading">
                {reading}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{range}</div>
      </header>
      {opening ? (
        <div aria-hidden className="opening-sources">
          {sources.map((s, i) => (
            <div key={s.label} className="opening-source" style={{ "--n": i } as React.CSSProperties}>
              <span className="min-w-0 truncate text-[13.5px] font-medium">{s.label}</span>
              <span className="text-[12.5px] text-faint tabular-nums">{s.count.toLocaleString("en-US")}</span>
              <span className="opening-tick">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                  <path d="m3.5 8.5 3 3 6-7" />
                </svg>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </section>
  );
}
