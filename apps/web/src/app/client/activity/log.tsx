"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { KeyList, useKeyHelp, useKeys } from "@/components/keys";
import { Avatar, textLink } from "@/components/page";
import { groupByDay, matchesLog, type LinePart, type LogRow } from "@/lib/client/bot-activity";
import { cn } from "@/lib/utils";
import { dayWord } from "../candidates/local-day";
import { BotSteps } from "./steps";

// The log (design/tats's `.af-list`): one line a task, under its day, newest
// first, with the search box above it. The search filters what the page has,
// in this browser, so a candidate's name never goes in a URL. Days and times
// are the browser's own: the server renders how long ago, and the first paint
// matches it (a null server snapshot, as candidates/local-day.tsx). A row opens
// in place to its steps: design/tats's run drawer, with what a task records.

const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

function Line({ parts }: { parts: LinePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : "b" in p ? (
          <b key={i} className="font-medium text-foreground">
            {p.b}
          </b>
        ) : (
          <span key={i} className="text-[color:var(--red)]">
            {p.bad}
          </span>
        ),
      )}
    </>
  );
}

function BadBadge({ state }: { state: LogRow["state"] }) {
  if (state !== "failed" && state !== "stuck") return null;
  return (
    <i className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-[color:var(--paper)] text-[color:var(--red)] shadow-[0_0_0_1px_var(--line-strong)]">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden>
        <path d={state === "failed" ? "M4.5 4.5l7 7M11.5 4.5l-7 7" : "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.8V8l2.2 1.3"} />
      </svg>
    </i>
  );
}

function Row({ row, time }: { row: LogRow; time: (iso: string) => string | null }) {
  return (
    <details className="group">
      <summary
        data-key-item
        tabIndex={0}
        className="grid cursor-pointer list-none grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3.5 px-4 py-2.5 transition-colors hover:bg-[color:var(--hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)] md:px-6 [&::-webkit-details-marker]:hidden"
      >
        <span className="relative size-9">
          <Avatar name={row.avatar} size="ticket" />
          <BadBadge state={row.state} />
        </span>
        <span className="min-w-0 text-[14.5px] leading-[1.4] break-words text-muted-foreground">
          <Line parts={row.line} />
        </span>
        <span className="text-[13px] whitespace-nowrap text-faint tabular-nums">{time(row.at) ?? row.age}</span>
      </summary>
      <div className="grid gap-2 pb-3 pl-[66px] pr-4 text-[13px] md:pl-[74px] md:pr-6">
        <p className="m-0 text-muted-foreground">{[row.status, row.job].filter(Boolean).join(" · ")}</p>
        {row.error ? <p className="m-0 break-words text-[color:var(--red)]">{row.error}</p> : null}
        {row.note ? <p className="m-0 text-muted-foreground">{row.note}</p> : null}
        {row.steps.length ? <BotSteps steps={row.steps} /> : <p className="m-0 text-faint">No steps reported.</p>}
        {row.candidateHref ? (
          <Link href={row.candidateHref} className={cn(textLink, "justify-self-start")}>
            Open candidate
          </Link>
        ) : null}
      </div>
    </details>
  );
}

export function BotLog({ rows, capped, max, now }: { rows: LogRow[]; capped: boolean; max: number; now: number }) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const zone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  const shown = useMemo(() => rows.filter((r) => matchesLog(r, query)), [rows, query]);
  const time = useMemo(() => {
    if (!zone) return () => null;
    const clock = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" });
    return (iso: string) => clock.format(new Date(iso));
  }, [zone]);
  const days = useMemo(() => (zone ? groupByDay(shown, (iso) => dayWord(iso, now, zone)) : [{ day: "", rows: shown }]), [shown, zone, now]);

  useKeys({ "/": () => box.current?.focus() });
  useKeyHelp("Grokbot Activity", [{ keys: "/", label: "Search the log" }]);

  return (
    <section aria-label="Log">
      <div className="flex flex-wrap items-center gap-2.5 border-t border-[color:var(--line)] px-4 py-3 md:px-6">
        <h2 className="m-0 text-[15px] font-semibold">Log</h2>
        <span className="flex-1" />
        <label className="flex h-7 w-full items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--paper)] pr-1.5 pl-2.5 text-faint focus-within:border-[color:var(--line-strong)] focus-within:shadow-[var(--shadow)] sm:w-[260px]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-[13px] shrink-0" aria-hidden>
            <path d="M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3" />
          </svg>
          <input
            ref={box}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search the log"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
        </label>
      </div>
      {rows.length ? (
        <KeyList title="Grokbot Activity" next="Next task" mode="focus" className="border-t border-[color:var(--line)] pb-2">
          {shown.length ? (
            days.map((d) => (
              <div key={d.day || "all"}>
                {d.day ? <h3 className="m-0 px-4 pt-4 pb-1.5 text-[13px] font-medium md:px-6">{d.day}</h3> : null}
                {d.rows.map((r) => (
                  <Row key={r.id} row={r} time={time} />
                ))}
              </div>
            ))
          ) : (
            <p className="m-0 px-4 py-6 text-[13px] text-muted-foreground md:px-6">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          )}
        </KeyList>
      ) : (
        <p className="m-0 border-t border-[color:var(--line)] px-4 py-6 text-[13px] text-muted-foreground md:px-6">
          Nothing yet. Once your company&apos;s bot reports its work, it shows up here.
        </p>
      )}
      {capped ? <p className="m-0 px-4 pb-3 text-[12.5px] text-faint md:px-6">Showing the newest {max} tasks. Search covers these.</p> : null}
    </section>
  );
}
