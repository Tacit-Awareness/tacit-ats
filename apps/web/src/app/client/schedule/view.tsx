"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { FilterMenu } from "@/components/filter-menu";
import { useKeyHelp, useKeys, type KeyHandler } from "@/components/keys";
import { Empty, Notice, Page, PageBar, Pill, SearchBox, pillOption, pillTrack, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import {
  daysOf,
  MIN_BLOCK_MINUTES,
  monthCells,
  placeDay,
  SCHEDULE_KEYS,
  scheduleHref,
  SNAP_MINUTES,
  scheduleKeyHref,
  stepAnchor,
  todayIn,
  weekdayOf,
  zoned,
  zonedInstant,
  type EventTone,
  type MonthCell,
  type Placed,
  type ScheduleView as View,
  type Ymd,
} from "@/lib/client/schedule-layout";
import { searchOrder } from "@/lib/client/schedule-search";
import { withoutBook, type NextRound } from "@/lib/client/next-round-rules";
import { cn } from "@/lib/utils";
import { ScheduleDialog, type Anchor, type Flow } from "./booking";
import { clock12, hour12, minutes12, minutesRange12, range12, zoneLong, zoneShort } from "./clock";
import "./schedule.css";

// The Calendar's markup, props only (page.tsx does the read), in Tacit
// Testbench's look: the search alone in the title row, then one white card
// holding the controls row (Today and the arrows, the dates, the departments
// and the views, each on a segmented track) over a day or week grid, the month
// grid, or the month as its interviews table. A search swaps the dates and the
// grid for one table of every date's matches. A client component because it
// lays the interviews out in the browser's own time zone, which the server does
// not know; until it has the zone (the server render, and the first paint) it
// draws the frame with no times in it, never UTC by mistake. Times read on a
// 12-hour clock, the zone small over the hours (or by the list's times), never
// beside the title. The card fills the window: the day and week open on 6 AM to
// 6 PM, the rest of the day a scroll away inside the grid under its pinned
// header; the month shares the card's height among its weeks, and the list
// scrolls inside it. Each event names its department in its hover title; there
// is no colour key. Navigation is in the URL (`?view=`, `?date=`, `?dept=`,
// `?q=`), with D / W / M / L, ← / →, `.` for today and `/` for the search.
// Each event opens the interview on the Interviews page, except one the member
// may still change (`canChange`): that opens its card, with Reschedule and
// Cancel, and a drag moves it. Booking starts on the grid, Google Calendar's
// way: a click or a drag on an empty time holds that slot and opens the quick
// popover beside it, and N does the same at the next free half hour. There is
// no Book or Find a time button here; the Inbox's Next round still opens Find
// a time (`?book=`). All of that is booking.tsx; whatever would change a real
// calendar stops at its Confirm card.

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
  applicationId: string;
  interviewerIds: string[];
  /** Its Google Calendar event, only when it reads as an http(s) URL. */
  eventLink: string | null;
  /** Still ahead, and on a job the member may schedule on. */
  canChange: boolean;
};

const TONE: Record<EventTone, string> = {
  blue: "bg-[color:var(--ev-blue)] text-[color:var(--ev-blue-ink)]",
  mint: "bg-[color:var(--ev-mint)] text-[color:var(--ev-mint-ink)]",
  pink: "bg-[color:var(--ev-pink)] text-[color:var(--ev-pink-ink)]",
  peach: "bg-[color:var(--ev-peach)] text-[color:var(--ev-peach-ink)]",
  lav: "bg-[color:var(--ev-lav)] text-[color:var(--ev-lav-ink)]",
  gray: "bg-[color:var(--ev-gray)] text-[color:var(--ev-gray-ink)]",
};

/**
 * The day and week open on the working day: 6 AM to 6 PM fills the card, and
 * the hours either side are a scroll away inside the grid, its header (the days
 * and the zone) staying put. An hour is the card's height shared among those
 * twelve, so an interview reads at a comfortable size rather than a whole day
 * squeezed in.
 */
const OPEN_HOURS = { first: 6, last: 18 } as const;
/** Below this an hour is too short to read; a short window shows fewer of the twelve instead. */
const MIN_HOUR_PX = 32;
/** Room above 6 AM and below 6 PM as the grid opens, so their labels, which sit across their lines, read whole, with a pixel or two to spare for the browser's rounding. */
const EDGE_PX = 12;
const DAY_MINUTES = 24 * 60;
/** A new interview's length when it is clicked rather than dragged out, and the N key's. */
const NEW_MINUTES = 60;
/** A drag held this close to the top or bottom of the hours in view scrolls the grid on. */
const AUTO_SCROLL_PX = 28;
/** A block's lines after the candidate, each shown once the block is this tall. */
const LINE_AT = { time: 36, detail: 52, interviewers: 68, location: 84 } as const;
/** The slot being booked takes its second line from this tall (its padding and two 16px lines), and a third from this. */
const SLOT_TWO_LINES = 38;
const SLOT_THREE_LINES = 55;
/** A block's words are Geist Mono at 12px, every character 0.6em wide, so whether a time fits on its line is a sum. */
const MONO_12 = 7.2;
const fitsLine = (text: string, room: number) => text.length * MONO_12 <= room;
/** A time as its line has room for it: the range when it fits, else the start alone, never cut short ("10:00 – 11:0…"). */
const timeFor = (range: string, start: string, room: number) => (fitsLine(range, room) ? range : start);
const VIEWS: { key: View; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "list", label: "List" },
];

const hrefFor = (view: View, date: Ymd | null, dept: string | null, q?: string | null) => scheduleHref({ view, date, dept, q });

