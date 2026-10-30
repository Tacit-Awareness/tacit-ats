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

export function LocalDay({ iso, fallback }: { iso: string; fallback: string }) {
  const timeZone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  if (!timeZone || Number.isNaN(Date.parse(iso))) return <>{fallback}</>;
  return <>{dayWord(iso, Date.now(), timeZone)}</>;
}
