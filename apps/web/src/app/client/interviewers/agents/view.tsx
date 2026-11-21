"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Empty, Section, textLink } from "@/components/page";
import { TEAM_AGENT, type AgentMap, type Band, type MapAgent, type MapTask } from "@/lib/client/agent-map";
import { cn } from "@/lib/utils";
import { AgentDialog, type Open } from "./detail";
import { whenWord } from "../../candidates/local-day";
import { Arrow, BotGlyph, INK, KindIcon, StateChip, StateMark, Stamp, StepDashes, WIRE, laneTitle, useZone } from "./parts";
import { levels, wireV, type Pt } from "./wires";
import "./agents.css";

// The board (Hy's "team of agents" reference): each teammate whose agent is
// at work, or whom another agent is waiting on, as a card across the top;
// under them, a lane for each pair of agents that are handing something over
// ("Priya → Daniel"), its items stacked, the newest first and the fourth
// fading out. Elbow connectors with round ports drop from a card into its
// lanes: the accent, moving gently, while the handoff is live; red when it
// needs a person, red and dashed when it failed, dotted grey once it is done.
// Where each lane sits and how each connector runs is planned in
// lib/client/agent-map.ts (arrangeBand), so no two cross and none passes over
// a card; this file only measures the columns and draws the plan. A teammate
// whose agent is idle, here only because another agent waits on them, is a
// one-line card. More teammates than fit run on in bands of four; everyone
// else who interviews is one quiet row of names. A card, an item or a name
// opens its detail (detail.tsx). The page re-reads itself every half minute
// while it is on screen and nothing is open.

const SHOWN = 3;
const REFRESH_MS = 30_000;

type Wire = { key: string; d: string; color: string; dash?: string; flow: boolean; ports: Pt[] };

