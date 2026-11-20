import { useState, type ReactNode } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight, Search, Check, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { STAFF, STAGES } from "../data"
import { ME } from "../org"
import { Empty, heading, Pill, TONE_COLOR, toneOfName, worst, ToneLegend, Menu } from "../kit"
import { useStore } from "../store"
import { Kbd, TacitMark, mod } from "../ui"
import type { View } from "../types"
import { FUNNEL_INSET, Funnel } from "./funnel"

/*
 * Home: tATS's Recruiting Overview. Applications over time as this calendar year of days (a square
 * a day, a column a week, the days still to come empty), stepping back a month or a year,
 * each way in with its count, and the picked day's people under it. Then one funnel of everyone in
 * process now, by stage.
 */

type Way = "referred" | "inbound" | "outreach"
const WAYS: { key: Way; label: string }[] = [
  { key: "referred", label: "Referred" },
  { key: "inbound", label: "Inbound" },
  { key: "outreach", label: "Reached Out" },
]
const DAY = 86_400_000
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
/* Days are shaded in the green of work that is moving */
const FILL = ["bg-raised", "bg-s-scheduled/25", "bg-s-scheduled/45", "bg-s-scheduled/70", "bg-s-scheduled"]
const long = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
})

/* A count's shade, 0 to 4, against the busiest day, on a square-root scale so quiet days still show */
const shade = (n: number, max: number) =>
  n > 0 ? Math.min(4, Math.ceil(Math.sqrt(n / Math.max(1, max)) * 4)) : 0

type Day = {
  at: number
  col: number
  row: number
  off: boolean
  counts: Record<Way, number>
}
const NONE: Record<Way, number> = { referred: 0, inbound: 0, outreach: 0 }
/* How far back the map goes, in months */
const FURTHEST = 24

/* Demo history: a day's counts come from its own date, so every window shows the same days. Steadier on weekdays, busier lately. */
function countsOn(at: number): Record<Way, number> {
  const d = new Date(at)
  let seed =
    ((d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) * 2654435761) %
    4294967296
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  rand()
  const weekend = d.getDay() === 0 || d.getDay() === 6
  const lift = Math.max(
    0.35,
    0.5 +
      ((d.getFullYear() - new Date().getFullYear()) * 12 + d.getMonth()) / 11
  )
  const draw = (rate: number) => {
    const x = rand()
    return Math.floor(
      Math.max(0, (x * x * rate * lift - (weekend ? 0.9 : 0.15)) * 1.4)
    )
  }
  return { referred: draw(1.6), inbound: draw(3.4), outreach: draw(2.2) }
}