/**
 * Up to this many departments the filter is a segmented track beside the
 * views (Testbench's `.seg`), Everyone first; past it, a track would crowd the
 * controls row, so the filter stays a menu.
 */
const DEPT_SEGMENTS = 4;

/** The controls row's buttons and both tracks share one height, 32px: Today, the arrows, and the small `.seg`. */
const todayBtn = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8");
/** The arrows either side of the dates: square ghost buttons. */
const stepBtn = cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 w-8 px-0 text-foreground");
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

/** An event's hover: every fact on its own line, the time with its zone, its department last. */
const eventTitle = (e: CalendarEvent, timeZone: string) =>
  [e.candidate, `${range12(e.startsAt, e.endsAt, timeZone)} ${zoneShort(timeZone, Date.parse(e.startsAt))}`, e.step, e.job, e.interviewers.join(", "), e.location, e.department].filter(Boolean).join("\n");

/** Opens an event's card on a plain click; ⌘-click and the like stay the link's, and an event the member cannot change is only a link. */
const opener = (e: CalendarEvent, open: (e: CalendarEvent) => void) =>
  e.canChange
    ? (click: React.MouseEvent) => {
        if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.button !== 0) return;
        click.preventDefault();
        open(e);
      }
    : undefined;

/**
 * One line that shows its first fact whole and the rest only where they fit:
 * the facts wrap, and the box is one line tall, so a fact short of room drops
 * out of sight rather than cutting the one before it. The hover title has them all.
 */
const oneLine = "flex max-h-4 min-w-0 flex-wrap gap-x-2 overflow-hidden leading-4";

function EventBlock({ placed, y, wide, colPx, timeZone, open, grab }: { placed: Placed<CalendarEvent>; y: (minutes: number) => number; wide: boolean; colPx: number; timeZone: string; open: (e: CalendarEvent) => void; grab: (down: React.PointerEvent<HTMLElement>, e: CalendarEvent) => void }) {
  const { event: e, start, end, lane, lanes } = placed;
  const height = Math.max(18, y(end) - y(start) - 2);
  const tight = height < LINE_AT.time;
  const time = range12(e.startsAt, e.endsAt, timeZone);
  // Its share of the column, less a pixel each side and 6px inside.
  const room = colPx / lanes - 14;
  return (
    <Link
      href={e.href}
      draggable={false}
      onClick={opener(e, open)}
      onPointerDown={e.canChange ? (down) => grab(down, e) : undefined}
      title={eventTitle(e, timeZone)}
      // A pixel off each side and 6px inside: in a week's column at 1280 a name such as "Camille Laurent" still reads whole.
      style={{ top: y(start) + 1, height, left: `calc(${(lane / lanes) * 100}% + 1px)`, width: `calc(${100 / lanes}% - 2px)` }}
      className={cn(
        e.canChange && "cursor-grab touch-pan-y",
        "absolute z-[2] flex flex-col gap-px overflow-hidden rounded-[6px] px-1.5 text-[12px] leading-4 transition-shadow duration-150 hover:z-[3] hover:shadow-[var(--shadow)]",
        tight ? "justify-center py-0" : "py-1.5",
        TONE[e.tone],
      )}
    >
      {tight ? (
        // One line: who, whole, then when, and in a day's wide column what the round is, each only where it fits.
        <span className={oneLine}>
          <b className="max-w-full truncate font-medium">{e.candidate}</b>
          <span className="opacity-80 tabular-nums">{wide ? time : clock12(e.startsAt, timeZone)}</span>
          {wide ? <span className="opacity-80">{e.step}</span> : null}
          {wide && e.job ? <span className="opacity-80">{e.job}</span> : null}
        </span>
      ) : (
        <>
          <b className="truncate font-medium">{e.candidate}</b>
          <span className="truncate opacity-80 tabular-nums">{timeFor(time, clock12(e.startsAt, timeZone), room)}</span>
          {height >= LINE_AT.detail ? (
            <span className="truncate opacity-80">
              {e.step}
              {e.job ? <span className="ml-2">{e.job}</span> : null}
            </span>
          ) : null}
          {height >= LINE_AT.interviewers && e.interviewers.length ? <span className="truncate opacity-80">{e.interviewers.join(", ")}</span> : null}
          {height >= LINE_AT.location && e.location ? <span className="truncate opacity-80">{e.location}</span> : null}
        </>
      )}
    </Link>
  );
}

type Ghost = { day: Ymd; start: number; end: number; label: string };

/** A slot being booked: the placeholder Google Calendar keeps on the grid while its quick popover is open. */
export type Held = { day: Ymd; minutes: number; length: number };

/** What the page asks of the grid: N's new interview, which needs the grid to find and show the slot. */
export type GridHandle = { newAtNextFree: () => boolean };

/** Past this many pixels a press is a drag. */
const DRAG_PX = 4;

/**
 * The grid's scrolling body, measured so an hour is its share of 6 AM to 6 PM.
 * It opens with 6 AM at the top and keeps whatever time is at the top as the
 * window changes size, so a resize never jumps the member somewhere else.
 */