function BandView({ band, map, now, onOpen }: { band: Band; map: AgentMap; now: number; onOpen: (o: Open) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const cardRow = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<{ width: number; height: number; wires: Wire[] } | null>(null);

  const measure = useCallback(() => {
    const el = root.current;
    const row = cardRow.current;
    if (!el || !row) return;
    const box = el.getBoundingClientRect();
    const grid = row.getBoundingClientRect();
    // Cards and lanes share one column grid, so a column's place is the grid's.
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const colWidth = (grid.width - gap * (band.width - 1)) / band.width;
    const colLeft = (c: number) => grid.left - box.left + c * (colWidth + gap);
    const bottoms = new Map<string, number>();
    el.querySelectorAll<HTMLElement>("[data-agent]").forEach((n) => bottoms.set(n.dataset.agent!, n.getBoundingClientRect().bottom - box.top));
    const laneEl = el.querySelector("[data-lane]");
    const top = Math.max(0, ...bottoms.values());
    const laneTop = laneEl ? laneEl.getBoundingClientRect().top - box.top : top + 40;
    const runs = levels(band.levels, top, laneTop);
    const wires: Wire[] = band.wires.map((w) => {
      const look = WIRE[map.lanes[w.lane].state];
      const card = { x: colLeft(w.card) + colWidth * w.cardAt, y: bottoms.get(band.agents[w.card]) ?? top };
      const port = { x: colLeft(w.column) + colWidth * w.laneAt, y: laneTop };
      const bus = runs[w.level] ?? (top + laneTop) / 2;
      // Drawn the way the handoff goes, so the live one moves from the asking agent toward the asked.
      const d = w.end === "from" ? wireV(card, port, bus) : wireV(port, card, bus);
      return { key: w.key, d, ...look, ports: [card, port] };
    });
    setDrawn({ width: box.width, height: box.height, wires });
  }, [band, map]);

  useLayoutEffect(() => {
    measure();
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    void document.fonts?.ready.then(() => measure());
    return () => ro.disconnect();
  }, [measure]);

  const columns = { gridTemplateColumns: `repeat(${band.width}, minmax(0, 1fr))` };

  return (
    // The gap under the cards holds the connectors' runs: room for each level they use.
    <div ref={root} className="relative grid" style={{ rowGap: 28 + 10 * band.levels }}>
      <div ref={cardRow} className="grid gap-4" style={columns}>
        {band.agents.map((id, i) => {
          const a = map.agents[id];
          return a ? <AgentCard key={id} agent={a} task={a.current ? map.tasks[a.current] : null} column={i} onOpen={onOpen} /> : null;
        })}
      </div>
      {band.lanes.length ? (
        <div className="grid items-start gap-4" style={columns}>
          {band.lanes.map((id) => (
            <LaneView key={id} id={id} map={map} now={now} column={band.columns[id] ?? 0} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
      {drawn ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={drawn.width} height={drawn.height}>
          {drawn.wires.map((w) => (
            <g key={w.key}>
              <path d={w.d} fill="none" stroke={w.color} strokeWidth={1.5} strokeDasharray={w.dash} strokeLinecap="round" />
              {w.flow ? <path d={w.d} fill="none" stroke={w.color} strokeWidth={1.5} strokeLinecap="round" className="agents-flow" /> : null}
              {w.ports.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="var(--paper)" stroke={w.color} strokeWidth={1.5} />
              ))}
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

/** The chip's "Waiting on Daniel": whoever its current task waits on, its own teammate included. */
export const waitingOnOf = (agent: MapAgent, task: MapTask | null) => (task?.with ? task.with.short : task?.withSelf ? agent.short : null);

function AgentCard({ agent, task, column, onOpen }: { agent: MapAgent; task: MapTask | null; column: number; onOpen: (o: Open) => void }) {
  const last = task?.steps.at(-1) ?? null;
  const zone = useZone();
  const whose = agent.id === TEAM_AGENT ? agent.name : `${agent.name}'s agent`;
  // The latest step is detail: it rides in the hover, with when, and opens in full in the pop-up.
  const hover = last ? `${whose}\nLast step: ${last.label}${last.at && zone ? `, ${whenWord(last.at, Date.now(), zone)}` : ""}` : whose;
  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <BotGlyph />
      <span className="truncate font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">{agent.name}</span>
    </span>
  );
  const common = {
    type: "button" as const,
    "data-agent": agent.id,
    onClick: () => onOpen({ kind: "agent", id: agent.id }),
    "aria-haspopup": "dialog" as const,
    title: hover,
    style: { gridColumnStart: column + 1 },
  };
  // Idle, and here only because another agent waits on them: one line, so the busy cards lead.
  if (!task)
    return (
      <button {...common} className="agents-card flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 self-start rounded-[14px] bg-card px-3.5 py-3 text-left shadow-[var(--shadow)]">
        {name}
        <StateChip state={agent.state} />
      </button>
    );
  return (
    <button {...common} className="agents-card grid min-w-0 grid-rows-[auto_1fr_auto] gap-2 rounded-[14px] bg-card p-3.5 text-left shadow-[var(--shadow)]">
      {name}
      <span className="text-[13px] leading-[19px] text-foreground">{task.doing}</span>
      {/* The chip at the foot, so a row of cards lines its states up however long the words above. */}
      <StateChip state={agent.state} waitingOn={waitingOnOf(agent, task)} className="mt-1 max-w-full justify-self-start" />
    </button>
  );
}

const ITEM_WORDS: Record<MapTask["state"], string> = { working: "Working", waiting: "Waiting", needs_you: "Needs you", failed: "Failed", done: "Done" };

function LaneView({ id, map, now, column, onOpen }: { id: string; map: AgentMap; now: number; column: number; onOpen: (o: Open) => void }) {
  const lane = map.lanes[id];
  const title = laneTitle(map, lane);
  const tasks = lane.tasks.map((t) => map.tasks[t]);
  // A fourth or more: the third fades out, and "1 more" opens the agent's own pop-up, which lists them all.
  const fades = tasks.length > SHOWN;
  return (
    <div data-lane={id} style={{ gridColumnStart: column + 1 }} className="grid min-w-0 gap-2 rounded-[12px] bg-[color:var(--soft)] p-2 shadow-[inset_0_0_0_1px_var(--line)]">
      {/* Names alone, on one line ("Priya → Daniel"): the page already says these are agents. A long name wraps after the arrow rather than being cut. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 px-1.5 pt-0.5 text-[12px] leading-[18px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {title.from}
          <Arrow className="text-faint" />
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{title.to}</span>
      </div>
      {tasks.slice(0, SHOWN).map((t, i) => (
        <button
          key={t.id}
          type="button"
          aria-haspopup="dialog"
          onClick={() => onOpen({ kind: "task", id: t.id })}
          className={cn("agents-item grid gap-2 rounded-[10px] bg-card p-2.5 text-left shadow-[var(--shadow-sm)]", fades && i === SHOWN - 1 && "agents-fade")}
        >
          <span className="flex min-w-0 items-start gap-2">
            <KindIcon kind={t.kind} className="mt-0.5" />
            <span className="min-w-0 text-[13px] leading-[19px] font-medium text-foreground">{t.thing}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[12px] leading-[18px]">
            <StateMark state={t.state} className="size-3" />
            <span style={{ color: INK[t.state] }}>{ITEM_WORDS[t.state]}</span>
            <span className="ml-auto text-faint tabular-nums">
              <Stamp iso={t.updatedAt} now={now} />
            </span>
          </span>
          <StepDashes steps={t.steps} state={t.state} />
        </button>
      ))}
      {fades ? (
        <button type="button" aria-haspopup="dialog" onClick={() => onOpen({ kind: "agent", id: lane.from })} className="h-7 justify-self-start rounded-[7px] px-2 text-[12px] text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground">
          {`${tasks.length - SHOWN} more`}
        </button>
      ) : null}
    </div>
  );
}

function IdleRow({ map, onOpen }: { map: AgentMap; onOpen: (o: Open) => void }) {
  return (
    <section aria-label="Idle agents" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 rounded-[14px] bg-card px-2.5 py-2 shadow-[var(--shadow)]">
      <span className="flex h-[30px] items-center gap-2 pr-2 pl-1.5 text-[13px] font-medium">
        <StateMark state="idle" />
        Idle
      </span>
      {map.idle.map((id) => (
        <button
          key={id}
          type="button"
          aria-haspopup="dialog"
          onClick={() => onOpen({ kind: "agent", id })}
          className="h-[30px] rounded-[7px] px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          {map.agents[id]?.name ?? "A teammate"}
        </button>
      ))}
    </section>
  );
}

/** Re-reads the page every half minute while it is on screen and nothing is open over it. */
function useRefresh(paused: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [paused, router]);
}

export function AgentsBoard({ map, now, setUpHref }: { map: AgentMap; now: number; setUpHref: string | null }) {
  const [stack, setStack] = useState<Open[]>([]);
  const open = useCallback((o: Open) => setStack([o]), []);
  useRefresh(stack.length > 0);

  const quiet = map.bot !== "connected" && map.bot !== "unknown";
  return (
    <>
      {map.bands.length ? (
        <div className="agents-ground grid gap-8 p-4">
          {map.bands.map((band) => (
            <BandView key={band.agents.join(":")} band={band} map={map} now={now} onOpen={open} />
          ))}
        </div>
      ) : (
        <Section>
          <Empty>
            {quiet ? "Your team's bot is not connected yet." : "No agent is working on anything right now."}
            {quiet && setUpHref ? (
              <>
                {" "}
                <Link href={setUpHref} className={textLink}>
                  Connect it in Settings
                </Link>
              </>
            ) : null}
          </Empty>
        </Section>
      )}
      {map.idle.length ? <IdleRow map={map} onOpen={open} /> : null}
      <AgentDialog
        map={map}
        now={now}
        stack={stack}
        onGo={(o) => setStack((s) => [...s, o])}
        onBack={() => setStack((s) => s.slice(0, -1))}
        onClose={() => setStack([])}
      />
    </>
  );
}
