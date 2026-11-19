"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// design/tacit-tickets's Week: this week, Monday to Friday, 9 to 6, a block per
// interview at its time. Drawn in the browser, which knows the member's time
// zone; the server does not, so until then the grid is empty.

export type WeekItem = { id: string; name: string; step: string; startsAt: string; endsAt: string; done: boolean; href: string; picked: boolean };

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const H = 56;
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function Week({ items }: { items: WeekItem[] }) {
  const [monday, setMonday] = useState<Date | null>(null);
  useEffect(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    setMonday(d);
  }, []);
  const days = monday ? Array.from({ length: 5 }, (_, n) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + n)) : [];
  return (
    <div className="scroll-quiet flex-1 overflow-auto">
      <div className="grid min-w-[640px] grid-cols-[48px_repeat(5,minmax(0,1fr))]">
        <div className="sticky top-0 z-10 h-9 bg-panel" />
        {(days.length ? days : Array.from({ length: 5 }, () => null)).map((d, n) => (
          <div key={n} className="sticky top-0 z-10 flex h-9 items-center border-l border-line bg-panel px-3 text-xs text-dim">
            {d ? (
              <>
                {DAY.format(d)} <span className="ml-1.5 tabular-nums">{d.getDate()}</span>
              </>
            ) : null}
          </div>
        ))}
        <div className="relative" style={{ height: HOURS.length * H }}>
          {HOURS.map((h, n) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-xs text-dim tabular-nums" style={{ top: n * H }}>
              {n > 0 && (h > 12 ? h - 12 : h)}
            </span>
          ))}
        </div>
        {Array.from({ length: 5 }, (_, day) => (
          <div key={day} className="relative border-l border-line" style={{ height: HOURS.length * H }}>
            {HOURS.map((h, n) => (
              <span key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: n * H }} />
            ))}
            {days[day] &&
              items
                .filter((i) => new Date(i.startsAt).toDateString() === days[day]!.toDateString())
                .map((i) => {
                  const s = new Date(i.startsAt);
                  const start = s.getHours() + s.getMinutes() / 60;
                  const mins = (Date.parse(i.endsAt) - Date.parse(i.startsAt)) / 60_000;
                  const top = Math.max(0, Math.min(HOURS.length - 0.5, start - 9)) * H + 2;
                  return (
                    <Link
                      key={i.id}
                      href={i.href}
                      scroll={false}
                      style={{ top, height: Math.max((mins / 60) * H - 4, 26) }}
                      className={`absolute inset-x-1.5 overflow-hidden rounded-md border px-2 py-1 text-left transition-colors ${i.picked ? "border-mute bg-sel" : "border-line-strong bg-hover hover:border-mute"} ${i.done ? "opacity-60" : ""}`}
                    >
                      <span className="block truncate text-xs font-medium text-ink">{i.name}</span>
                      {mins >= 60 && <span className="block truncate text-xs text-mute">{i.step}</span>}
                    </Link>
                  );
                })}
          </div>
        ))}
      </div>
    </div>
  );
}
