"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsLeft, ChevronsRight, ChevronsUpDown, Search } from "lucide-react";
import { openCommandMenu } from "@/components/app-shell/command-context";
import { FUNNEL_INSET, Funnel } from "@/components/tickets/funnel";
import { Kbd, TacitMark, ToneLegend, heading, useMod } from "@/components/tickets/kit";
import { TONE_COLOR, toneOfName, worst } from "@/components/tickets/tone";
import type { HomeArrival, HomeTicketsRead } from "@/lib/client/home-tickets";
import { FUNNEL_STAGES, HEALTH, STANDINGS, WAYS, healthOf, standingLabel, standingOf, tally, yearWindow, type Way } from "@/lib/client/home-tickets-rules";

// Home for admins and the hiring team: design/tacit-tickets/src/views/home.tsx,
// on the member's own data (lib/client/home-tickets.ts reads it). A greeting,
// the search field that opens ⌘K, this calendar year of applications as a map of
// days with each way in and the picked day's people, then everyone in process
// now as the isometric blocks, a dot a person, and the picked block's people.
// Left out from the prototype: the Finish Setup button (Onboarding has its own
// checklist), and the demo history (every day here is a real application).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* Days are shaded in the green of work that is moving */
const FILL = ["bg-sel", "bg-s-scheduled/25", "bg-s-scheduled/45", "bg-s-scheduled/70", "bg-s-scheduled"];
const long = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const shade = (n: number, max: number) => (n > 0 ? Math.min(4, Math.ceil(Math.sqrt(n / Math.max(1, max)) * 4)) : 0);
const NONE: Record<Way, number> = { referred: 0, inbound: 0, outreach: 0, other: 0 };
const sum = (c: Record<Way, number>) => c.referred + c.inbound + c.outreach + c.other;

type Day = { at: number; col: number; row: number; off: boolean; counts: Record<Way, number> };

/** Local midnight of an instant, in the member's own time zone. */
const dayOf = (iso: string) => new Date(iso).setHours(0, 0, 0, 0);

