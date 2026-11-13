"use client";

import { useSyncExternalStore } from "react";
import { todayIn, zoned } from "@/lib/client/schedule-layout";

// A day as design/tats's CRM writes it ("Today", "Yesterday", "Oct 3",
// "Oct 3, 2025"), and a time of day in 12-hour form ("6:40 PM"), in the
// browser's own time zone. The server never names a day: it renders
// `fallback` (a relative "3d ago", right in every zone), and the browser swaps
// in the day once it knows its zone, the way the schedule page places its
// interviews (a null server snapshot, so the first paint matches the server's).

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/** "Today", "Yesterday", "Tomorrow", else "Oct 3" (with the year when it is not this one), in `timeZone`. */
export function dayWord(iso: string, now: number, timeZone: string): string {
  const day = zoned(iso, timeZone).day;
  const today = todayIn(timeZone, now);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  return dateWord(iso, now, timeZone);
}

const twoDigits = (n: number) => String(n).padStart(2, "0");

/** A time of day in 12-hour form, as people say it: "6:40 PM", and "10 AM" on the hour. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${twoDigits(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** design/tats's `ibWhen`: the time today, the weekday and the time this past week, else the day and the time. */
export function whenWord(iso: string, now: number, timeZone: string): string {
  const { day, minutes } = zoned(iso, timeZone);
  if (day === todayIn(timeZone, now)) return clock(minutes);
  const near = Math.abs(now - Date.parse(iso)) < 6 * DAY;
  const word = near ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : dayWord(iso, now, timeZone);
  return `${word} ${clock(minutes)}`;
}

/** What follows "for" in a sentence: "tomorrow 2 PM", "Oct 3 2:30 PM". */
export function forWord(iso: string, now: number, timeZone: string): string {
  const word = dayWord(iso, now, timeZone);
  return `${/^[TY]/.test(word) ? word.toLowerCase() : word} ${clock(zoned(iso, timeZone).minutes)}`;
}

/** When something happened, in the browser's zone; `fallback` until it knows its zone. */
export function LocalWhen({ iso, fallback }: { iso: string; fallback: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  return <>{whenWord(iso, Date.now(), timeZone)}</>;
}

/** The end of a sentence saying when an interview is: " for tomorrow 2 PM." Only the full stop until the browser knows its zone. */
export function LocalForEnd({ iso }: { iso: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>.</>;
  return <> for {forWord(iso, Date.now(), timeZone)}.</>;
}

/** When something happened in a feed: the time if it was today ("6:40 PM"), else the day as LocalDay words it. */
export function LocalStamp({ iso, fallback }: { iso: string; fallback: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  const { day, minutes } = zoned(iso, timeZone);
  return <>{day === todayIn(timeZone, Date.now()) ? clock(minutes) : dayWord(iso, Date.now(), timeZone)}</>;
}

/** "Oct 3" (with the year when it is not this one) in `timeZone`, never "Today" or "Yesterday". */
export function dateWord(iso: string, now: number, timeZone: string): string {
  const day = zoned(iso, timeZone).day;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}${day.slice(0, 4) !== todayIn(timeZone, now).slice(0, 4) ? `, ${y}` : ""}`;
}

/**
 * `dated`: always the date ("Nov 11", never "Yesterday"), for a step card's
 * one line, where a date is shorter than the word and reads alike on every step.
 */
export function LocalDay({ iso, fallback, dated = false }: { iso: string; fallback: string; dated?: boolean }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  return <>{dated ? dateWord(iso, Date.now(), timeZone) : dayWord(iso, Date.now(), timeZone)}</>;
}
