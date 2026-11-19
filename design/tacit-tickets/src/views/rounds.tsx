import { useState } from "react"
import { statusOf, type Person } from "../data"
import { TONE_COLOR, heading, isOpen, toneOf, worst, ToneLegend } from "../kit"
import { useStore } from "../store"
import { FUNNEL_INSET, Funnel } from "./funnel"

/*
 * The interview rounds as blocks: a dot a person, on the round they are at now. A person's round
 * is the step of their open ticket, else their next interview, else the one after their last.
 * Picking a block narrows the page under it to that round.
 */
export function useRounds() {
  const s = useStore()
  const roundOf = (p: Person) => {
    const ticket = s.tickets.find((t) => t.person === p.id && t.step && isOpen(statusOf(t)))
    if (ticket?.step) return ticket.step
    const mine = s.interviews.filter((i) => i.person === p.id)
    const plan = s.roleOf(p.role).plan
    return mine.find((i) => !i.done)?.step ?? plan[Math.min(mine.filter((i) => i.done).length, plan.length - 1)]
  }
  const active = s.people.filter((p) => !p.closed && (p.stage === 2 || p.stage === 3) && (!s.team || s.roleOf(p.role).team === s.team)).map((p) => ({ p, at: roundOf(p) }))
  return { active, rounds: s.rounds }
}

export function RoundBlocks({ picked, onPick }: { picked: string | null; onPick: (round: string | null) => void }) {
  const s = useStore()
  const { active, rounds } = useRounds()
  const [hot, setHot] = useState<number | null>(null)
  const blocks = rounds.map((name) => {
    const here = active.filter((x) => x.at === name)
    const tone = worst(here.map((x) => toneOf(x.p)))
    return { name, tone: tone && TONE_COLOR[tone], dots: here.map((x) => ({ id: x.p.id, name: x.p.name, sub: s.roleOf(x.p.role).title, note: x.p.next ?? undefined, tone: TONE_COLOR[toneOf(x.p)] })) }
  })
  const pick = (name: string) => onPick(picked === name ? null : name)
  if (!blocks.length) return null
  return (
    <div className="px-5 pt-5 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className={`${heading} tabular-nums`}>{active.length} interviewing now</h2>
          <ToneLegend className="ml-auto" />
        <button onClick={() => s.setSheet({ kind: "rounds" })} className="ml-1 rounded text-mute underline decoration-faint underline-offset-2 hover:text-ink">
          Edit Rounds
        </button>
        {picked && (
          <button onClick={() => onPick(null)} className="ml-1 rounded text-mute underline decoration-faint underline-offset-2 hover:text-ink">
            Show All Rounds
          </button>
        )}
      </div>
      <div className="scroll-quiet mt-3 overflow-x-auto">
        <div className="mx-auto max-w-[920px] min-w-[520px]">
          <Funnel stages={blocks} picked={picked ? rounds.indexOf(picked) : null} hot={hot} setHot={setHot} onStage={(i) => pick(rounds[i])} onDot={(_, id) => s.openProfile(id)} />
          <div className="mt-3.5 grid" style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, marginRight: FUNNEL_INSET }}>
            {blocks.map((b, i) => (
              <button key={b.name} onClick={() => pick(b.name)} aria-pressed={picked === b.name} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} className="flex min-w-0 flex-col items-center gap-1 px-1.5 text-center">
                <span className="text-[15px] leading-none font-semibold text-ink tabular-nums">{b.dots.length}</span>
                <span className={`max-w-full truncate leading-tight transition-colors ${hot === i || picked === b.name ? "text-ink" : "text-mute"}`}>{b.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
