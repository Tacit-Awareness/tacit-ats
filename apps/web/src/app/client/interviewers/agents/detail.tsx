"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Empty, Kbd, KeyValues, Notice, Section, StatusGlyph, textLink } from "@/components/page";
import { isOpen, lanesFrom, lanesInto, TEAM_AGENT, type AgentMap, type Lane, type MapAgent, type MapTask, type WaitChannel } from "@/lib/client/agent-map";
import { cn } from "@/lib/utils";
import { BotGlyph, INK, KindIcon, StateChip, StateMark, Stamp, When, WIRE } from "./parts";
import { arrowHead, levels, spread, wireH, type Pt } from "./wires";

// What a card, a handoff or a name opens: one native <dialog> (as the
// interviewer profile is), Esc and a press on the scrim close it and focus
// goes back to what opened it. It holds a short trail, so a teammate's agent
// opened from another's can go Back.
//
// An agent: the hub (Hy's "tool access" reference): its card in the middle,
// the teammates whose agents it is talking with on the left and the
// candidates it is waiting on on the right, each joined by a connector that
// says how that handoff stands and an arrowhead for which way it goes; then
// its own tasks, newest first. A teammate opens their agent; a candidate
// opens the task.
//
// A task: who it is for and waiting on, where it asked, the candidate and the
// interview as links, then its steps as a short timeline, the newest last.

export type Open = { kind: "agent" | "task"; id: string };

const CHANNEL: Record<WaitChannel, string> = { slack: "Slack", imessage: "iMessage", email: "Email", other: "Another channel" };

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

const agentWords = (a: MapAgent | undefined) => (!a ? "An agent" : a.id === TEAM_AGENT ? a.name : `${a.name}'s agent`);

/** A link-shaped button: opens another view in this pop-up. */
function Go({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(textLink, "text-[13px]")}>
      {children}
    </button>
  );
}

type HubLink = { key: string; lane: Lane; side: "left" | "right"; outgoing: boolean; name: string; task: MapTask };
type HubWire = { key: string; d: string; head: string; color: string; dash?: string; flow: boolean; ports: Pt[] };