function useHourScale() {
  const scroller = React.useRef<HTMLDivElement>(null);
  const head = React.useRef<HTMLDivElement>(null);
  const [hourPx, setHourPx] = React.useState(48);
  /** The minute at the top of the hours in view, in a ref: scrolling is not a reason to redraw. */
  const top = React.useRef<number>(OPEN_HOURS.first * 60);
  const px = React.useRef(hourPx);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => setHourPx(Math.max(MIN_HOUR_PX, (el.clientHeight - (head.current?.offsetHeight ?? 0) - 2 * EDGE_PX) / (OPEN_HOURS.last - OPEN_HOURS.first)));
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  React.useLayoutEffect(() => {
    px.current = hourPx;
    const el = scroller.current;
    if (el) el.scrollTop = (top.current / 60) * hourPx - EDGE_PX;
  }, [hourPx]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // A scroll this hook made lands within a pixel of the minute it kept, the browser rounding it to a whole
    // pixel: that minute stays, so switching between Day and Week never creeps a pixel at a time and clips 6 AM.
    if (Math.abs(el.scrollTop - ((top.current / 60) * px.current - EDGE_PX)) < 1) return;
    top.current = ((el.scrollTop + EDGE_PX) / px.current) * 60;
  };
  /** How tall the hours in view are: the body less its pinned header. */
  const shownPx = () => (scroller.current?.clientHeight ?? 0) - (head.current?.offsetHeight ?? 0);
  return { scroller, head, hourPx, onScroll, shownPx };
}

/** A minute snapped to the grid's slots, and kept inside the day. */
const snap = (minutes: number) => Math.max(0, Math.min(DAY_MINUTES - SNAP_MINUTES, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));

