"use client";

import { useSyncExternalStore } from "react";
import { todayIn, zoned } from "@/lib/client/schedule-layout";

// A day as design/tats's CRM writes it ("Today", "Yesterday", "Oct 3",
// "Oct 3, 2025"), in the browser's own time zone. The server never names a
// day: it renders `fallback` (a relative "3d ago", right in every zone), and
// the browser swaps in the day once it knows its zone, the way the schedule
// page places its interviews (a null server snapshot, so the first paint
// matches the server's).

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
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}${day.slice(0, 4) !== today.slice(0, 4) ? `, ${y}` : ""}`;
}

const twoDigits = (n: number) => String(n).padStart(2, "0");
const clock = (minutes: number) => `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;

/** design/tats's `ibWhen`: the time today, the weekday and the time this past week, else the day and the time. */
export function whenWord(iso: string, now: number, timeZone: string): string {
  const { day, minutes } = zoned(iso, timeZone);
  if (day === todayIn(timeZone, now)) return clock(minutes);
  const near = Math.abs(now - Date.parse(iso)) < 6 * DAY;
  const word = near ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : dayWord(iso, now, timeZone);
  return `${word} ${clock(minutes)}`;
}

/** What follows "for" in a sentence: "tomorrow 14:00", "Oct 3 14:00". */
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

/** The end of a sentence saying when an interview is: " for tomorrow 14:00." Only the full stop until the browser knows its zone. */
export function LocalForEnd({ iso }: { iso: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>.</>;
  return <> for {forWord(iso, Date.now(), timeZone)}.</>;
}

export function LocalDay({ iso, fallback }: { iso: string; fallback: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  return <>{dayWord(iso, Date.now(), timeZone)}</>;
}
