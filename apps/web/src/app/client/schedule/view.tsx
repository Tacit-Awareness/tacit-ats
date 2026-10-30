"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Empty, Notice, Page, PageHeader, Segmented, Toolbar } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import {
  daysOf,
  groupByDay,
  hourSpan,
  placeDay,
  stepAnchor,
  todayIn,
  weekdayOf,
  zoned,
  type EventTone,
  type Placed,
  type ScheduleView as View,
  type Ymd,
} from "@/lib/client/schedule-layout";
import { cn } from "@/lib/utils";

// The Calendar's markup, props only (page.tsx does the read): a day or week
// grid like design/tats's, or the month as a list. A client component because
// it lays the interviews out in the browser's own time zone, which the server
// does not know; until it has the zone (the server render, and the first
// paint) it draws the frame with no times in it, never UTC by mistake.
// Navigation is in the URL (`?view=`, `?date=`), with D / W / L, ← / → and
// `.` for today. Each event opens the interview on the Interviews page.

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
  { key: "list", label: "List" },
];
const VIEW_KEYS: Record<string, View> = { d: "day", w: "week", l: "list" };

const hrefFor = (view: View, date: Ymd | null) => `/client/schedule?view=${view}${date ? `&date=${date}` : ""}`;

// The browser's zone. The server snapshot is null: the server must not guess one.
const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/** A calendar date in words, in the member's locale (noon UTC, so no zone can move the day). */
const dayWords = (ymd: Ymd, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

function titleOf(view: View, days: Ymd[]): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (view === "day") return dayWords(first, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (first.slice(0, 7) === last.slice(0, 7) || view === "list") return dayWords(first, { month: "long", year: "numeric" });
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${dayWords(first, { month: "short" })} – ${dayWords(last, { month: "short", year: "numeric" })}`
    : `${dayWords(first, { month: "short", year: "numeric" })} – ${dayWords(last, { month: "short", year: "numeric" })}`;
}

function useClock(timeZone: string) {
  const time = React.useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }), [timeZone]);
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
  const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" });
  const cols = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-x-auto rounded-[12px] border border-[color:var(--line)] bg-card">
      <div className={cn(days.length > 1 && "min-w-[720px]")}>
        <div className="grid border-b border-[color:var(--line)]" style={cols}>
          <span />
          {days.map((d) => (
            <div key={d} className="flex h-12 items-center gap-2 border-l border-[color:var(--line)] px-3">
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
                {hourLabel.format(Date.UTC(2000, 0, 1, h))}
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

function ListOf({ days, events, timeZone, today }: { days: Ymd[]; events: CalendarEvent[]; timeZone: string; today: Ymd }) {
  const clock = useClock(timeZone);
  const groups = groupByDay(events, days, timeZone);
  if (!groups.length) return <Empty>No interviews this month.</Empty>;
  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <section key={g.day} aria-label={dayWords(g.day, { weekday: "long", month: "long", day: "numeric" })} className="rounded-[12px] border border-[color:var(--line)] bg-card">
          <h2 className="m-0 flex items-center gap-2 border-b border-[color:var(--line)] px-4 py-2.5 text-[13.5px] font-semibold">
            {dayWords(g.day, { weekday: "short", month: "short", day: "numeric" })}
            {g.day === today ? <span className="text-xs font-normal text-[color:var(--accent)]">Today</span> : null}
          </h2>
          <ul className="m-0 list-none p-0">
            {g.events.map((e) => (
              <li key={e.id} className="flex min-w-0 items-center gap-3 border-t border-[color:var(--line)] px-2 first:border-t-0 max-md:flex-wrap">
                <Link
                  href={e.href}
                  className="grid min-w-0 flex-1 items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent md:grid-cols-[164px_minmax(0,1.2fr)_minmax(0,1fr)]"
                >
                  <span className="flex items-center gap-2 text-[13px] whitespace-nowrap text-foreground/80 tabular-nums">
                    <i aria-hidden className={cn("size-2 flex-none rounded-full", DOT[e.tone])} />
                    {clock(e.startsAt)} – {clock(e.endsAt)}
                  </span>
                  <span className="grid min-w-0">
                    <b className="truncate text-[13px] font-medium">{e.candidate}</b>
                    <span className="truncate text-xs text-muted-foreground">{[e.step, e.job].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{e.interviewers.join(", ") || "No interviewer listed"}</span>
                </Link>
                {e.location ? (
                  e.locationHref ? (
                    <a
                      href={e.locationHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="max-w-[220px] truncate px-2 pb-2 text-xs text-foreground/75 hover:text-[color:var(--accent)] md:pb-0"
                    >
                      {e.location}
                    </a>
                  ) : (
                    <span className="max-w-[220px] truncate px-2 pb-2 text-xs text-muted-foreground md:pb-0">{e.location}</span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ScheduleView({
  view,
  anchor,
  events,
  truncated,
}: {
  view: View;
  /** The `?date=`; null is the browser's today. */
  anchor: Ymd | null;
  /** A window wider than the view, so it holds the view's days in any zone. */
  events: CalendarEvent[];
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

  React.useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const to = VIEW_KEYS[e.key.toLowerCase()];
      let href: string | null = null;
      if (to) href = hrefFor(to, anchor);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") href = hrefFor(view, stepAnchor(view, shown, e.key === "ArrowLeft" ? -1 : 1));
      else if (e.key === ".") href = hrefFor(view, null);
      if (!href) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, view, anchor, shown]);

  const days = shown ? daysOf(view, shown) : [];
  const visible = timeZone && days.length ? events.filter((e) => zoned(e.startsAt, timeZone).day <= days.at(-1)! && zoned(e.endsAt, timeZone).day >= days[0]!) : [];
  // The key: the departments of the interviews in view, for whoever may read their names.
  const legend = new Map<string, EventTone>();
  for (const e of visible) if (e.department) legend.set(e.department, e.tone);
  if (legend.size && visible.some((e) => !e.department)) legend.set("No department", "gray");
  const navBtn = buttonVariants({ variant: "outline", className: "h-[30px] px-2.5 font-normal" });

  return (
    <Page className="max-w-[1400px]">
      <PageHeader
        title="Calendar"
        subtitle={timeZone ? `Interviews you can see, in your time zone (${timeZone.replace(/_/g, " ")}).` : "Interviews you can see."}
        actions={<Segmented label="View" items={VIEWS.map((v) => ({ href: hrefFor(v.key, anchor), label: v.label, active: v.key === view }))} />}
      />
      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={hrefFor(view, null)} className={navBtn} title="Today (.)">
            Today
          </Link>
          <span className="flex gap-1">
            <Link href={shown ? hrefFor(view, stepAnchor(view, shown, -1)) : "#"} aria-label="Previous" title="Previous (←)" className={navBtn}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
                <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href={shown ? hrefFor(view, stepAnchor(view, shown, 1)) : "#"} aria-label="Next" title="Next (→)" className={navBtn}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
                <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </span>
          <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{days.length ? titleOf(view, days) : " "}</h2>
        </div>
        {legend.size ? (
          <ul aria-label="Departments" className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-xs text-muted-foreground">
              {[...legend].map(([name, tone]) => (
              <li key={name} className="flex items-center gap-1.5">
                <i aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </Toolbar>
      {truncated ? <Notice>Too many interviews to show at once here; some later ones are left off. Try the day or week view.</Notice> : null}
      {!timeZone || !today ? (
        <div aria-busy className="h-[616px] rounded-[12px] border border-[color:var(--line)] bg-card" />
      ) : view === "list" ? (
        <ListOf days={days} events={visible} timeZone={timeZone} today={today} />
      ) : (
        <>
          <TimeGrid days={days} events={visible} timeZone={timeZone} today={today} now={now} />
          {visible.length ? null : <Empty>No interviews {view === "day" ? "this day" : "this week"}.</Empty>}
        </>
      )}
    </Page>
  );
}
