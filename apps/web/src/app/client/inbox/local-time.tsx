"use client";

import { useSyncExternalStore } from "react";
import { todayIn, zoned } from "@/lib/client/schedule-layout";
import { dayWord } from "../candidates/local-day";

// The Inbox's times on a 12-hour clock ("6:40 PM", "10 AM"), in the browser's
// own zone, as candidates/local-day.tsx words its days: the server renders the
// relative `fallback` (right in every zone), and the browser swaps in the time
// once it knows its zone, with a null server snapshot so the first paint matches.

const DAY = 86_400_000;
const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/** "6:40 PM", and "10 AM" on the hour. */
export function clock12(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** design/tats's `ibWhen` on a 12-hour clock: the time today, the weekday and the time this past week, else the day and the time. */
export function whenWord12(iso: string, now: number, timeZone: string): string {
  const { day, minutes } = zoned(iso, timeZone);
  if (day === todayIn(timeZone, now)) return clock12(minutes);
  const near = Math.abs(now - Date.parse(iso)) < 6 * DAY;
  const word = near ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : dayWord(iso, now, timeZone);
  return `${word} ${clock12(minutes)}`;
}

/** What follows "for" in a sentence: "tomorrow 2 PM", "Oct 3 2 PM". */
export function forWord12(iso: string, now: number, timeZone: string): string {
  const word = dayWord(iso, now, timeZone);
  return `${/^[TY]/.test(word) ? word.toLowerCase() : word} ${clock12(zoned(iso, timeZone).minutes)}`;
}

/** When something happened; `fallback` until the browser knows its zone. */
export function When({ iso, fallback }: { iso: string; fallback: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  return <>{whenWord12(iso, Date.now(), timeZone)}</>;
}

/** The end of an entry saying when an interview is: " for tomorrow 2 PM", with no full stop, as an entry's line has none. Nothing until the browser knows its zone. */
export function ForEnd({ iso }: { iso: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return null;
  return <> for {forWord12(iso, Date.now(), timeZone)}</>;
}