function TimeGrid({
  ref, days, events, timeZone, today, now, canBook, held, open, book, move,
}: {
  ref?: React.Ref<GridHandle>;
  days: Ymd[];
  events: CalendarEvent[];
  timeZone: string;
  today: Ymd;
  now: number;
  canBook: boolean;
  /** The slot the quick popover is open on, drawn until it closes. */
  held: Held | null;
  open: (e: CalendarEvent) => void;
  book: (at: { day: Ymd; minutes: number; length: number }, anchor: Anchor) => void;
  move: (e: CalendarEvent, to: { startsAt: string; endsAt: string }) => void;
}) {
  const columns = days.map((day) => ({ day, placed: placeDay(events, day, timeZone) }));
  const { scroller, head, hourPx, onScroll, shownPx } = useHourScale();
  /** Where a minute of the day sits down the grid, and the minute at a point down it. */
  const y = (minutes: number) => (minutes / 60) * hourPx;
  const minutesAt = (at: number) => (at / hourPx) * 60;
  const [ghost, setGhost] = React.useState<Ghost | null>(null);
  const noClick = React.useRef(0);
  /** A day's column's width, for whether a block's time fits its line; measured again as the window or the view changes. */
  const [colPx, setColPx] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setColPx(el.querySelector<HTMLElement>("[data-day]")?.clientWidth ?? 0);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [scroller, days.length]);

  /** The day's column under a point across the grid, whatever its height: a drag may run past the hours in view. */
  const columnAt = (x: number) =>
    [...(scroller.current?.querySelectorAll<HTMLElement>("[data-day]") ?? [])].find((c) => {
      const box = c.getBoundingClientRect();
      return x >= box.left && x < box.right;
    }) ?? null;

  /**
   * Follows the pointer until it lifts. Nothing is booked or moved here: the
   * end of a drag only opens a dialog. Held near the top or bottom of the hours
   * in view, the grid scrolls on, so a drag reaches the hours out of sight.
   */
  const follow = (down: React.PointerEvent<HTMLElement>, onMove: (m: PointerEvent, col: HTMLElement | null) => void, onDone: (moved: boolean) => void) => {
    const x0 = down.clientX;
    const y0 = down.clientY;
    let moved = false;
    let last: PointerEvent | null = null;
    let frame = 0;
    const track = (m: PointerEvent) => onMove(m, columnAt(m.clientX));
    const scrollOn = () => {
      frame = 0;
      const el = scroller.current;
      if (!el || !last) return;
      const box = el.getBoundingClientRect();
      const top = box.top + (head.current?.offsetHeight ?? 0);
      const past = last.clientY < top + AUTO_SCROLL_PX ? last.clientY - top - AUTO_SCROLL_PX : last.clientY > box.bottom - AUTO_SCROLL_PX ? last.clientY - box.bottom + AUTO_SCROLL_PX : 0;
      if (!past) return;
      const was = el.scrollTop;
      el.scrollTop += Math.sign(past) * Math.min(18, 2 + Math.abs(past) / 3);
      if (el.scrollTop !== was) track(last);
      frame = requestAnimationFrame(scrollOn);
    };
    const leave = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      cancelAnimationFrame(frame);
    };
    const onPointerMove = (m: PointerEvent) => {
      if (Math.abs(m.clientX - x0) > DRAG_PX || Math.abs(m.clientY - y0) > DRAG_PX) moved = true;
      if (!moved) return;
      last = m;
      track(m);
      if (!frame) frame = requestAnimationFrame(scrollOn);
    };
    const onUp = () => {
      leave();
      onDone(moved);
    };
    // A scroll on a phone takes the gesture over: drop the drag.
    const onCancel = () => {
      leave();
      setGhost(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  /** The slot on screen, for the quick popover to open beside (booking.tsx places it): its day's column across, its time down, and where it was pressed. */
  const anchorOf = (column: HTMLElement, start: number, end: number, x: number): Anchor => {
    const box = column.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top + y(start), bottom: box.top + y(end), x };
  };

  /**
   * A click on an empty slot, or a drag down the grid, is how a booking
   * starts: Google Calendar's way, it holds that slot and opens the quick
   * popover beside it (booking.tsx), the time already set.
   */
  const pressGrid = (down: React.PointerEvent<HTMLDivElement>, day: Ymd) => {
    if (!canBook || down.button !== 0 || (down.target as HTMLElement).closest("a")) return;
    const column = down.currentTarget;
    if (down.pointerType !== "touch") down.preventDefault();
    // Half a slot up, so the press lands in the slot it is in rather than the nearer edge.
    const from = snap(minutesAt(down.clientY - column.getBoundingClientRect().top) - SNAP_MINUTES / 2);
    const keep = (m: number) => Math.max(0, Math.min(DAY_MINUTES, m));
    let to = keep(from + NEW_MINUTES);
    const shape = () => ({ start: Math.min(from, to), end: Math.max(to, keep(from + 30)) });
    setGhost({ day, ...shape(), label: "New interview" });
    follow(
      down,
      (m) => {
        to = keep(snap(minutesAt(m.clientY - column.getBoundingClientRect().top)) + SNAP_MINUTES);
        setGhost({ day, ...shape(), label: "New interview" });
      },
      (moved) => {
        setGhost(null);
        if (!moved) to = keep(from + NEW_MINUTES);
        const { start, end } = shape();
        book({ day, minutes: start, length: end - start }, anchorOf(column, start, end, down.clientX));
      },
    );
  };

  const grab = (down: React.PointerEvent<HTMLElement>, e: CalendarEvent) => {
    if (down.button !== 0) return;
    const length = Math.round((Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60_000);
    const grabbed = down.clientY - down.currentTarget.getBoundingClientRect().top;
    let at: { day: Ymd; start: number } | null = null;
    follow(
      down,
      (m, col) => {
        if (!col?.dataset.day) return;
        const start = Math.max(0, Math.min(DAY_MINUTES - length, snap(minutesAt(m.clientY - col.getBoundingClientRect().top - grabbed))));
        at = { day: col.dataset.day, start };
        setGhost({ ...at, end: at.start + length, label: e.candidate });
      },
      (moved) => {
        setGhost(null);
        if (!moved) return;
        // The click that ends a drag is not a click on the event.
        noClick.current = Date.now();
        if (!at) return;
        const startsAt = zonedInstant(at.day, at.start, timeZone);
        if (Date.parse(startsAt) !== Date.parse(e.startsAt)) move(e, { startsAt, endsAt: new Date(Date.parse(startsAt) + length * 60_000).toISOString() });
      },
    );
  };
  const openUnlessDragged = (e: CalendarEvent) => {
    if (Date.now() - noClick.current > 300) open(e);
  };

  /**
   * N: the next free half hour on the grid, from now on today (never before
   * 6 AM), from 6 AM on a later day, an hour long and clear of every interview
   * shown. The grid scrolls to it, and its popover opens beside it as a click
   * there would. False when no day shown has one left.
   */
  React.useImperativeHandle(ref, () => ({
    newAtNextFree() {
      const el = scroller.current;
      if (!el) return false;
      const nowAt = zoned(now, timeZone);
      for (const { day, placed } of columns) {
        if (day < nowAt.day) continue;
        const from = Math.max(OPEN_HOURS.first * 60, day === nowAt.day ? Math.ceil(nowAt.minutes / 30) * 30 : 0);
        for (let t = from; t + NEW_MINUTES <= DAY_MINUTES; t += 30) {
          if (placed.some((p) => p.start < t + NEW_MINUTES && Math.max(p.end, p.start + MIN_BLOCK_MINUTES) > t)) continue;
          if (y(t) < el.scrollTop + EDGE_PX || y(t + NEW_MINUTES) > el.scrollTop + shownPx() - EDGE_PX) el.scrollTop = y(t) - hourPx;
          const column = el.querySelector<HTMLElement>(`[data-day="${day}"]`);
          if (!column) return false;
          const box = column.getBoundingClientRect();
          book({ day, minutes: t, length: NEW_MINUTES }, anchorOf(column, t, t + NEW_MINUTES, box.left + Math.min(box.width / 3, 280)));
          return true;
        }
      }
      return false;
    },
  }));

  const nowAt = zoned(now, timeZone);
  const cols = { gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` };
  // While the popover is open its slot stays drawn, unless a new drag is drawing another.
  const shown: Ghost | null = ghost ?? (held ? { day: held.day, start: held.minutes, end: held.minutes + held.length, label: "New interview" } : null);
  // Every hour is labelled down the side but midnight: the grid's top edge says it, and a label there would sit on the header's rule.
  const hours = Array.from({ length: 23 }, (_, i) => i + 1);

  return (
    // Fills the card's body and scrolls inside it, the header pinned; on a phone, where the card does not fill the window, a fixed height does.
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto overscroll-contain max-md:h-[600px] max-md:flex-none">
      <div className={cn(days.length > 1 && "min-w-[720px]")}>
        <div ref={head} className="sticky top-0 z-[6] grid border-b border-[color:var(--line)] bg-card" style={cols}>
          {/* Google Calendar's place for the time zone: small, over the hours, its full name on hover. */}
          <span title={`Times in ${zoneLong(timeZone)}`} className="flex items-end justify-end pr-2.5 pb-1.5 text-[11px] text-faint">
            {zoneShort(timeZone, now)}
          </span>
          {days.map((d) => (
            <div key={d} aria-current={d === today ? "date" : undefined} className="flex h-[52px] items-center gap-2 border-l border-[color:var(--line)] px-3.5">
              <span className={cn("text-[12px]", d === today ? "font-medium text-[color:var(--accent)]" : "text-faint")}>{dayWords(d, { weekday: "short" })}</span>
              <b
                className={cn(
                  "inline-grid h-[26px] min-w-[26px] place-items-center text-[15px] font-medium tabular-nums",
                  // The current day's marker is a circle: a mark of where you are, not a status.
                  d === today && "rounded-full bg-[color:var(--accent)] px-1.5 text-[color:var(--accent-ink)]",
                )}
              >
                {Number(d.slice(8))}
              </b>
            </div>
          ))}
        </div>
        <div className="relative grid" style={{ ...cols, height: y(DAY_MINUTES) }}>
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-2.5 -translate-y-1/2 text-[11.5px] whitespace-nowrap text-faint tabular-nums" style={{ top: y(h * 60) }}>
                {hour12(h)}
              </span>
            ))}
          </div>
          {columns.map(({ day, placed }) => {
            const slot = shown?.day === day ? shown : null;
            const slotPx = slot ? Math.max(18, y(slot.end) - y(slot.start) - 2) : 0;
            const slotTime = slot ? minutesRange12(slot.start, slot.end) : "";
            return (
            <div
              key={day}
              data-day={day}
              onPointerDown={canBook ? (down) => pressGrid(down, day) : undefined}
              className={cn("relative min-w-0 overflow-hidden border-l border-[color:var(--line)]", canBook && "cursor-cell", weekdayOf(day) % 6 === 0 && "bg-[color:var(--surface)]")}
            >
              {hours.map((h) => (
                <i key={h} className="absolute inset-x-0 h-px bg-[color:var(--line)]" style={{ top: y(h * 60) }} />
              ))}
              {/* Placed in minutes from midnight. The layer lets a press through to the column, and takes it on an interview. */}
              <div className="pointer-events-none absolute inset-0 [&>a]:pointer-events-auto">
                {placed.map((p) => (
                  <EventBlock key={p.event.id} placed={p} y={y} wide={days.length === 1} colPx={colPx} timeZone={timeZone} open={openUnlessDragged} grab={grab} />
                ))}
                {slot ? (
                  // Its lines 16px, as an interview's are, so a second line shows only where it has the room for all of it.
                  <div
                    aria-hidden
                    className={cn(
                      "absolute inset-x-px z-[4] flex flex-col overflow-hidden rounded-[6px] border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-1.5 text-[12px] leading-4 text-[color:var(--accent)]",
                      ghost ? "border-dashed" : "shadow-[var(--shadow-sm)]",
                      slotPx < SLOT_TWO_LINES ? "justify-center" : "gap-y-px py-1",
                    )}
                    style={{ top: y(slot.start) + 1, height: slotPx }}
                  >
                    {slotPx < SLOT_TWO_LINES ? (
                      <span className={oneLine}>
                        <b className="max-w-full truncate font-medium">{slot.label}</b>
                        <span className="tabular-nums">{slotTime}</span>
                      </span>
                    ) : (
                      <>
                        <b className="truncate font-medium">{slot.label}</b>
                        {/* The range on one line where it fits (inside a pixel and a border each side, and 6px); in a
                            narrow column the start, and the end under it once a drag gives it the room, as it grows. */}
                        {fitsLine(slotTime, colPx - 16) ? (
                          <span className="truncate tabular-nums">{slotTime}</span>
                        ) : (
                          <>
                            <span className="tabular-nums">{minutes12(slot.start)}</span>
                            {slotPx >= SLOT_THREE_LINES ? <span className="tabular-nums">– {minutes12(slot.end)}</span> : null}
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
                {day === nowAt.day ? (
                  <em
                    aria-hidden
                    className="absolute -left-px right-0 z-[3] h-0.5 bg-[color:var(--accent)] before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:bg-[color:var(--accent)]"
                    style={{ top: y(nowAt.minutes) }}
                  />
                ) : null}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A month row's room: the date and the cell's padding, then a line an interview (or "N more"). */
const MONTH_DATE_PX = 32;
const MONTH_LINE_PX = 22;

/**
 * design/tats's month (`.mo-grid`): six weeks filling the card, a day's first
 * interviews (three, or as many as its row has room for), the rest in "N more"
 * and its day view.
 */
function MonthGrid({ cells, timeZone, today, dept, open }: { cells: MonthCell<CalendarEvent>[]; timeZone: string; today: Ymd; dept: string | null; open: (e: CalendarEvent) => void }) {
  const grid = React.useRef<HTMLUListElement>(null);
  const [room, setRoom] = React.useState(3);
  React.useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const fit = () => {
      const row = el.clientHeight / Math.max(1, Math.ceil(cells.length / 7));
      setRoom(Math.max(1, Math.floor((row - MONTH_DATE_PX) / MONTH_LINE_PX)));
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(el);
    return () => seen.disconnect();
  }, [cells.length]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div aria-hidden className="grid flex-none grid-cols-7 border-b border-[color:var(--line)]">
        {cells.slice(0, 7).map((c) => (
          <span key={c.day} className="px-1.5 py-2.5 text-[12px] text-faint md:px-3">
            {dayWords(c.day, { weekday: "short" })}
          </span>
        ))}
      </div>
      <ul ref={grid} aria-label="Month" className="m-0 grid min-h-[420px] flex-1 list-none auto-rows-fr grid-cols-7 p-0">
        {cells.map((c) => {
          const isToday = c.day === today;
          const dayHref = hrefFor("day", c.day, dept);
          const count = c.events.length;
          // As many as the row has lines for, "N more" taking the last line when they do not all fit; it opens the day.
          const total = c.listed.length + c.more;
          const listed = total <= room ? c.listed : c.listed.slice(0, Math.max(0, room - 1));
          const more = total - listed.length;
          return (
            <li
              key={c.day}
              className={cn(
                "grid min-h-16 min-w-0 content-start gap-0.5 overflow-hidden border-r border-b border-[color:var(--line)] px-1 pt-1 pb-1 md:px-1.5 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                !c.inMonth && "bg-[color:var(--surface)]",
              )}
            >
              <Link
                href={dayHref}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${dayWords(c.day, { weekday: "long", month: "long", day: "numeric" })}, ${count} ${count === 1 ? "interview" : "interviews"}`}
                className={cn(
                  "inline-grid h-6 min-w-6 place-items-center justify-self-start px-1 text-[12.5px] font-medium tabular-nums transition-colors",
                  // The current day's marker is a circle; any other date is a square you can press.
                  isToday ? "rounded-full bg-[color:var(--accent)] text-[color:var(--accent-ink)]" : "rounded-[6px] hover:bg-[color:var(--hover)]",
                  !isToday && !c.inMonth && "text-faint",
                )}
              >
                {Number(c.day.slice(8))}
              </Link>
              {listed.map((e) => (
                <Link
                  key={e.id}
                  href={e.href}
                  onClick={opener(e, open)}
                  title={eventTitle(e, timeZone)}
                  className={cn("flex h-5 min-w-0 items-center rounded-[5px] px-1.5 text-[12px] transition-shadow duration-150 hover:shadow-[var(--shadow-sm)] max-md:hidden", TONE[e.tone])}
                >
                  {/* The name whole, the time after it where the cell has room (the hover has it always). */}
                  <span className={cn(oneLine, "gap-x-1.5")}>
                    <span className="max-w-full truncate font-medium">{e.candidate}</span>
                    <span className="opacity-80 tabular-nums">{clock12(e.startsAt, timeZone)}</span>
                  </span>
                </Link>
              ))}
              {more ? (
                <Link href={dayHref} className="justify-self-start rounded-[5px] px-1.5 text-[12px] leading-5 text-faint transition-colors hover:bg-[color:var(--hover)] hover:text-foreground max-md:hidden">
                  {more} more
                </Link>
              ) : null}
              {/* Too narrow for names on a phone: the count, and the date opens the day. */}
              {count ? (
                <span aria-hidden className={cn("justify-self-start rounded-[5px] px-1.5 text-[11.5px] tabular-nums md:hidden", TONE[c.events[0]!.tone])}>
                  {count}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Testbench's `.tag`: booked green, past grey. */
function StatusPill({ past }: { past: boolean }) {
  return <Pill tone={past ? "grey" : "green"}>{past ? "Past" : "Booked"}</Pill>;
}

/** Well-known meeting sites by the name people call them. */
const PLACES: [RegExp, string][] = [
  [/(^|\.)meet\.google\.com$/, "Google Meet"],
  [/(^|\.)zoom\.us$/, "Zoom"],
  [/(^|\.)teams\.(microsoft|live)\.com$/, "Teams"],
];

/** A link as a cell too narrow for the address says it: "Google Meet", else its site; the address itself when it does not parse. */
const placeOf = (href: string) => {
  try {
    const host = new URL(href).host;
    return PLACES.find(([site]) => site.test(host))?.[1] ?? host;
  } catch {
    return href;
  }
};

/**
 * The round takes the most room: its step and job sit side by side, the job
 * giving way first. The date is "Nov 3" unless a row is in another year, when
 * the column widens for "Nov 3, 2025".
 */
const CT_GRID = {
  short: "grid grid-cols-[72px_minmax(120px,0.9fr)_minmax(160px,1.8fr)_minmax(120px,0.9fr)_64px_132px_minmax(110px,0.6fr)] items-center gap-3 px-4",
  long: "grid grid-cols-[72px_minmax(120px,0.9fr)_minmax(160px,1.8fr)_minmax(120px,0.9fr)_100px_132px_minmax(110px,0.6fr)] items-center gap-3 px-4",
};

/** design/tats's interviews table (`.ct-row`): the rows in the order given, each opening the interview. It scrolls inside the card, the calendar's frame staying put. */
function ListOf({ rows, timeZone, now, empty, open }: { rows: CalendarEvent[]; timeZone: string; now: number; empty: string; open: (e: CalendarEvent) => void }) {
  const thisYear = zoned(now, timeZone).day.slice(0, 4);
  const dayOf = (e: CalendarEvent) => zoned(e.startsAt, timeZone).day;
  const grid = rows.some((e) => dayOf(e).slice(0, 4) !== thisYear) ? CT_GRID.long : CT_GRID.short;
  return (
    <section aria-label="Interviews" className="min-h-0 flex-1 overflow-auto">
      <h2 className="m-0 flex min-h-[52px] items-center gap-2 px-4 py-3 text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">
        Interviews <span className="font-mono text-[12.5px] font-normal tracking-normal text-faint tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <Empty className="my-0 border-t border-[color:var(--line)] px-4 py-3.5 [overflow-wrap:anywhere]">{empty}</Empty>
      ) : (
        <div>
          <div role="table" aria-label="Interviews" className="grid min-w-[920px]">
            <div role="row" className={cn(grid, "sticky top-0 z-[2] min-h-10 border-y border-[color:var(--line)] bg-card text-[12px] text-faint")}>
              {["Status", "Applicant", "Round", "Interviewer", "Date"].map((h) => (
                <span key={h} role="columnheader">
                  {h}
                </span>
              ))}
              {/* The times' zone, beside the column it is about, its full name on hover. */}
              <span role="columnheader" title={`Times in ${zoneLong(timeZone)}`}>
                Time <span className="ml-1.5 text-[11px]">{zoneShort(timeZone, now)}</span>
              </span>
              <span role="columnheader">Where</span>
            </div>
            {rows.map((e) => {
              const ymd = dayOf(e);
              // The year only when it is not this one; the hover has it always.
              const day = dayWords(ymd, { month: "short", day: "numeric", year: "numeric" });
              const shortDay = ymd.slice(0, 4) === thisYear ? dayWords(ymd, { month: "short", day: "numeric" }) : day;
              const time = range12(e.startsAt, e.endsAt, timeZone);
              const [lead, ...more] = e.interviewers;
              return (
                <div role="row" key={e.id} className={cn(grid, "relative min-h-12 border-b border-[color:var(--line)] text-[13px] transition-colors last:border-b-0 hover:bg-[color:var(--surface)]")}>
                  {/* The whole row opens the interview; the location link sits above it. */}
                  <Link href={e.href} onClick={opener(e, open)} aria-label={`${e.candidate}, ${e.step}, ${day} ${time}`} className="absolute inset-0" />
                  <span role="cell">
                    <StatusPill past={Date.parse(e.endsAt) <= now} />
                  </span>
                  <span role="cell" className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{e.candidate}</span>
                  </span>
                  {/* One line: the step whole, then the job where ten characters of it fit, cut short past that.
                      Short of that room it wraps out of sight rather than show a stub like "F…"; the hover has it. */}
                  <span role="cell" className="flex max-h-5 min-w-0 flex-wrap gap-x-2.5 overflow-hidden" title={[e.step, e.job, e.department].filter(Boolean).join("\n")}>
                    <span className="max-w-full flex-none truncate">{e.step}</span>
                    {e.job ? <span className="min-w-0 flex-1 basis-[10ch] truncate text-faint">{e.job}</span> : null}
                  </span>
                  <span role="cell" className="flex min-w-0 items-center gap-2" title={e.interviewers.join(", ") || undefined}>
                    {lead ? (
                      <>
                        <span className="truncate">{lead}</span>
                        {more.length ? <span className="flex-none text-[12px] text-faint">+{more.length} more</span> : null}
                      </>
                    ) : (
                      <span className="text-faint">No interviewer listed</span>
                    )}
                  </span>
                  <span role="cell" title={day} className="whitespace-nowrap tabular-nums">
                    {shortDay}
                  </span>
                  <span role="cell" className="whitespace-nowrap tabular-nums">
                    {time}
                  </span>
                  <span role="cell" className="min-w-0 truncate">
                    {e.location ? (
                      e.locationHref ? (
                        // A link reads as its meeting's name or its site; the whole address is its hover, and where it goes.
                        <a href={e.locationHref} target="_blank" rel="noopener noreferrer" title={e.location} className={cn(textLink, "relative z-[1] inline-block max-w-full truncate align-bottom text-[13px]")}>
                          {placeOf(e.locationHref)}
                        </a>
                      ) : (
                        <span title={e.location} className="text-muted-foreground">
                          {e.location}
                        </span>
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
  canBook,
  nextRound = null,
  banner,
}: {
  view: View;
  /** The `?date=`; null is the browser's today. */
  anchor: Ymd | null;
  /** A window wider than the view, so it holds the view's days in any zone; in a search, every date's matches. */
  events: CalendarEvent[];
  /** The department filter's choices; empty hides it (an interviewer reads no department names). */
  departments: string[];
  /** The `?dept=`, one of `departments`; null is everyone's. */
  dept: string | null;
  /** The `?q=`; null is the calendar, anything else the table of matches. */
  q: string | null;
  truncated: boolean;
  /** May book on some job: not an interviewer. Which jobs is the dialog's read, and the policies' at the write. */
  canBook: boolean;
  /** The `?book=`, the Inbox's Next round: Find a time opens on it once, prefilled. */
  nextRound?: NextRound | null;
  /** Above the toolbar: the page's banner, when it has one. */
  banner?: React.ReactNode;
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

  const [flow, setFlow] = React.useState<Flow | null>(() => (canBook && nextRound ? { kind: "book", find: true, next: nextRound } : null));
  const [notice, setNotice] = React.useState<string | null>(null);
  // Once open, `?book=` has done its job: a reload, or Back after a booking, shouldn't open it again.
  React.useEffect(() => {
    if (nextRound) router.replace(withoutBook(window.location.search), { scroll: false });
  }, [nextRound, router]);
  const openEvent = React.useCallback((event: CalendarEvent) => setFlow({ kind: "event", event }), []);

  const days = shown ? daysOf(view, shown) : [];
  const grid = React.useRef<GridHandle>(null);
  // N needs a grid with a day still ahead (today included) to find a slot on.
  const canNew = canBook && !q && (view === "day" || view === "week") && !!today && days.length > 0 && days.at(-1)! >= today;

  // Every key is a shortcut for a link here; `/` puts the cursor in the search, N in a new interview.
  const search = React.useRef<HTMLDivElement>(null);
  const bindings: Record<string, KeyHandler> = {
    "/": () => {
      const input = search.current?.querySelector<HTMLInputElement>('input[name="q"]');
      input?.focus();
      input?.select();
    },
    ...(canNew ? { n: () => void grid.current?.newAtNextFree() } : {}),
  };
  if (shown) {
    for (const key of SCHEDULE_KEYS) {
      const href = scheduleKeyHref(key, { view, anchor, shown, dept, q });
      if (href) bindings[key] = () => router.push(href);
    }
  }
  useKeys(bindings);
  useKeyHelp("Interview Calendar", [
    { keys: "D / W / M / L", label: "Day, week, month, list" },
    ...(q ? [] : [{ keys: "← / →", label: "Previous, next" }]),
    { keys: ".", label: "Today" },
    { keys: "/", label: "Search interviews" },
    ...(canBook
      ? [
          { keys: "Click or Drag", label: "New interview" },
          ...(canNew ? [{ keys: "N", label: "Next free half hour" }] : []),
          { keys: "Drag", label: "Move an interview" },
        ]
      : []),
  ]);

  const inDept = events.filter((e) => !dept || e.department === dept);
  const inView =
    timeZone && days.length ? inDept.filter((e) => zoned(e.startsAt, timeZone).day <= days.at(-1)! && zoned(e.endsAt, timeZone).day >= days[0]!) : [];
  const cells = timeZone && shown && view === "month" && !q ? monthCells(inDept, shown, timeZone) : [];
  // The month shows an interview on the day it starts, so one still running into its first day is not in it.
  const visible = q ? inDept : view === "month" ? cells.flatMap((c) => c.events) : inView;
  const inOrder = [...inView].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));

  return (
    <Page
      bar={
        <PageBar title="Interview Calendar">
          <div ref={search} className="contents">
            {/* Keyed by the search: the box holds what it was given, and the URL can change under it. */}
            <SearchBox key={q ?? ""} action="/client/schedule" defaultValue={q ?? ""} placeholder="Search interviews…" label="Search interviews" keep={{ view, date: anchor, dept }} />
          </div>
        </PageBar>
      }
      bleed
      // schedule.css: the column fills the box under the bar, so the card, and the grid in it, fill the window.
      className="cal-fit grid-cols-[minmax(0,1fr)] md:flex md:min-h-0 md:flex-1 md:flex-col"
    >
      {banner}
      <div role="status">{notice ? <Notice className="mx-[var(--page-gutter)] mb-3">{notice}</Notice> : null}</div>
      {truncated ? (
        <Notice className="mx-[var(--page-gutter)] mb-3">
          {q ? "Too many interviews to search them all; the oldest are left out." : "Too many interviews to show at once here; some later ones are left off. Try the day or week view."}
        </Notice>
      ) : null}
      {/* One white card: the controls over the grid or the table. Not clipped itself, so the department menu (many departments) can hang past its edge. */}
      <div className="mb-[var(--page-gutter)] flex min-w-0 flex-col rounded-[14px] bg-card shadow-[var(--shadow)] md:mx-[var(--page-gutter)] md:min-h-0 md:flex-1">
        {/* Wraps at every width: beside the sidebar a long department name would push the views off the edge. */}
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[color:var(--line)] px-3 py-3 md:px-4">
          {q ? (
            <>
              <Link href={hrefFor(view, anchor, dept)} className={todayBtn} title="Back to the calendar">
                Clear
              </Link>
              <h2 className="m-0 mr-1 ml-1.5 min-w-0 truncate text-[17px] leading-6 font-semibold tracking-[-0.015em]">Results for “{q}”</h2>
            </>
          ) : (
            <>
              <Link href={hrefFor(view, null, dept)} className={todayBtn} title="Today (.)">
                Today
              </Link>
              <span className="inline-flex">
                <Link href={shown ? hrefFor(view, stepAnchor(view, shown, -1), dept) : "#"} aria-label="Previous" title="Previous (←)" className={stepBtn}>
                  {arrow("M10 3.5 5.5 8l4.5 4.5")}
                </Link>
                <Link href={shown ? hrefFor(view, stepAnchor(view, shown, 1), dept) : "#"} aria-label="Next" title="Next (→)" className={stepBtn}>
                  {arrow("M6 3.5 10.5 8 6 12.5")}
                </Link>
              </span>
              <h2 className="m-0 mr-1 ml-1 text-[17px] leading-6 font-semibold tracking-[-0.015em] whitespace-nowrap">{days.length && shown ? titleOf(view, days, shown) : " "}</h2>
            </>
          )}
          <span className="min-w-2 flex-1" />
          {departments.length && departments.length <= DEPT_SEGMENTS ? (
            <nav aria-label="Department" className={cn(pillTrack, "max-md:order-last")}>
              {[null, ...departments].map((d) => (
                <Link key={d ?? ""} href={hrefFor(view, anchor, d, q)} aria-current={dept === d ? "true" : undefined} className={pillOption(dept === d, "sm")}>
                  {d ?? "Everyone"}
                </Link>
              ))}
            </nav>
          ) : departments.length ? (
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
          {/* A little apart from the departments' track, so the two read as two switches. */}
          <nav aria-label="View" className={cn(pillTrack, "max-md:order-last md:ml-1")}>
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={hrefFor(v.key, anchor, dept)}
                aria-current={!q && v.key === view ? "page" : undefined}
                title={`${v.label} (${v.key[0]!.toUpperCase()})`}
                className={pillOption(!q && v.key === view, "sm")}
              >
                {v.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-b-[14px]">
          {!timeZone || !today ? (
            <div aria-busy className="min-h-[480px] flex-1" />
          ) : q ? (
            <ListOf rows={searchOrder(inDept, now)} timeZone={timeZone} now={now} empty={`No interviews match “${q}”.`} open={openEvent} />
          ) : view === "list" ? (
            <ListOf rows={inOrder} timeZone={timeZone} now={now} empty="No interviews this month." open={openEvent} />
          ) : (
            <>
              {view === "month" ? (
                <MonthGrid cells={cells} timeZone={timeZone} today={today} dept={dept} open={openEvent} />
              ) : (
                <TimeGrid
                  ref={grid}
                  days={days}
                  events={inView}
                  timeZone={timeZone}
                  today={today}
                  now={now}
                  canBook={canBook}
                  held={flow?.kind === "book" && flow.anchor && flow.at ? flow.at : null}
                  open={openEvent}
                  book={(at, anchor) => setFlow({ kind: "book", find: false, at, anchor })}
                  move={(event, to) => setFlow({ kind: "move", event, to })}
                />
              )}
              {visible.length ? null : <Empty className="my-0 flex-none border-t border-[color:var(--line)] px-4 py-3.5">No interviews this {view}.</Empty>}
            </>
          )}
        </div>
      </div>
      {flow && timeZone ? <ScheduleDialog key={flow.kind === "book" ? "book" : "event"} flow={flow} timeZone={timeZone} now={now} go={setFlow} close={() => setFlow(null)} done={setNotice} /> : null}
    </Page>
  );
}