/* Twelve months of days: this calendar year when `back` is 0, a month earlier for each step back. A day after today is `off`: shown, empty, not to be picked. */
function yearOf(today: number, back: number) {
  const y = new Date(today).getFullYear()
  const start = new Date(y, -back, 1)
  const end = new Date(y, 12 - back, 0).getTime()
  const lead = start.getDay()
  const days: Day[] = []
  const months: { name: string; col: number }[] = []
  for (
    let t = new Date(start), i = 0;
    t.getTime() <= end;
    t.setDate(t.getDate() + 1), i++
  ) {
    const at = t.getTime()
    const col = Math.floor((lead + i) / 7)
    if (t.getDate() === 1) months.push({ name: MONTHS[t.getMonth()], col })
    days.push({
      at,
      col,
      row: t.getDay(),
      off: at > today,
      counts: at > today ? NONE : countsOn(at),
    })
  }
  const last = new Date(end)
  const span =
    start.getMonth() === 0
      ? String(start.getFullYear())
      : `${MONTHS[start.getMonth()]} ${start.getFullYear()} to ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
  return {
    days,
    months,
    span,
    weeks: Math.floor((lead + days.length - 1) / 7) + 1,
  }
}

/*
 * The greeting: one for the hour and a few that fit any time. It is picked once each time the app
 * loads, never the one you saw last, and stays put while you move around.
 */
const GREETING = (() => {
  const hour = new Date().getHours()
  const byHour = hour < 5 ? "Up late, {name}?" : hour < 12 ? "Good morning, {name}" : hour < 18 ? "Good afternoon, {name}" : "Good evening, {name}"
  const lines = [byHour, "Good to see you, {name}", "Welcome back, {name}", "Hello again, {name}", "Back at it, {name}", hour < 12 ? "Coffee and candidates, {name}?" : "Ready when you are, {name}", "Who are we hiring today, {name}?"]
  let last = -1
  try {
    last = Number(localStorage.getItem("tacit-greeting") ?? -1)
  } catch {
    /* private window: any greeting will do */
  }
  let pick = Math.floor(Math.random() * lines.length)
  if (pick === last) pick = (pick + 1) % lines.length
  try {
    localStorage.setItem("tacit-greeting", String(pick))
  } catch {
    /* nothing to remember it in */
  }
  return (name: string) => lines[pick].replace("{name}", name)
})()

/* Counts by name, in a fixed order, leaving out what is empty */
const tally = (order: string[], of: string[]): [string, number][] => order.map((k): [string, number] => [k, of.filter((x) => x === k).length]).filter((x) => x[1] > 0)

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
  )
}

export function Home() {
  const s = useStore()
  const [today] = useState(() => new Date().setHours(0, 0, 0, 0))
  const [back, setBack] = useState(0)
  const step = (by: number) =>
    setBack((b) => Math.max(0, Math.min(FURTHEST, b + by)))
  const year = yearOf(today, back)
  const columns = `repeat(${year.weeks}, minmax(0, 1fr))`
  const stepBtn =
    "flex size-4 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover/map:opacity-100 hover:text-ink focus-visible:opacity-100"
  const [way, setWay] = useState<Way | null>(null)
  const [hover, setHover] = useState<Way | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const lens = hover ?? way
  const of = (d: Day) =>
    lens
      ? d.counts[lens]
      : d.counts.referred + d.counts.inbound + d.counts.outreach
  const days = year.days.filter((d) => !d.off)
  const max = Math.max(...days.map(of), 1)
  const total = (k: Way) => days.reduce((n, d) => n + d.counts[k], 0)
  const all = total("referred") + total("inbound") + total("outreach")
  const day =
    days.find((d) => d.at === picked) ??
    [...days].reverse().find((d) => of(d) > 0) ??
    days[days.length - 1] ??
    year.days[0]
  const dayTotal =
    day.counts.referred + day.counts.inbound + day.counts.outreach

  /* Who came in on the picked day: demo data draws them from the people on file */
  const people = (() => {
    const pool = s.people
    const order = WAYS.flatMap((w) =>
      Array.from({ length: day.counts[w.key] }, () => w)
    )
    const from = Math.floor(day.at / DAY)
    return order
      .slice(0, pool.length)
      .map((w, i) => ({
        p: pool[(from * 7 + i * 5) % pool.length],
        way: w.label,
      }))
  })()
  /* Where the people who came in that day stand now */
  const standing = (p: (typeof s.people)[number]) => (p.closed === "Rejected" ? "rejected" : p.closed === "Hired" ? "hired" : p.closed === "Withdrawn" ? "withdrew" : p.stage <= 1 ? "awaiting review" : STAGES[p.stage].toLowerCase())
  const standings = tally(["awaiting review", "screening", "interviewing", "offer", "hired", "rejected", "withdrew"], people.map((x) => standing(x.p)))
  const unique = people.filter(
    (x, i) => people.findIndex((y) => y.p.id === x.p.id) === i
  )

  const greeting = GREETING(STAFF[ME].first)
  /* The tiles of people under each chart can be put away; the choice stays in this browser */
  const [tiles, setTiles] = useState<{ day: boolean; stage: boolean }>(() => {
    try {
      return { day: true, stage: true, ...JSON.parse(localStorage.getItem("tacit-home-people") ?? "{}") }
    } catch {
      return { day: true, stage: true }
    }
  })
  const togglePeople = (k: "day" | "stage") => {
    const next = { ...tiles, [k]: !tiles[k] }
    setTiles(next)
    try {
      localStorage.setItem("tacit-home-people", JSON.stringify(next))
    } catch {
      /* it lasts for this visit */
    }
  }
  /* With both put away, the two charts are sized to the window's height so they sit on one screen */
  const fit = !tiles.day && !tiles.stage
  const minimizer = (k: "day" | "stage") => (
    <button
      onClick={() => togglePeople(k)}
      aria-expanded={tiles[k]}
      aria-label={tiles[k] ? "Hide the people" : "Show the people"}
      title={tiles[k] ? "Hide the people" : "Show the people"}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-raised hover:text-ink"
    >
      {/* Both marks sit in one place and trade over, so the button turns into the other one */}
      <span className="relative size-[15px]">
        <ChevronsDownUp size={15} className={`absolute inset-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${tiles[k] ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
        <ChevronsUpDown size={15} className={`absolute inset-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${tiles[k] ? "scale-50 opacity-0" : "scale-100 opacity-100"}`} />
      </span>
    </button>
  )
  /* The people under a chart: they open and close by height, and cannot be reached while shut */
  const fold = (k: "day" | "stage", children: ReactNode) => (
    <div inert={!tiles[k]} className={`-mx-5 grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none @max-2xl:-mx-4 ${tiles[k] ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
  /* Setting up, step by step. The rounds are the one a new company has not done. */
  const [setupAway, setSetupAway] = useState(false)
  const steps: { name: string; line: string; done: boolean; go: () => void }[] = [
    { name: "Connect Claude Or Your Bot", line: "So it can work your pipeline", done: s.integrations.some((i) => i.id === "bot" && i.on), go: () => { s.setSettings("Connector"); s.go("settings", null) } },
    { name: "Build Your Interview Rounds", line: `${s.rounds.length} rounds, not reviewed yet`, done: s.roundsBuilt, go: () => s.setSheet({ kind: "rounds" }) },
    { name: "Invite Your Team", line: `${Object.keys(STAFF).length} people`, done: Object.keys(STAFF).length > 1, go: () => { s.setSettings("Members"); s.go("settings", null) } },
    { name: "Post Your First Role", line: `${s.roles.length} roles`, done: s.roles.length > 0, go: () => s.go("asks", null) },
  ]
  const setup = { steps, left: steps.filter((x) => !x.done).length }

  /* The funnel: one tapered outline, a section a stage, a dot a person. Those still to be routed are at its mouth. */
  const open = s.people.filter((p) => !p.closed)
  const funnel: {
    name: string
    to: View
    tone?: string; dots: { id: string; name: string; person: boolean; sub?: string; note?: string; tone?: string }[]
  }[] = [
    {
      name: "New",
      to: "triage",
      tone: s.triage.length ? TONE_COLOR.needs : undefined,
      dots: s.triage.map((a) => ({ id: a.id, name: a.name, person: false, sub: s.roleOf(a.role).title, note: "Waiting to be routed", tone: TONE_COLOR.needs })),
    },
    ...STAGES.map((name, i) => ({
      name,
      to: "people" as View,
      tone: ((t) => (t ? TONE_COLOR[t] : undefined))(worst(open.filter((p) => p.stage === i).map(s.toneFor))),
      dots: open
        .filter((p) => p.stage === i)
        .map((p) => ({ id: p.id, name: p.name, person: true, sub: s.roleOf(p.role).title, note: p.next ?? undefined, tone: TONE_COLOR[s.toneFor(p)] })),
    })),
  ]
  const inProcess = funnel.reduce((n, f) => n + f.dots.length, 0)
  const [hot, setHot] = useState<number | null>(null)
  /* The stage whose people are listed under the funnel: the one picked, else the fullest */
  const [pickedStage, setPickedStage] = useState<number | null>(null)
  const stage = pickedStage ?? funnel.reduce((best, f, i) => (f.dots.length > funnel[best].dots.length ? i : best), 0)
  const inStage = funnel[stage].dots
  const TILES = 4
  /* How a stage is doing: for people still to be routed, how they came in; for the rest, who is on track */
  const health =
    funnel[stage].to === "triage"
      ? tally(["referred", "applied", "sourced"], s.triage.map((a) => (a.origin === "referral" ? "referred" : a.origin === "job_board" ? "applied" : "sourced")))
      : tally(["on track", "overdue", "no reply"], inStage.map((d) => { const st = s.personOf(d.id).stalled; return st === "overdue" ? "overdue" : st === "no_touch" ? "no reply" : "on track" }))
  const shownTiles = inStage.length > TILES ? inStage.slice(0, TILES - 1) : inStage

  return (
    <main className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
      <div className="scroll-quiet flex-1 overflow-y-auto">
        <div className={`mx-auto max-w-[1040px] px-6 py-6 @max-2xl:px-4 ${fit ? "[--home-fixed:596px] [@media(max-height:820px)]:py-4 [@media(max-height:820px)]:[--home-fixed:540px]" : ""}`}>
          {/* The mark and a greeting, so the page opens on something */}
          <header className={`relative px-1 pt-8 pb-7 @max-2xl:pt-4 @max-2xl:pb-5 ${fit ? "[@media(max-height:820px)]:pt-3 [@media(max-height:820px)]:pb-4" : ""}`}>
            {/* Setting up, as one button in the corner: what is left, each a way straight to it. Gone once it is all done. */}
            {setup.left > 0 && !setupAway && (
              <div className="absolute top-2 right-0 @max-2xl:static @max-2xl:mb-3 @max-2xl:flex @max-2xl:justify-end">
                <Menu
                  align="right"
                  width={300}
                  items={[
                    { heading: `Setting Up, ${setup.steps.length - setup.left} Of ${setup.steps.length} Done` },
                    ...setup.steps.map((st) => ({
                      label: (
                        <span className="flex w-full items-center gap-2.5">
                          {st.done ? <Check size={14} className="shrink-0 text-s-scheduled" /> : <span className="size-3.5 shrink-0 rounded-full border-[1.5px] border-s-needs" />}
                          <span className={`min-w-0 flex-1 truncate ${st.done ? "text-mute" : "font-medium text-ink"}`}>{st.name}</span>
                        </span>
                      ),
                      onPick: st.go,
                    })),
                    ...(!s.roundsBuilt ? ["sep" as const, { label: "Ask Claude To Build The Rounds", onPick: () => s.setSheet({ kind: "rounds", ask: true }) }] : []),
                    "sep" as const,
                    { label: "Not Now", onPick: () => setSetupAway(true) },
                  ]}
                  trigger={() => (
                    <button className="flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-panel pr-2.5 pl-3 text-ink transition-colors hover:bg-hover">
                      Finish Setup
                      <span className="flex h-[18px] items-center rounded-full bg-s-needs px-1.5 text-[11px] font-medium text-white tabular-nums">
                        {setup.steps.length - setup.left}/{setup.steps.length}
                      </span>
                    </button>
                  )}
                />
              </div>
            )}
            <h1 className="flex items-center gap-3.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink @max-2xl:gap-2.5 @max-2xl:text-[26px]">
              <span className="shrink-0">
                <TacitMark size={30} />
              </span>
              {greeting}
            </h1>
            {/* Search for anything in the ATS: this opens the command menu */}
            <button onClick={() => s.setPalette(true)} className={`-mx-1 mt-6 ${fit ? "[@media(max-height:820px)]:mt-4" : ""} flex h-12 w-[calc(100%+8px)] items-center gap-3 rounded-xl border border-line-strong px-4 text-left text-mute transition-colors hover:border-mute hover:text-body`}>
              <Search size={16} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">Search people, roles, offers and settings</span>
              <Kbd>{mod("K")}</Kbd>
            </button>
          </header>
          <section className="rounded-xl border border-line-strong px-5 pt-4 pb-5 @max-2xl:px-4">
            <div className="flex items-center gap-2">
              <h2 className={`${heading} min-w-0 flex-1 tabular-nums`}>
                {all.toLocaleString("en-US")} {all === 1 ? "application" : "applications"} in {year.span}
              </h2>
              {minimizer("day")}
            </div>

            {/* The steps are there on hover or focus only: back a year or a month over the day names, forward again at the months' end */}
            <div className="group/map mt-5 flex gap-2">
              <div className="flex w-9 shrink-0 flex-col text-xs text-faint">
                <span className="mb-[3px] flex h-4 items-center gap-0.5">
                  {back < FURTHEST && (
                    <>
                      <button
                        aria-label="Back a year"
                        title="Back a year"
                        onClick={() => step(12)}
                        className={stepBtn}
                      >
                        <ChevronsLeft size={13} />
                      </button>
                      <button
                        aria-label="Back a month"
                        title="Back a month"
                        onClick={() => step(1)}
                        className={stepBtn}
                      >
                        <ChevronLeft size={13} />
                      </button>
                    </>
                  )}
                </span>
                {/* Out of the flow, so the day names never make the row taller than the squares */}
                <span className="relative flex-1" aria-hidden="true">
                  <span className="absolute inset-0 grid grid-rows-[repeat(7,minmax(0,1fr))] items-center gap-[3px] leading-none">
                    <span className="row-start-2">Mon</span>
                    <span className="row-start-4">Wed</span>
                    <span className="row-start-6">Fri</span>
                  </span>
                </span>
              </div>
              <div className="scroll-quiet min-w-0 flex-1 overflow-x-auto">
                <div className={`mx-auto transition-[max-width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${fit ? "min-w-[440px]" : "min-w-[600px]"}`} style={{ maxWidth: fit ? "calc((100vh - var(--home-fixed)) * 2.71)" : "1040px" }}>
                  <div
                    className="relative mb-[3px] grid h-4 gap-x-[3px] text-xs text-faint"
                    style={{ gridTemplateColumns: columns }}
                  >
                    {year.months.map((m) => (
                      <span
                        key={`${m.name}${m.col}`}
                        className="whitespace-nowrap"
                        style={{ gridColumn: m.col + 1 }}
                        aria-hidden="true"
                      >
                        {m.name}
                      </span>
                    ))}
                    {back > 0 && (
                      <span className="absolute top-0 right-0 flex h-4 items-center gap-0.5 bg-panel pl-1">
                        <button
                          aria-label="Forward a month"
                          title="Forward a month"
                          onClick={() => step(-1)}
                          className={stepBtn}
                        >
                          <ChevronRight size={13} />
                        </button>
                        <button
                          aria-label="Forward a year"
                          title="Forward a year"
                          onClick={() => step(-12)}
                          className={stepBtn}
                        >
                          <ChevronsRight size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                  <div
                    key={back}
                    className="grid gap-[3px]"
                    role="group"
                    aria-label={`Applications each day, ${year.span}`}
                    style={{ gridTemplateColumns: columns }}
                  >
                    {year.days.map((d) => {
                      const place = {
                        gridColumn: d.col + 1,
                        gridRow: d.row + 1,
                      }
                      return d.off ? (
                        <span
                          key={d.at}
                          title={long.format(d.at)}
                          className="aspect-square rounded-[3px] border border-line"
                          style={place}
                        />
                      ) : (
                        <button
                          key={d.at}
                          aria-pressed={d.at === day.at}
                          aria-label={`${long.format(d.at)}, ${of(d)}`}
                          title={`${long.format(d.at)}: ${of(d)}`}
                          onClick={() => setPicked(d.at)}
                          style={place}
                          className={`aspect-square rounded-[3px] transition-colors ${FILL[shade(of(d), max)]} ${d.at === day.at ? "outline outline-2 outline-offset-1 outline-ink" : "hover:outline hover:outline-1 hover:outline-mute"}`}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1 pl-11 @max-2xl:pl-0">
              {WAYS.map((w) => (
                <button
                  key={w.key}
                  aria-pressed={way === w.key}
                  onClick={() => setWay(way === w.key ? null : w.key)}
                  onMouseEnter={() => setHover(w.key)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${way === w.key ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}
                >
                  {w.label}{" "}
                  <span className="text-faint tabular-nums">
                    {total(w.key).toLocaleString("en-US")}
                  </span>
                </button>
              ))}
              <span
                className="ml-auto flex items-center gap-1 text-xs text-faint"
                aria-hidden="true"
              >
                Less
                {FILL.map((f) => (
                  <span key={f} className={`size-2.5 rounded-[3px] ${f}`} />
                ))}
                More
              </span>
            </div>

            {fold("day",
            <div
              key={day.at}
              className="anim-rise mt-5 grid grid-cols-2 gap-2 border-t border-line px-5 pt-5 @max-2xl:px-4 @2xl:grid-cols-4 @5xl:grid-cols-6"
            >
              <Lead title={long.format(day.at)} n={dayTotal} none="Nobody came in" parts={standings} />
              {unique.slice(0, 4).map(({ p, way: via }) => (
                <button
                  key={p.id}
                  onClick={() => s.openProfile(p.id)}
                  className={`tint-${s.toneFor(p)} flex min-h-[84px] min-w-0 flex-col rounded-lg border border-line-strong px-3.5 py-3 text-left transition-colors`}
                >
                  <span className="w-full truncate font-medium text-ink">
                    {p.name}
                  </span>
                  <span className="w-full truncate text-mute">
                    {s.roleOf(p.role).title}
                  </span>
                  <span className="mt-auto flex w-full min-w-0 pt-2.5" title={via}>
                    <Pill tone={s.toneFor(p)}>{p.closed ?? STAGES[p.stage]}</Pill>
                  </span>
                </button>
              ))}
            </div>)}
          </section>

          <section className="mt-3 rounded-xl border border-line-strong px-5 pt-4 pb-5 @max-2xl:px-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <h2 className={`${heading} tabular-nums`}>{inProcess} in process now</h2>
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
                    onDot={(i, id) =>
                      funnel[i].dots.find((d) => d.id === id)?.person
                        ? s.openProfile(id)
                        : s.go("triage", null)
                    }
                  />
                  <div
                    className="mt-3 grid"
                    style={{
                      gridTemplateColumns: `repeat(${funnel.length}, minmax(0, 1fr))`,
                      marginRight: FUNNEL_INSET,
                    }}
                  >
                    {funnel.map((f, i) => (
                      <button
                        key={f.name}
                        onClick={() => setPickedStage(i)}
                        aria-pressed={stage === i}
                        onMouseEnter={() => setHot(i)}
                        onMouseLeave={() => setHot(null)}
                        className="flex min-w-0 flex-col items-center gap-1 px-1.5 text-center"
                      >
                        <span className="text-[15px] leading-none font-semibold text-ink tabular-nums">
                          {f.dots.length}
                        </span>
                        <span
                          className={`max-w-full truncate leading-tight transition-colors ${hot === i || stage === i ? "text-ink" : "text-mute"}`}
                        >
                          {f.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {fold("stage",
            <div key={stage} className="anim-rise mt-5 grid grid-cols-2 gap-2 border-t border-line px-5 pt-5 @max-2xl:px-4 @2xl:grid-cols-4 @5xl:grid-cols-6">
              <Lead title={funnel[stage].name} n={inStage.length} none="Nobody here" parts={health} />
              {shownTiles.map((d) => {
                const p = d.person ? s.personOf(d.id) : null
                const a = d.person ? null : s.triage.find((x) => x.id === d.id)
                return (
                  <button
                    key={d.id}
                    onClick={() => (d.person ? s.openProfile(d.id) : s.go("triage", null))}
                    className={`tint-${p ? s.toneFor(p) : "needs"} flex min-h-[84px] min-w-0 flex-col rounded-lg border border-line-strong px-3.5 py-3 text-left transition-colors`}
                  >
                    <span className="w-full truncate font-medium text-ink">{d.name}</span>
                    <span className="w-full truncate text-mute">{s.roleOf((p ?? a)!.role).title}</span>
                    <span className="mt-auto flex w-full min-w-0 pt-2.5">
                      <Pill tone={p ? s.toneFor(p) : "needs"}>{p ? (p.next ?? "Nothing set") : "Waiting to be routed"}</Pill>
                    </span>
                  </button>
                )
              })}
              {inStage.length > TILES && (
                <button onClick={() => s.go(funnel[stage].to, null)} className="flex min-h-[84px] items-center justify-center rounded-lg border border-dashed border-line-strong text-mute transition-colors hover:text-ink">
                  +{inStage.length - shownTiles.length} more
                </button>
              )}
            </div>)}
          </section>

          {!all && (
            <Empty
              icon={<ChevronRight size={18} />}
              title="No applications yet"
            >
              Days fill in here as people apply, are referred, or are reached
              out to.
            </Empty>
          )}
        </div>
      </div>
    </main>
  )
}