function Hub({ map, agent, now, onGo }: { map: AgentMap; agent: MapAgent; now: number; onGo: (o: Open) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<{ width: number; height: number; wires: HubWire[] } | null>(null);

  const links: HubLink[] = [
    ...lanesFrom(map, agent.id).map((lane) => ({
      key: lane.id,
      lane,
      side: lane.to.kind === "member" ? ("left" as const) : ("right" as const),
      outgoing: true,
      name: lane.to.name,
      task: map.tasks[lane.tasks[0]],
    })),
    ...lanesInto(map, agent.id).map((lane) => ({
      key: lane.id,
      lane,
      side: "left" as const,
      outgoing: false,
      name: map.agents[lane.from]?.name ?? "A teammate",
      task: map.tasks[lane.tasks[0]],
    })),
  ];
  const left = links.filter((l) => l.side === "left");
  const right = links.filter((l) => l.side === "right");
  const current = agent.current ? map.tasks[agent.current] : null;

  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const rel = (n: Element) => {
      const r = n.getBoundingClientRect();
      return { left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top };
    };
    const center = el.querySelector("[data-hub-center]");
    if (!center) return;
    const c = rel(center);
    const nodes = new Map<string, ReturnType<typeof rel>>();
    el.querySelectorAll<HTMLElement>("[data-hub-node]").forEach((n) => nodes.set(n.dataset.hubNode!, rel(n)));
    const wires: HubWire[] = [];
    for (const side of ["left", "right"] as const) {
      const mine = links.filter((l) => l.side === side && nodes.has(l.key));
      const ys = spread(mine.length, c.top, c.bottom);
      const edge = side === "left" ? c.left : c.right;
      const nodeEdge = (n: ReturnType<typeof rel>) => (side === "left" ? n.right : n.left);
      const far = mine.length ? (side === "left" ? Math.max(...mine.map((l) => nodeEdge(nodes.get(l.key)!))) : Math.min(...mine.map((l) => nodeEdge(nodes.get(l.key)!)))) : edge;
      const runs = levels(mine.length, Math.min(far, edge), Math.max(far, edge));
      // The run nearest the center serves the node nearest the top, so no two runs cross.
      if (side === "left") runs.reverse();
      mine.forEach((l, i) => {
        const n = nodes.get(l.key)!;
        const hub = { x: edge, y: ys[i] };
        const node = { x: nodeEdge(n), y: (n.top + n.bottom) / 2 };
        const look = WIRE[l.lane.state];
        // Drawn the way the handoff goes: out to the teammate or candidate, or in from the agent that asks.
        const [a, b] = l.outgoing ? [hub, node] : [node, hub];
        const dx = b.x > a.x ? 1 : -1;
        wires.push({ key: l.key, d: wireH(a, b, runs[i]), head: arrowHead(b, dx, 0), ...look, ports: [a, b] });
      });
    }
    setDrawn({ width: box.width, height: box.height, wires });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, agent.id]);

  useLayoutEffect(() => {
    measure();
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const node = (l: HubLink) => (
    <button
      key={l.key}
      type="button"
      data-hub-node={l.key}
      onClick={() => (l.lane.to.kind === "member" || !l.outgoing ? onGo({ kind: "agent", id: l.outgoing ? l.lane.to.id : l.lane.from }) : onGo({ kind: "task", id: l.task.id }))}
      // A finished handoff sits flat and dashed on the ground, as the reference's unused tools: there, but quiet.
      className={cn(
        "agents-item grid min-w-0 gap-1.5 rounded-[12px] px-3 py-2.5 text-left",
        l.lane.state === "done" ? "agents-faded" : "bg-card shadow-[var(--shadow-sm)]",
      )}
    >
      <span className="truncate font-sans text-[14px] leading-[20px] font-semibold tracking-[-0.01em]">{l.name}</span>
      <span className="text-[12px] leading-[18px] text-muted-foreground">{l.task.thing}</span>
      <span className="flex items-center gap-1.5 text-[12px] leading-[18px]">
        <StateMark state={l.task.state} className="size-3" />
        <span style={{ color: INK[l.task.state] }}>{l.task.state === "waiting" ? "Waiting" : l.task.state === "needs_you" ? "Needs you" : l.task.state === "working" ? "Working" : l.task.state === "failed" ? "Failed" : "Done"}</span>
        <span className="ml-auto text-faint tabular-nums">
          <Stamp iso={l.task.updatedAt} now={now} />
        </span>
      </span>
    </button>
  );

  return (
    <div
      ref={root}
      className="agents-ground relative grid items-center justify-center gap-x-[72px] px-5 py-6"
      // A column for each side that has someone on it, so the agent sits in the middle of what it talks to.
      style={{ gridTemplateColumns: [left.length ? "minmax(0,220px)" : null, "minmax(0,236px)", right.length ? "minmax(0,220px)" : null].filter(Boolean).join(" ") }}
    >
      {left.length ? <div className="grid content-center gap-3">{left.map(node)}</div> : null}
      {/* The agent as its board card draws it: the name, then what it is doing (its state is the chip in the title). */}
      <div data-hub-center className="grid min-w-0 gap-2 rounded-[14px] bg-card p-3.5 shadow-[var(--shadow)]">
        <span className="flex min-w-0 items-center gap-2">
          <BotGlyph />
          <span className="truncate font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">{agent.name}</span>
        </span>
        <span className={cn("text-[13px] leading-[19px]", !current && "text-faint")}>{current ? current.doing : "Ready for a task"}</span>
      </div>
      {right.length ? <div className="grid content-center gap-3">{right.map(node)}</div> : null}
      {drawn ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={drawn.width} height={drawn.height}>
          {drawn.wires.map((w) => (
            <g key={w.key}>
              <path d={w.d} fill="none" stroke={w.color} strokeWidth={1.5} strokeDasharray={w.dash} strokeLinecap="round" />
              {w.flow ? <path d={w.d} fill="none" stroke={w.color} strokeWidth={1.5} strokeLinecap="round" className="agents-flow" /> : null}
              <circle cx={w.ports[0].x} cy={w.ports[0].y} r={3.5} fill="var(--paper)" stroke={w.color} strokeWidth={1.5} />
              <path d={w.head} fill="none" stroke={w.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function TaskRows({ map, ids, now, onGo }: { map: AgentMap; ids: string[]; now: number; onGo: (o: Open) => void }) {
  return (
    <div className="-mx-2 grid">
      {ids.map((id) => {
        const t = map.tasks[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onGo({ kind: "task", id })}
            className="flex min-h-11 min-w-0 items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[color:var(--surface)]"
          >
            <StateMark state={t.state} />
            <span className="min-w-0 flex-1 text-[13px] leading-[19px]">{isOpen(t.state) ? t.doing : t.thing}</span>
            <span className="shrink-0 text-[12px] text-faint tabular-nums">
              <Stamp iso={t.updatedAt} now={now} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AgentBody({ map, agent, now, onGo }: { map: AgentMap; agent: MapAgent; now: number; onGo: (o: Open) => void }) {
  return (
    <div className="grid gap-4 px-6 pt-1 pb-6">
      <Hub map={map} agent={agent} now={now} onGo={onGo} />
      <Section title="Tasks">{agent.tasks.length ? <TaskRows map={map} ids={agent.tasks} now={now} onGo={onGo} /> : <Empty>Nothing in the last week.</Empty>}</Section>
    </div>
  );
}

/** The steps, the newest last; while the task is open, one more line for where it stands now. */
function Steps({ task, waitingOn, now }: { task: MapTask; waitingOn: string | null; now: number }) {
  const open = isOpen(task.state);
  const lines = task.steps.map((s, i) => ({ key: `s${i}`, label: s.label, at: s.at, last: i === task.steps.length - 1 }));
  return (
    <ol className="m-0 grid list-none p-0">
      {lines.map((s) => (
        <li key={s.key} className="agents-step grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-3 pb-3 last:pb-0">
          {s.last && !open ? <StateMark state={task.state} className="mt-[3px]" /> : <StatusGlyph kind="done" color="var(--ink-4)" className="mt-[3px]" />}
          <span className="text-[13px] leading-[20px]">{s.label}</span>
          <span className="text-[12px] leading-[20px] text-faint tabular-nums">{s.at ? <When iso={s.at} now={now} /> : null}</span>
        </li>
      ))}
      {open ? (
        <li className="agents-step grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-3">
          <StateMark state={task.state} className="mt-[3px]" />
          <span className="text-[13px] leading-[20px] font-medium" style={{ color: INK[task.state] }}>
            {task.state === "working" ? "Working" : task.state === "needs_you" ? "Needs you" : waitingOn ? `Waiting on ${waitingOn}` : "Waiting"}
          </span>
          <span />
        </li>
      ) : null}
    </ol>
  );
}

function TaskBody({ map, task, now, onGo }: { map: AgentMap; task: MapTask; now: number; onGo: (o: Open) => void }) {
  const agent = map.agents[task.agentId];
  const open = isOpen(task.state);
  const party = task.with;
  const items: [React.ReactNode, React.ReactNode][] = [["Agent", <Go key="a" onClick={() => onGo({ kind: "agent", id: task.agentId })}>{agentWords(agent)}</Go>]];
  if (party || task.withSelf) {
    const who =
      party?.kind === "member" ? (
        map.agents[party.id] ? (
          <Go onClick={() => onGo({ kind: "agent", id: party.id })}>{party.name}</Go>
        ) : (
          party.name
        )
      ) : party?.kind === "candidate" ? (
        <Link href={`/client/candidates/${party.id}`} className={cn(textLink, "text-[13px]")}>
          {party.name}
        </Link>
      ) : (
        (agent?.name ?? "Their teammate")
      );
    items.push([open ? "Waiting on" : "Was with", who]);
    if (task.channel) items.push(["Asked in", CHANNEL[task.channel]]);
  }
  if (task.candidate && !(party?.kind === "candidate" && party.id === task.candidate.id)) {
    items.push([
      "Candidate",
      <Link key="c" href={`/client/candidates/${task.candidate.id}`} className={cn(textLink, "text-[13px]")}>
        {task.candidate.name}
      </Link>,
    ]);
  }
  if (task.interview) {
    items.push([
      "Interview",
      <Link key="i" href={`/client/interviews?i=${encodeURIComponent(task.interview.id)}`} className={cn(textLink, "text-[13px]")}>
        {task.interview.step ?? "The interview"}
      </Link>,
    ]);
  }
  items.push(["Started", <When key="s" iso={task.createdAt} now={now} />]);
  if (task.updatedAt !== task.createdAt) items.push(["Last update", <When key="u" iso={task.updatedAt} now={now} />]);

  const waitingOn = party ? party.short : task.withSelf ? (agent?.short ?? null) : null;
  return (
    <div className="grid gap-4 px-6 pt-1 pb-6">
      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      <Section>
        <KeyValues items={items} className="grid-cols-[110px_minmax(0,1fr)] tabular-nums" />
      </Section>
      <Section title="Steps">{task.steps.length || open ? <Steps task={task} waitingOn={waitingOn} now={now} /> : <Empty>No steps reported.</Empty>}</Section>
    </div>
  );
}

export function AgentDialog({ map, now, stack, onGo, onBack, onClose }: { map: AgentMap; now: number; stack: Open[]; onGo: (o: Open) => void; onBack: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const top = stack.at(-1) ?? null;
  // A view whose agent or task the last re-read no longer holds closes rather than show nothing.
  const agent = top?.kind === "agent" ? map.agents[top.id] : undefined;
  const task = top?.kind === "task" ? map.tasks[top.id] : undefined;
  const showing = !!(agent || task);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (showing && !d.open) d.showModal();
    if (!showing && d.open) d.close();
  }, [showing]);

  // Each new view starts at its top with its title read out.
  useEffect(() => {
    if (!showing) return;
    dialog.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [top?.kind, top?.id, showing]);

  const previous = stack.length > 1 ? stack[stack.length - 2] : null;
  const backLabel = previous ? (previous.kind === "agent" ? `Back to ${agentWords(map.agents[previous.id])}` : "Back to the task") : "";
  const title = agent ? agent.name : task ? (isOpen(task.state) ? task.doing : task.thing) : "";
  const chip = agent ? (
    <StateChip state={agent.state} waitingOn={agent.current ? (map.tasks[agent.current].with?.short ?? (map.tasks[agent.current].withSelf ? agent.short : null)) : null} />
  ) : task ? (
    <StateChip state={task.state} waitingOn={task.with?.short ?? null} />
  ) : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
      className="agents-dialog m-auto max-h-[calc(100vh-48px)] w-[min(820px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)]"
    >
      {showing ? (
        <>
          <header className="flex items-start gap-2 px-6 pt-5 pb-4">
            {previous ? (
              <button type="button" onClick={onBack} aria-label={backLabel} title={backLabel} className="ov-icon-btn -ml-2">
                <BackIcon />
              </button>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 pt-1">
              {task ? <KindIcon kind={task.kind} className="size-4" /> : null}
              <h2 ref={heading} id={titleId} tabIndex={-1} className="m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.015em] outline-none [overflow-wrap:anywhere]">
                {title}
              </h2>
              {chip}
            </div>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" title="Close (esc)" className="ov-icon-btn -mr-2">
              <Kbd>esc</Kbd>
              <CloseIcon />
            </button>
          </header>
          {agent ? <AgentBody map={map} agent={agent} now={now} onGo={onGo} /> : task ? <TaskBody map={map} task={task} now={now} onGo={onGo} /> : null}
        </>
      ) : null}
    </dialog>
  );
}
