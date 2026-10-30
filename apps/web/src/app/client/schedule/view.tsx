"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { FilterMenu } from "@/components/filter-menu";
import { useKeyHelp, useKeys, type KeyHandler } from "@/components/keys";
import { Avatar, Empty, Notice, Page, PageBar, SearchBox } from "@/components/page";
import {
  daysOf,
  hourSpan,
  monthCells,
  placeDay,
  SCHEDULE_KEYS,
  scheduleHref,
  scheduleKeyHref,
  stepAnchor,
  todayIn,
  weekdayOf,
  zoned,
  type EventTone,
  type MonthCell,
  type Placed,
  type ScheduleView as View,
  type Ymd,
} from "@/lib/client/schedule-layout";
import { searchOrder } from "@/lib/client/schedule-search";
import { cn } from "@/lib/utils";

// The Calendar's markup, props only (page.tsx does the read): design/tats's
// calendar page, edge to edge under its bar with no card: the search in the
// bar, the controls row (Today and the joined arrows, the dates, the department
// menu, the view pills), then a day or week grid, the month grid, or the month
// as its interviews table. A search swaps the dates and the grid for one table
// of every date's matches. A client component because it lays the interviews
// out in the browser's own time zone, which the server does not know; until it
// has the zone (the server render, and the first paint) it draws the frame with
// no times in it, never UTC by mistake. Navigation is in the URL (`?view=`,
// `?date=`, `?dept=`, `?q=`), with D / W / M / L, ← / →, `.` for today and `/`
// for the search. Each event opens the interview on the Interviews page.

export type CalendarEvent = {
  id: string;
  href: string;
  candidate: string;
  step: string;
  job: string;
  /** The outermost department's name, when the member may read it. */
  department: string | null;
  interviewers: string[];
  location: string | null;
  /** The location as a link, only when it reads as an http(s) URL. */
  locationHref: string | null;
  startsAt: string;
  endsAt: string;
  tone: EventTone;
};

const TONE: Record<EventTone, string> = {
  blue: "bg-[color:var(--ev-blue)] text-[color:var(--ev-blue-ink)]",
  mint: "bg-[color:var(--ev-mint)] text-[color:var(--ev-mint-ink)]",
  pink: "bg-[color:var(--ev-pink)] text-[color:var(--ev-pink-ink)]",
  peach: "bg-[color:var(--ev-peach)] text-[color:var(--ev-peach-ink)]",
  lav: "bg-[color:var(--ev-lav)] text-[color:var(--ev-lav-ink)]",
  gray: "bg-[color:var(--ev-gray)] text-[color:var(--ev-gray-ink)]",
};
const DOT: Record<EventTone, string> = {
  blue: "bg-[color:var(--ev-blue-ink)]",
  mint: "bg-[color:var(--ev-mint-ink)]",
  pink: "bg-[color:var(--ev-pink-ink)]",
  peach: "bg-[color:var(--ev-peach-ink)]",
  lav: "bg-[color:var(--ev-lav-ink)]",
  gray: "bg-[color:var(--ev-gray-ink)]",
};

/** Pixels an hour: an hour's interview shows who, when, and the step. */
const HOUR_PX = 56;
/** A block's lines after the candidate, each shown once the block is this tall. */
const LINE_AT = { time: 36, detail: 52, interviewers: 68, location: 84 } as const;
const VIEWS: { key: View; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "list", label: "List" },
];

const hrefFor = (view: View, date: Ymd | null, dept: string | null, q?: string | null) => scheduleHref({ view, date, dept, q });

/** design/tats's `.cx-btn`: 32px, radius 8, the strong hairline. */
const cxBtn =
  "inline-flex h-8 items-center justify-center gap-2 border border-[color:var(--line-strong)] bg-[color:var(--paper)] text-[13.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-[color:var(--hover)]";