function yearOf(today: number, back: number, byDay: Map<number, HomeArrival[]>) {
  const { start, end: last } = yearWindow(new Date(today), back);
  const end = last.getTime();
  const lead = start.getDay();
  const days: Day[] = [];
  const months: { name: string; col: number }[] = [];
  for (let t = new Date(start), i = 0; t.getTime() <= end; t.setDate(t.getDate() + 1), i++) {
    const at = t.getTime();
    const col = Math.floor((lead + i) / 7);
    if (t.getDate() === 1) months.push({ name: MONTHS[t.getMonth()]!, col });
    const counts = { ...NONE };
    for (const a of byDay.get(at) ?? []) counts[a.way] += 1;
    days.push({ at, col, row: t.getDay(), off: at > today, counts: at > today ? NONE : counts });
  }
  const span = start.getMonth() === 0 ? String(start.getFullYear()) : `${MONTHS[start.getMonth()]} ${start.getFullYear()} to ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
  return { days, months, span, weeks: Math.floor((lead + days.length - 1) / 7) + 1 };
}

/* The greeting: one for the hour and a few that fit any time, never the one seen last. Picked in the browser, which knows the hour. */
function pickGreeting(name: string) {
  const hour = new Date().getHours();
  const byHour = hour < 5 ? "Up late, {name}?" : hour < 12 ? "Good morning, {name}" : hour < 18 ? "Good afternoon, {name}" : "Good evening, {name}";
  const lines = [byHour, "Good to see you, {name}", "Welcome back, {name}", "Hello again, {name}", "Back at it, {name}", hour < 12 ? "Coffee and candidates, {name}?" : "Ready when you are, {name}", "Who are we hiring today, {name}?"];
  let last = -1;
  try {
    last = Number(localStorage.getItem("tacit-greeting") ?? -1);
  } catch {
    /* private window: any greeting will do */
  }
  let pick = Math.floor(Math.random() * lines.length);
  if (pick === last) pick = (pick + 1) % lines.length;
  try {
    localStorage.setItem("tacit-greeting", String(pick));
  } catch {
    /* nothing to remember it in */
  }
  return lines[pick]!.replace("{name}", name);
}

/* The first tile of a row: what it is, how many, and one bar split by where they stand */
function Lead({ title, n, none, parts }: { title: string; n: number; none: string; parts: [string, number][] }) {
  return (
    <div className="col-span-2 flex min-h-[84px] flex-col rounded-lg bg-hover px-3.5 py-3">
      <span className="font-medium text-ink">{title}</span>
      {n ? (
        <>
          <span className="mt-1.5 flex items-baseline gap-1.5 text-mute">
            <span className="text-[22px] leading-none font-medium tracking-[-0.01em] text-ink tabular-nums">{n}</span>
            {n === 1 ? "person" : "people"}
          </span>
          <span className="mt-3 flex h-1.5 gap-0.5" aria-hidden="true">
            {parts.map(([name, k]) => (
              <span key={name} title={`${k} ${name}`} className="rounded-full" style={{ flex: k, background: TONE_COLOR[toneOfName(name)] }} />
            ))}
          </span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-mute tabular-nums">
            {parts.map(([name, k]) => (
              <span key={name}>
                <span className="font-medium text-ink">{k}</span> {name}
              </span>
            ))}
          </span>
        </>
      ) : (
        <span className="mt-auto text-mute">{none}</span>
      )}
    </div>
  );
}

// A person's tile, set as Testbench sets a candidate's card: the name in Mona Sans, the job and
// the pill in the code face. No border: the tint is the tile.
const tileCls = "flex min-h-[84px] min-w-0 flex-col rounded-lg px-3.5 py-3 text-left transition-colors";
const tileName = "w-full truncate font-[family-name:var(--font-display)] text-[14px] font-medium tracking-[-0.01em] text-ink";
const tileJob = "mt-0.5 w-full truncate font-[family-name:var(--font-code)] text-xs text-mute";
/** Where someone stands, as a pill on their tile. */
function TilePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-auto flex w-full min-w-0 pt-2.5">
      <span className="inline-flex h-6 max-w-full items-center rounded-md bg-[rgb(var(--fg-rgb)/0.07)] px-2 font-[family-name:var(--font-code)] text-xs text-ink">
        <span className="truncate">{children}</span>
      </span>
    </span>
  );
}

export function HomeTickets({ firstName, read }: { firstName: string; read: HomeTicketsRead }) {
  const mod = useMod("K");
  const router = useRouter();
  /* Today and the greeting are the browser's: the server knows neither the member's day nor their hour */
  const [today, setToday] = useState<number | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [tiles, setTiles] = useState({ day: true, stage: true });
  useEffect(() => {
    setToday(new Date().setHours(0, 0, 0, 0));
    setGreeting(firstName ? pickGreeting(firstName) : "Welcome back");
    try {
      setTiles((t) => ({ ...t, ...JSON.parse(localStorage.getItem("tacit-home-people") ?? "{}") }));
    } catch {
      /* the default: both open */
    }
  }, [firstName]);

  const byDay = useMemo(() => {
    const m = new Map<number, HomeArrival[]>();
    for (const a of read.arrivals) {
      const k = dayOf(a.at);
      const list = m.get(k);
      if (list) list.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [read.arrivals]);
  /* How far back the map goes: to the first month the read covers */
  const furthest = useMemo(() => {
    if (today === null) return 0;
    const t = new Date(today);
    const from = new Date(`${read.from}T12:00:00`);
    return Math.max(0, (t.getFullYear() - from.getFullYear()) * 12 - from.getMonth() - (from.getDate() > 1 ? 1 : 0));
  }, [today, read.from]);

  const [back, setBack] = useState(0);
  /* On a narrow screen the map scrolls: open it on today, not January */
  const mapScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mapScroll.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [today, back]);
  const step = (by: number) => setBack((b) => Math.max(0, Math.min(furthest, b + by)));
  const [way, setWay] = useState<Way | null>(null);
  const [hover, setHover] = useState<Way | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [pickedStage, setPickedStage] = useState<number | null>(null);

  const togglePeople = (k: "day" | "stage") => {
    const next = { ...tiles, [k]: !tiles[k] };
    setTiles(next);
    try {
      localStorage.setItem("tacit-home-people", JSON.stringify(next));
    } catch {
      /* it lasts for this visit */
    }
  };

  /* Until the browser has said what day it is, the map is drawn on the server's, without counts */
  const now = today ?? new Date().setHours(0, 0, 0, 0);
  const year = yearOf(now, back, today === null ? new Map() : byDay);
  const columns = `repeat(${year.weeks}, minmax(0, 1fr))`;
  const stepBtn = "flex size-4 items-center justify-center rounded text-dim opacity-0 transition-opacity group-hover/map:opacity-100 hover:text-ink focus-visible:opacity-100";
  const lens = hover ?? way;
  const of = (d: Day) => (lens ? d.counts[lens] : sum(d.counts));
  const days = year.days.filter((d) => !d.off);
  const max = Math.max(...days.map(of), 1);
  const total = (k: Way) => days.reduce((n, d) => n + d.counts[k], 0);
  const all = WAYS.reduce((n, w) => n + total(w.key), 0);
  const day = days.find((d) => d.at === picked) ?? [...days].reverse().find((d) => of(d) > 0) ?? days[days.length - 1] ?? year.days[0]!;
  const dayPeople = byDay.get(day.at) ?? [];
  const standings = tally(STANDINGS, dayPeople.map((a) => standingOf(a.stage)));
  const unique = dayPeople.filter((a, i) => dayPeople.findIndex((b) => b.personId === a.personId) === i);
  const wayLabel = (w: Way) => WAYS.find((x) => x.key === w)!.label.toLowerCase();

  /* The funnel: a block per stage, a dot per live application */
  const funnel = FUNNEL_STAGES.map((st) => {
    const here = read.live.filter((l) => l.column === st.key);
    const tone = worst(here.map((l) => l.tone));
    return {
      key: st.key,
      name: st.label,
      tone: tone ? TONE_COLOR[tone] : undefined,
      dots: here.map((l) => ({ id: l.applicationId, name: l.name, sub: l.job, note: l.next ?? undefined, tone: TONE_COLOR[l.tone] })),
    };
  });
  const inProcess = read.live.length;
  const stage = pickedStage ?? funnel.reduce((best, f, i) => (f.dots.length > funnel[best]!.dots.length ? i : best), 0);
  const inStage = read.live.filter((l) => l.column === funnel[stage]!.key);
  const health = tally(HEALTH, inStage.map((l) => healthOf(l.stalled)));
  const TILES = 4;
  const shownTiles = inStage.length > TILES ? inStage.slice(0, TILES - 1) : inStage;
  const byApplication = new Map(read.live.map((l) => [l.applicationId, l]));

  const minimizer = (k: "day" | "stage") => (
    <button
      type="button"
      onClick={() => togglePeople(k)}
      aria-expanded={tiles[k]}
      aria-label={tiles[k] ? "Hide the people" : "Show the people"}
      title={tiles[k] ? "Hide the people" : "Show the people"}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink"
    >
      <span className="relative size-[15px]">
        <ChevronsDownUp size={15} className={`absolute inset-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${tiles[k] ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
        <ChevronsUpDown size={15} className={`absolute inset-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${tiles[k] ? "scale-50 opacity-0" : "scale-100 opacity-100"}`} />
      </span>
    </button>
  );
  const fold = (k: "day" | "stage", children: ReactNode) => (
    <div inert={!tiles[k]} className={`-mx-5 grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none @max-2xl:-mx-4 ${tiles[k] ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
  const fit = !tiles.day && !tiles.stage;
  const cap = read.truncated ? "+" : "";

  return (
    <div className="@container -mx-[var(--page-gutter)] -my-7 flex-1">
      <div className={`mx-auto max-w-[1040px] px-6 py-6 @max-2xl:px-4 ${fit ? "[--home-fixed:596px] [@media(max-height:820px)]:py-4 [@media(max-height:820px)]:[--home-fixed:540px]" : ""}`}>
        <header className={`relative px-1 pt-8 pb-7 @max-2xl:pt-4 @max-2xl:pb-5 ${fit ? "[@media(max-height:820px)]:pt-3 [@media(max-height:820px)]:pb-4" : ""}`}>
          <h1 className="flex min-h-[39px] items-center gap-3.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink @max-2xl:gap-2.5 @max-2xl:text-[26px]">
            <span className="shrink-0">
              <TacitMark size={30} />
            </span>
            {greeting ? <span className="anim-rise">{greeting}</span> : <span className="sr-only">Home</span>}
          </h1>
          {/* Search for anything in the ATS: this opens the command menu */}
          <button
            type="button"
            data-tour="home-search"
            onClick={openCommandMenu}
            className={`-mx-1 mt-6 ${fit ? "[@media(max-height:820px)]:mt-4" : ""} flex h-12 w-[calc(100%+8px)] items-center gap-3 rounded-xl border border-line-strong px-4 text-left text-mute transition-colors hover:border-mute hover:text-body`}
          >
            <Search size={16} className="shrink-0 text-dim" />
            <span className="min-w-0 flex-1 truncate">Search people, jobs and pages</span>
            <Kbd>{mod}</Kbd>
          </button>
        </header>

        <section className="rounded-xl border border-line-strong px-5 pt-4 pb-5 @max-2xl:px-4">
          <div className="flex items-center gap-2">
            <h2 className={`${heading} min-w-0 flex-1 tabular-nums`}>
              {today === null ? "Applications" : `${all.toLocaleString("en-US")}${cap} ${all === 1 ? "application" : "applications"} in ${year.span}`}
            </h2>
            {minimizer("day")}
          </div>

          {today === null ? (
            /* The browser's own day decides which square is today: until then, the map's room */
            <div aria-hidden className="mt-5 h-[150px] rounded-lg bg-hover/60 @max-2xl:h-[110px]" />
          ) : (
          <div className="group/map mt-5 flex gap-2">
            <div className="flex w-9 shrink-0 flex-col text-xs text-dim">
              <span className="mb-[3px] flex h-4 items-center gap-0.5">
                {back < furthest && (
                  <>
                    <button type="button" aria-label="Back a year" title="Back a year" onClick={() => step(12)} className={stepBtn}>
                      <ChevronsLeft size={13} />
                    </button>
                    <button type="button" aria-label="Back a month" title="Back a month" onClick={() => step(1)} className={stepBtn}>
                      <ChevronLeft size={13} />
                    </button>
                  </>
                )}
              </span>
              <span className="relative flex-1" aria-hidden="true">
                <span className="absolute inset-0 grid grid-rows-[repeat(7,minmax(0,1fr))] items-center gap-[3px] leading-none">
                  <span className="row-start-2">Mon</span>
                  <span className="row-start-4">Wed</span>
                  <span className="row-start-6">Fri</span>
                </span>
              </span>
            </div>
            <div ref={mapScroll} className="scroll-quiet min-w-0 flex-1 overflow-x-auto">
              <div className={`mx-auto transition-[max-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${fit ? "min-w-[440px]" : "min-w-[600px]"}`} style={{ maxWidth: fit ? "calc((100vh - var(--home-fixed)) * 2.71)" : "1040px" }}>
                <div className="relative mb-[3px] grid h-4 gap-x-[3px] text-xs text-dim" style={{ gridTemplateColumns: columns }}>
                  {year.months.map((m) => (
                    <span key={`${m.name}${m.col}`} className="whitespace-nowrap" style={{ gridColumn: m.col + 1 }} aria-hidden="true">
                      {m.name}
                    </span>
                  ))}
                  {back > 0 && (
                    <span className="absolute top-0 right-0 flex h-4 items-center gap-0.5 bg-panel pl-1">
                      <button type="button" aria-label="Forward a month" title="Forward a month" onClick={() => step(-1)} className={stepBtn}>
                        <ChevronRight size={13} />
                      </button>
                      <button type="button" aria-label="Forward a year" title="Forward a year" onClick={() => step(-12)} className={stepBtn}>
                        <ChevronsRight size={13} />
                      </button>
                    </span>
                  )}
                </div>
                <div key={back} className="grid gap-[3px]" role="group" aria-label={`Applications each day, ${year.span}`} style={{ gridTemplateColumns: columns }}>
                  {year.days.map((d) => {
                    const place = { gridColumn: d.col + 1, gridRow: d.row + 1 };
                    return d.off ? (
                      <span key={d.at} title={long.format(d.at)} className="aspect-square rounded-[3px] border border-line" style={place} />
                    ) : (
                      <button
                        type="button"
                        key={d.at}
                        aria-pressed={d.at === day.at}
                        aria-label={`${long.format(d.at)}, ${of(d)}`}
                        title={`${long.format(d.at)}: ${of(d)}`}
                        onClick={() => setPicked(d.at)}
                        style={place}
                        className={`aspect-square rounded-[3px] transition-colors ${FILL[shade(of(d), max)]} ${d.at === day.at ? "outline-2 outline-offset-1 outline-ink" : "hover:outline-1 hover:outline-mute"}`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          )}

          <div className="mt-4 flex flex-wrap items-center gap-1 pl-11 @max-2xl:pl-0">
            {WAYS.filter((w) => w.key !== "other" || total("other") > 0).map((w) => (
              <button
                type="button"
                key={w.key}
                aria-pressed={way === w.key}
                onClick={() => setWay(way === w.key ? null : w.key)}
                onMouseEnter={() => setHover(w.key)}
                onMouseLeave={() => setHover(null)}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${way === w.key ? "bg-sel text-ink" : "text-mute hover:text-ink"}`}
              >
                {w.label} <span className="text-dim tabular-nums">{total(w.key).toLocaleString("en-US")}</span>
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1 text-xs text-dim" aria-hidden="true">
              Less
              {FILL.map((f) => (
                <span key={f} className={`size-2.5 rounded-[3px] ${f}`} />
              ))}
              More
            </span>
          </div>

          {fold(
            "day",
            <div key={day.at} className="anim-rise mt-5 grid grid-cols-2 gap-2 border-t border-line px-5 pt-5 @max-2xl:px-4 @2xl:grid-cols-4 @5xl:grid-cols-6">
              <Lead title={long.format(day.at)} n={unique.length} none="Nobody came in" parts={standings} />
              {unique.slice(0, 4).map((a) => (
                <Link key={a.personId} href={`/client/candidates/${a.personId}`} className={`tint-${a.tone} ${tileCls}`}>
                  <span className={tileName}>{a.name}</span>
                  <span className={tileJob}>{a.job}</span>
                  <TilePill>
                    {standingLabel(a.stage)}, {wayLabel(a.way)}
                  </TilePill>
                </Link>
              ))}
            </div>,
          )}
        </section>

        <section className="mt-3 rounded-xl border border-line-strong px-5 pt-4 pb-5 @max-2xl:px-4" data-tour="funnel">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h2 className={`${heading} tabular-nums`}>
              {inProcess}
              {read.truncated ? "+" : ""} in process now
            </h2>
            <ToneLegend className="ml-auto" />
            <span className="self-center">{minimizer("stage")}</span>
          </div>
          <div className="mt-4 flex items-center gap-8">
            <div className="scroll-quiet min-w-0 flex-1 overflow-x-auto">
              <div className={`mx-auto transition-[max-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${fit ? "min-w-[460px]" : "min-w-[560px]"}`} style={{ maxWidth: fit ? "calc((100vh - var(--home-fixed)) * 2.87)" : "1040px" }}>
                <Funnel
                  stages={funnel}
                  picked={stage}
                  hot={hot}
                  setHot={setHot}
                  onStage={setPickedStage}
                  onDot={(_, id) => {
                    const l = byApplication.get(id);
                    if (l) router.push(`/client/candidates/${l.personId}`);
                  }}
                />
                <div className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${funnel.length}, minmax(0, 1fr))`, marginRight: FUNNEL_INSET }}>
                  {funnel.map((f, i) => (
                    <button
                      type="button"
                      key={f.name}
                      onClick={() => setPickedStage(i)}
                      aria-pressed={stage === i}
                      onMouseEnter={() => setHot(i)}
                      onMouseLeave={() => setHot(null)}
                      className="flex min-w-0 flex-col items-center gap-1 px-1.5 text-center"
                    >
                      <span className="text-[15px] leading-none font-semibold text-ink tabular-nums">{f.dots.length}</span>
                      <span className={`max-w-full truncate leading-tight transition-colors ${hot === i || stage === i ? "text-ink" : "text-mute"}`}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {fold(
            "stage",
            <div key={stage} className="anim-rise mt-5 grid grid-cols-2 gap-2 border-t border-line px-5 pt-5 @max-2xl:px-4 @2xl:grid-cols-4 @5xl:grid-cols-6">
              <Lead title={funnel[stage]!.name} n={inStage.length} none="Nobody here" parts={health} />
              {shownTiles.map((l) => (
                <Link key={l.applicationId} href={`/client/candidates/${l.personId}`} className={`tint-${l.tone} ${tileCls}`}>
                  <span className={tileName}>{l.name}</span>
                  <span className={tileJob}>{l.job}</span>
                  <TilePill>{l.next ?? "Nothing set"}</TilePill>
                </Link>
              ))}
              {inStage.length > TILES && (
                <Link
                  href={`/client/pipeline?mode=everyone&stage=${funnel[stage]!.key}`}
                  className="flex min-h-[84px] items-center justify-center rounded-lg border border-dashed border-line-strong text-mute transition-colors hover:text-ink"
                >
                  +{inStage.length - shownTiles.length} more
                </Link>
              )}
            </div>,
          )}
        </section>
      </div>
    </div>
  );
}
