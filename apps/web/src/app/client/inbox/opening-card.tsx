"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { KeyList } from "@/components/keys";
import { OptionCount, StatusGlyph, pillOption, pillTrack } from "@/components/page";
import type { DigestSource } from "@/lib/client/inbox-digest";
import { cn } from "@/lib/utils";
import { RowKeys } from "./set-aside";
import type { SectionKey } from "./sections";
import "./inbox.css";

// The Inbox card, and its opening (design/tats's `ibThink`, without its
// Grokbot). Every time the Inbox opens the card pops in and reads: each source
// it really covered lights up in turn, turns while it is read and ticks off with
// what it found, then the panel folds away and the sections arrive one entry
// after another. About a second and a half. The motion is CSS (inbox.css), so a
// server render starts it and reduced motion never sees it; this only ends it.
// `play` counts on mount alone: a filter, a closed pop-up or a dismiss keeps the
// card mounted and doesn't replay it. A click or a key skips to the end.
//
// The card is Testbench's: white, 14px, Welcome back and the filter on one row,
// nothing under the title. What the read found worth the member's time is the
// title's hover, and what it is reading the panel's, since Testbench puts no
// summary line under a title. The filter shows all three sections or one; it is
// state here (a pop-up, a dismiss and a refresh all keep it) and the URL's
// `?show=` too, so a link can open on one.

/** The opening's beats, in ms: each source's read, the pause after the last, the fold. inbox.css spends them. */
const START = 200;
const STEP = 100;
const PAUSE = 100;
const FOLD = 150;
/** Entries arrive this far apart, the first eight of them; each takes RISE. */
const STAGGER = 25;
const RISE = 260;

export type CardSection = { key: SectionKey; label: string; count: number; body: ReactNode };
type Show = SectionKey | "all";

export function OpeningCard({
  play,
  sources,
  reading,
  worth,
  sections,
  show: initial,
  popup,
  flash,
  foot,
}: {
  play: boolean;
  sources: DigestSource[];
  reading: string;
  worth: string;
  /** Empty when there is nothing at all, and `foot` says so. */
  sections: CardSection[];
  show: SectionKey | null;
  /** J and K open the next entry in a pop-up, and only move focus over the card. */
  popup: boolean;
  flash: ReactNode;
  foot: ReactNode;
}) {
  const reveal = START + sources.length * STEP + PAUSE + FOLD;
  const [opening, setOpening] = useState(play);
  useEffect(() => {
    if (!opening) return;
    const done = window.setTimeout(() => setOpening(false), reveal + 8 * STAGGER + RISE + 40);
    return () => window.clearTimeout(done);
  }, [opening, reveal]);
  const skip = () => setOpening(false);

  const [show, setShow] = useState<Show>(initial ?? "all");
  const pick = (next: Show) => {
    setShow(next);
    // The URL says it too, so a refresh or a copied link opens on the same section. No navigation: nothing is read again.
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("show");
    else url.searchParams.set("show", next);
    window.history.replaceState(window.history.state, "", url);
  };
  const options: { key: Show; label: string; count: number | null }[] = [{ key: "all", label: "All", count: null }, ...sections.map((s) => ({ key: s.key, label: s.label, count: s.count }))];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // A tablist's arrows: left and right move along it and pick, as Testbench's `tabKeys`.
  const arrow = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + options.length) % options.length;
    pick(options[j]!.key);
    tabs.current[j]?.focus();
  };

  const shown = show === "all" ? sections : sections.filter((s) => s.key === show);

  return (
    <section
      data-tour="inbox"
      data-inbox-card
      tabIndex={-1}
      aria-labelledby="inbox-title"
      onClickCapture={skip}
      onKeyDownCapture={skip}
      style={{ "--start": `${START}ms`, "--step": `${STEP}ms`, "--fold-at": `${START + sources.length * STEP + PAUSE}ms`, "--reveal": `${reveal}ms`, "--stagger": `${STAGGER}ms` } as React.CSSProperties}
      className={`${opening ? "ibx-opening " : ""}ibx-card mx-auto grid w-[820px] max-w-full grid-cols-[minmax(0,1fr)] rounded-[14px] bg-card shadow-[var(--shadow)] outline-none`}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-6 pb-4">
        <h1 id="inbox-title" title={worth} className="m-0 font-sans text-[19px] leading-6 font-semibold tracking-[-0.01em]">
          Welcome back
        </h1>
        <span className="flex-1" />
        {sections.length ? (
          // Testbench's `.ib-head .seg`: the options a little apart, and a counted one wider on the right, so a count over its corner clears its own label and the next.
          <div role="tablist" aria-label="Show" className={cn(pillTrack, "gap-1.5")}>
            {options.map((o, i) => (
              <button
                key={o.key}
                ref={(b) => void (tabs.current[i] = b)}
                type="button"
                role="tab"
                aria-selected={show === o.key}
                tabIndex={show === o.key ? 0 : -1}
                aria-controls="inbox-sections"
                onClick={() => pick(o.key)}
                onKeyDown={(e) => arrow(e, i)}
                className={cn(pillOption(show === o.key, "sm"), o.count !== null && "pr-4")}
              >
                {o.label}
                {/* The counts wait for the read, as Testbench's do: inbox.css holds them back while the card opens, so reduced motion has them at once. */}
                {o.count !== null ? (
                  <span className="ibx-count">
                    <OptionCount>{o.count}</OptionCount>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {opening ? (
        <div aria-hidden title={reading} className="ibx-reading">
          {sources.map((s, i) => (
            <div key={s.label} className="ibx-src" style={{ "--n": i } as React.CSSProperties}>
              <span className="ibx-src-glyph">
                <span className="ibx-g-wait">
                  <StatusGlyph kind="empty" />
                </span>
                <span className="ibx-g-run">
                  <StatusGlyph kind="pending" />
                </span>
                <span className="ibx-g-done">
                  <StatusGlyph kind="done" />
                </span>
              </span>
              <span className="grid min-w-0 gap-0.5">
                <b className="truncate font-sans text-[14px] leading-5 font-semibold">{s.label}</b>
                <span className="ibx-src-n text-[12px] leading-4 text-faint tabular-nums">{s.count.toLocaleString("en-US")}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {flash ? <div className="px-6 pb-4">{flash}</div> : null}
      {/* The sections and the foot grow in together once the read is done (inbox.css), so no empty foot waits under the read. */}
      <div className="ibx-body">
        <div className="min-w-0">
          {sections.length ? (
            <div id="inbox-sections" role="tabpanel" aria-labelledby="inbox-title" className="px-3 pb-3">
              {/* J and K walk every entry shown: over the card they move focus and Enter opens, since a key shouldn't throw up a pop-up; in a pop-up they open the next one. */}
              <KeyList title="Inbox" next="Next row" mode={popup ? "select" : "focus"} className="grid grid-cols-[minmax(0,1fr)] content-start gap-3">
                {popup ? null : <RowKeys />}
                {shown.map((s) => s.body)}
              </KeyList>
            </div>
          ) : null}
          {foot}
        </div>
      </div>
    </section>
  );
}