const arrow = (d: string) => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The browser's zone. The server snapshot is null: the server must not guess one.
const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/** A calendar date in words, in the member's locale (noon UTC, so no zone can move the day). */
const dayWords = (ymd: Ymd, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

function titleOf(view: View, days: Ymd[], shown: Ymd): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (view === "day") return dayWords(first, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // The month's grid starts in the month before, more often than not.
  if (view === "month" || view === "list" || first.slice(0, 7) === last.slice(0, 7)) return dayWords(shown, { month: "long", year: "numeric" });
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${dayWords(first, { month: "short" })} – ${dayWords(last, { month: "short", year: "numeric" })}`
    : `${dayWords(first, { month: "short", year: "numeric" })} – ${dayWords(last, { month: "short", year: "numeric" })}`;
}

function useClock(timeZone: string) {
  // design/tats's 24-hour clock, "09:30".
  const time = React.useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [timeZone]);
  return (iso: string) => time.format(new Date(iso));
}

function EventBlock({ placed, clock }: { placed: Placed<CalendarEvent>; clock: (iso: string) => string }) {
  const { event: e, start, end, lane, lanes } = placed;
  const height = Math.max(20, ((end - start) / 60) * HOUR_PX - 2);
  const tight = height < LINE_AT.time;
  const time = `${clock(e.startsAt)} – ${clock(e.endsAt)}`;
  const detail = [e.step, e.job].filter(Boolean).join(" · ");
  return (
    <Link
      href={e.href}
      title={[e.candidate, time, detail, e.interviewers.join(", "), e.location].filter(Boolean).join("\n")}
      style={{ top: (start / 60) * HOUR_PX + 1, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
      className={cn(
        "absolute z-[2] flex flex-col gap-px overflow-hidden rounded-lg px-2 text-xs leading-[1.3] transition-[filter,box-shadow] hover:z-[3] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] hover:brightness-[0.98] hover:saturate-[1.15]",
        tight ? "justify-center py-0.5" : "py-1.5",
        TONE[e.tone],
      )}
    >
      {tight ? (
        <span className="truncate">
          <b className="font-semibold">{e.candidate}</b> <span className="opacity-90">{clock(e.startsAt)}</span>
        </span>
      ) : (
        <>
          <b className="truncate text-[12.5px] font-semibold">{e.candidate}</b>
          <span className="truncate opacity-90">{time}</span>
          {height >= LINE_AT.detail ? <span className="truncate opacity-90">{detail}</span> : null}
          {height >= LINE_AT.interviewers && e.interviewers.length ? <span className="truncate opacity-90">{e.interviewers.join(", ")}</span> : null}
          {height >= LINE_AT.location && e.location ? <span className="truncate opacity-90">{e.location}</span> : null}
        </>
      )}
    </Link>
  );
}

function TimeGrid({ days, events, timeZone, today, now }: { days: Ymd[]; events: CalendarEvent[]; timeZone: string; today: Ymd; now: number }) {
  const clock = useClock(timeZone);
  const columns = days.map((day) => ({ day, placed: placeDay(events, day, timeZone) }));
  const { first, last } = hourSpan(columns.flatMap((c) => c.placed));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const nowAt = zoned(now, timeZone);
  const cols = { gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-x-auto">
      <div className={cn(days.length > 1 && "min-w-[720px]")}>
        <div className="grid border-b border-[color:var(--line)]" style={cols}>
          <span />
          {days.map((d) => (
            <div key={d} className="flex h-[52px] items-center gap-2 border-l border-[color:var(--line)] px-3.5">
              <span className={cn("text-xs tracking-[0.04em] uppercase", d === today ? "text-[color:var(--accent)]" : "text-faint")}>
                {dayWords(d, { weekday: "short" })}
              </span>
              <b
                className={cn(
                  "text-base font-medium tabular-nums",
                  d === today && "inline-grid h-[26px] min-w-[26px] place-items-center rounded-[7px] bg-[color:var(--accent)] px-1.5 text-[color:var(--accent-ink)]",
                )}
              >
                {Number(d.slice(8))}
              </b>
            </div>
          ))}
        </div>
        <div className="relative grid" style={{ ...cols, height: hours.length * HOUR_PX }}>
          <div className="relative">
            {hours.map((h, i) => (
              <span
                key={h}
                className={cn("absolute right-2.5 text-xs text-faint tabular-nums", i > 0 && "-translate-y-1/2")}
                style={{ top: i === 0 ? 4 : i * HOUR_PX }}
              >
                {`${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {columns.map(({ day, placed }) => (
            <div
              key={day}
              className={cn("relative min-w-0 overflow-hidden border-l border-[color:var(--line)]", weekdayOf(day) % 6 === 0 && "bg-[color:color-mix(in_srgb,var(--soft)_55%,transparent)]")}
            >
              {hours.map((h, i) => (i > 0 ? <i key={h} className="absolute inset-x-0 h-px bg-[color:var(--line)]" style={{ top: i * HOUR_PX }} /> : null))}
              {/* Placed in minutes from midnight; the grid starts at `first`. */}
              <div className="absolute inset-x-0" style={{ top: -first * HOUR_PX, height: 24 * HOUR_PX }}>
                {placed.map((p) => (
                  <EventBlock key={p.event.id} placed={p} clock={clock} />
                ))}
                {day === nowAt.day && nowAt.minutes >= first * 60 && nowAt.minutes <= last * 60 ? (
                  <em
                    aria-hidden
                    className="absolute -left-px right-0 z-[3] h-0.5 bg-[color:var(--red)] before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:bg-[color:var(--red)]"
                    style={{ top: (nowAt.minutes / 60) * HOUR_PX }}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** design/tats's month (`.mo-grid`): six weeks, a day's first three interviews, the rest in its day view. */
function MonthGrid({ cells, timeZone, today, dept }: { cells: MonthCell<CalendarEvent>[]; timeZone: string; today: Ymd; dept: string | null }) {
  const clock = useClock(timeZone);
  return (
    <>
      <div aria-hidden className="grid grid-cols-7 border-b border-[color:var(--line)]">
        {cells.slice(0, 7).map((c) => (
          <span key={c.day} className="px-1.5 py-2.5 text-xs tracking-[0.04em] text-faint uppercase md:px-3 md:text-[13px]">
            {dayWords(c.day, { weekday: "short" })}
          </span>
        ))}
      </div>
      <ul aria-label="Month" className="m-0 grid list-none auto-rows-fr grid-cols-7 p-0">
        {cells.map((c) => {
          const isToday = c.day === today;
          const dayHref = hrefFor("day", c.day, dept);
          const count = c.events.length;
          return (
            <li
              key={c.day}
              className={cn(
                "grid min-h-16 min-w-0 content-start gap-[3px] border-r border-b border-[color:var(--line)] px-1 pt-1.5 pb-2 md:min-h-28 md:px-1.5 [&:nth-child(7n)]:border-r-0",
                !c.inMonth && "bg-[color:color-mix(in_srgb,var(--soft)_55%,transparent)]",
              )}
            >
              <Link
                href={dayHref}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${dayWords(c.day, { weekday: "long", month: "long", day: "numeric" })}, ${count} ${count === 1 ? "interview" : "interviews"}`}
                className={cn(
                  "justify-self-start rounded-md px-1.5 py-0.5 text-[13px] font-medium tabular-nums md:text-sm",
                  isToday ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]" : "hover:bg-[color:var(--hover)]",
                  !isToday && !c.inMonth && "text-faint",
                )}
              >
                {Number(c.day.slice(8))}
              </Link>
              {c.listed.map((e) => (
                <Link
                  key={e.id}
                  href={e.href}
                  title={[e.candidate, `${clock(e.startsAt)} – ${clock(e.endsAt)}`, [e.step, e.job].filter(Boolean).join(" · "), e.interviewers.join(", "), e.location].filter(Boolean).join("\n")}
                  className="flex h-[22px] min-w-0 items-center gap-[5px] rounded-[5px] px-[5px] text-[12.5px] text-foreground transition-colors hover:bg-[color:var(--hover)] max-md:hidden"
                >
                  <i aria-hidden className={cn("size-[7px] flex-none rounded-[2px]", DOT[e.tone])} />
                  <span className="truncate">
                    <span className="tabular-nums">{clock(e.startsAt)}</span> {e.candidate}
                  </span>
                </Link>
              ))}
              {c.more ? (
                <Link href={dayHref} className="px-1.5 text-[11.5px] text-faint transition-colors hover:text-foreground max-md:hidden">
                  {c.more} more
                </Link>
              ) : null}
              {/* Too narrow for names on a phone: the count, and the date opens the day. */}
              {count ? (
                <span aria-hidden className="flex items-center gap-1 px-1.5 text-[11.5px] text-faint tabular-nums md:hidden">
                  <i className={cn("size-[7px] flex-none rounded-[2px]", DOT[c.events[0]!.tone])} />
                  {count}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The key under a grid: the departments of the interviews in view. */
function Legend({ tones, gutter }: { tones: Map<string, EventTone>; gutter: boolean }) {
  if (!tones.size) return null;
  return (
    <ul aria-label="Departments" className={cn("m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-[color:var(--line)] py-2.5 pr-5 text-xs text-faint", gutter ? "pl-16" : "pl-5")}>
      {[...tones].map(([name, tone]) => (
        <li key={name} className="flex items-center gap-1.5">
          <i aria-hidden className={cn("size-2.5 rounded-[3px]", DOT[tone])} />
          {name}
        </li>
      ))}
    </ul>
  );
}

/** design/tats's `.cx-pill`: booked green with a tick, past grey with a clock. */
function StatusPill({ past }: { past: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border pr-[9px] pl-1 text-[13px] font-medium whitespace-nowrap",
        past
          ? "border-[color:var(--line)] bg-[color:var(--soft)] text-muted-foreground"
          : "border-[color:color-mix(in_srgb,var(--green)_25%,transparent)] bg-[color:var(--green-soft)] text-positive",
      )}
    >
      <i aria-hidden className={cn("grid size-4 place-items-center rounded-full text-white", past ? "bg-[color:var(--faint)]" : "bg-[color:var(--green)]")}>
        <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d={past ? "M8 4.5V8l2.5 1.5" : "m3.5 8.5 3 3 6-7"} />
        </svg>
      </i>
      {past ? "Past" : "Booked"}
    </span>
  );
}

const CT_GRID = "grid grid-cols-[110px_minmax(150px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)_120px_110px_minmax(160px,1.2fr)] items-center gap-3.5 px-5";

/** design/tats's interviews table (`.ct-row`): the rows in the order given, each opening the interview. */
function ListOf({ rows, timeZone, now, empty }: { rows: CalendarEvent[]; timeZone: string; now: number; empty: string }) {
  const clock = useClock(timeZone);
  return (
    <section aria-label="Interviews" className="pb-10">
      <h2 className="m-0 flex items-center gap-2.5 px-5 py-3.5 text-[15px] font-semibold">
        Interviews <span className="font-normal text-faint tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <Empty className="border-t border-[color:var(--line)] px-5 py-3 [overflow-wrap:anywhere]">{empty}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <div role="table" aria-label="Interviews" className="grid min-w-[980px]">
            <div role="row" className={cn(CT_GRID, "min-h-[38px] border-t border-[color:var(--line)] bg-[color:var(--soft)] text-[12.5px] text-muted-foreground")}>
              {["Status", "Applicant", "Round", "Interviewer", "Date", "Time", "Where"].map((h) => (
                <span key={h} role="columnheader">
                  {h}
                </span>
              ))}
            </div>
            {rows.map((e) => {
              const day = dayWords(zoned(e.startsAt, timeZone).day, { month: "short", day: "numeric", year: "numeric" });
              const time = `${clock(e.startsAt)} – ${clock(e.endsAt)}`;
              const [lead, ...more] = e.interviewers;
              return (
                <div role="row" key={e.id} className={cn(CT_GRID, "relative min-h-[52px] border-t border-[color:var(--line)] text-[13px] transition-colors hover:bg-[color:var(--hover)]")}>
                  {/* The whole row opens the interview; the location link sits above it. */}
                  <Link href={e.href} aria-label={`${e.candidate}, ${e.step}, ${day} ${time}`} className="absolute inset-0" />
                  <span role="cell">
                    <StatusPill past={Date.parse(e.endsAt) <= now} />
                  </span>
                  <span role="cell" className="flex min-w-0 items-center gap-2">
                    <Avatar name={e.candidate} size="lg" candidate />
                    <span className="truncate">{e.candidate}</span>
                  </span>
                  <span role="cell" className="flex min-w-0 items-center gap-2" title={[e.step, e.job, e.department].filter(Boolean).join(" · ")}>
                    <i aria-hidden className={cn("size-2 flex-none rounded-full", DOT[e.tone])} />
                    <span className="truncate">
                      {e.step}
                      <span className="text-muted-foreground"> · {e.job}</span>
                    </span>
                  </span>
                  <span role="cell" className="flex min-w-0 items-center gap-2" title={e.interviewers.join(", ") || undefined}>
                    {lead ? (
                      <>
                        <Avatar name={lead} size="lg" />
                        <span className="truncate">{lead}</span>
                        {more.length ? <span className="flex-none text-xs text-faint">+{more.length}</span> : null}
                      </>
                    ) : (
                      <span className="text-faint">No interviewer listed</span>
                    )}
                  </span>
                  <span role="cell" className="whitespace-nowrap tabular-nums">
                    {day}
                  </span>
                  <span role="cell" className="whitespace-nowrap tabular-nums">
                    {time}
                  </span>
                  <span role="cell" className="min-w-0 truncate">
                    {e.location ? (
                      e.locationHref ? (
                        <a href={e.locationHref} target="_blank" rel="noopener noreferrer" className="relative z-[1] text-foreground/75 hover:text-[color:var(--accent)]">
                          {e.location}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{e.location}</span>
                      )
                    ) : (
                      <span className="text-faint">Not set</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function ScheduleView({
  view,
  anchor,
  events,
  departments,
  dept,
  q,
  truncated,
}: {
  view: View;
  /** The `?date=`; null is the browser's today. */
  anchor: Ymd | null;
  /** A window wider than the view, so it holds the view's days in any zone; in a search, every date's matches. */
  events: CalendarEvent[];
  /** The department menu's choices; empty hides it (an interviewer reads no department names). */
  departments: string[];
  /** The `?dept=`, one of `departments`; null is everyone's. */
  dept: string | null;
  /** The `?q=`; null is the calendar, anything else the table of matches. */
  q: string | null;
  truncated: boolean;
}) {
  const router = useRouter();
  const timeZone = React.useSyncExternalStore(noSubscribe, browserZone, serverZone);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const today = timeZone ? todayIn(timeZone, now) : null;
  const shown = anchor ?? today;

  // Every key is a shortcut for a link here; `/` puts the cursor in the search.
  const search = React.useRef<HTMLDivElement>(null);
  const bindings: Record<string, KeyHandler> = {
    "/": () => {
      const input = search.current?.querySelector<HTMLInputElement>('input[name="q"]');
      input?.focus();
      input?.select();
    },
  };
  if (shown) {
    for (const key of SCHEDULE_KEYS) {
      const href = scheduleKeyHref(key, { view, anchor, shown, dept, q });
      if (href) bindings[key] = () => router.push(href);
    }
  }
  useKeys(bindings);
  useKeyHelp("Calendar", [
    { keys: "D / W / M / L", label: "Day, week, month, list" },
    ...(q ? [] : [{ keys: "← / →", label: "Previous, next" }]),
    { keys: ".", label: "Today" },
    { keys: "/", label: "Search interviews" },
  ]);

  const days = shown ? daysOf(view, shown) : [];
  const inDept = events.filter((e) => !dept || e.department === dept);
  const inView =
    timeZone && days.length ? inDept.filter((e) => zoned(e.startsAt, timeZone).day <= days.at(-1)! && zoned(e.endsAt, timeZone).day >= days[0]!) : [];
  const cells = timeZone && shown && view === "month" && !q ? monthCells(inDept, shown, timeZone) : [];
  // The month shows an interview on the day it starts, so one still running into its first day is not in it.
  const visible = q ? inDept : view === "month" ? cells.flatMap((c) => c.events) : inView;
  // The key: the departments of the interviews in view, for whoever may read their names.
  const legend = new Map<string, EventTone>();
  for (const e of visible) if (e.department) legend.set(e.department, e.tone);
  if (legend.size && visible.some((e) => !e.department)) legend.set("No department", "gray");
  const inOrder = [...inView].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));

  return (
    <Page
      bar={
        <PageBar title="Calendar">
          <div ref={search} className="contents">
            {/* Keyed by the search: the box holds what it was given, and the URL can change under it. */}
            <SearchBox key={q ?? ""} action="/client/schedule" defaultValue={q ?? ""} placeholder="Search interviews…" label="Search interviews" keep={{ view, date: anchor, dept }} />
          </div>
        </PageBar>
      }
      bleed
      className="grid-cols-[minmax(0,1fr)]"
    >
      {/* Wraps at every width: beside the sidebar a long department name would push the pills off the edge. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--line)] px-3 py-2.5 md:px-5 md:py-3">
        {q ? (
          <>
            <Link href={hrefFor(view, anchor, dept)} className={cn(cxBtn, "rounded-lg px-3")} title="Back to the calendar">
              Clear
            </Link>
            <h2 className="m-0 mr-1 ml-2 min-w-0 truncate text-[17px] font-medium tracking-[-0.014em] md:text-[19px]">Results for “{q}”</h2>
          </>
        ) : (
          <>
            <Link href={hrefFor(view, null, dept)} className={cn(cxBtn, "rounded-lg px-3")} title="Today (.)">
              Today
            </Link>
            <span className="inline-flex">
              <Link
                href={shown ? hrefFor(view, stepAnchor(view, shown, -1), dept) : "#"}
                aria-label="Previous"
                title="Previous (←)"
                className={cn(cxBtn, "rounded-l-lg px-[11px]")}
              >
                {arrow("M10 3.5 5.5 8l4.5 4.5")}
              </Link>
              <Link
                href={shown ? hrefFor(view, stepAnchor(view, shown, 1), dept) : "#"}
                aria-label="Next"
                title="Next (→)"
                className={cn(cxBtn, "-ml-px rounded-r-lg px-[11px]")}
              >
                {arrow("M6 3.5 10.5 8 6 12.5")}
              </Link>
            </span>
            <h2 className="m-0 mr-1 ml-2 text-[17px] font-medium tracking-[-0.014em] whitespace-nowrap md:text-[19px]">{days.length && shown ? titleOf(view, days, shown) : " "}</h2>
          </>
        )}
        {timeZone ? <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground min-[1100px]:inline">{timeZone.replace(/_/g, " ")}</span> : null}
        <span className="min-w-2 flex-1" />
        {departments.length ? (
          <FilterMenu
            label="Department"
            value={dept ?? "Everyone"}
            on={dept !== null}
            options={[
              { href: hrefFor(view, anchor, null, q), label: "Everyone", active: dept === null },
              ...departments.map((d) => ({ href: hrefFor(view, anchor, d, q), label: d, active: dept === d })),
            ]}
          />
        ) : null}
        <nav aria-label="View" className="flex gap-1.5 max-md:order-last max-md:w-full">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={hrefFor(v.key, anchor, dept)}
              aria-current={!q && v.key === view ? "page" : undefined}
              title={`${v.label} (${v.key[0]!.toUpperCase()})`}
              className={cn(
                "inline-flex h-8 items-center rounded-2xl border px-3.5 text-[14px] whitespace-nowrap transition-colors",
                !q && v.key === view
                  ? "border-transparent bg-[color:var(--soft-strong)] font-medium text-foreground"
                  : "border-[color:var(--line-strong)] font-[450] text-foreground hover:bg-[color:var(--hover)]",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
      {truncated ? (
        <Notice className="mx-5 mt-3">
          {q ? "Too many interviews to search them all; the oldest are left out." : "Too many interviews to show at once here; some later ones are left off. Try the day or week view."}
        </Notice>
      ) : null}
      {!timeZone || !today ? (
        <div aria-busy className="h-[668px]" />
      ) : q ? (
        <ListOf rows={searchOrder(inDept, now)} timeZone={timeZone} now={now} empty={`No interviews match “${q}”.`} />
      ) : view === "list" ? (
        <ListOf rows={inOrder} timeZone={timeZone} now={now} empty="No interviews this month." />
      ) : (
        <div className="pb-10">
          {view === "month" ? <MonthGrid cells={cells} timeZone={timeZone} today={today} dept={dept} /> : <TimeGrid days={days} events={inView} timeZone={timeZone} today={today} now={now} />}
          {visible.length ? null : <Empty className="border-t border-[color:var(--line)] px-5 py-3">No interviews this {view}.</Empty>}
          <Legend tones={legend} gutter={view !== "month"} />
        </div>
      )}
    </Page>
  );
}
