import { STAFF } from "../data"
import { WINS } from "../org"
import { Person as Member } from "../ui"

/*
 * How to win someone at Offer: what they said in their interviews, in their words, and what that
 * means for the offer. The quotes come from the interview notes (get_interview_notes).
 */
export function WinOver({ id }: { id: string }) {
  const w = WINS[id]
  if (!w) return null
  const label = "mb-2 text-xs text-faint"
  return (
    <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div>
        <div className={label}>What They Said</div>
        <ul className="flex flex-col gap-3">
          {w.said.map((q) => (
            <li key={q.quote} className="border-l-2 border-line-strong pl-3">
              <p className="leading-[1.5] text-ink">{q.quote}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                <Member id={q.who} size={14} /> {q.step}, with {STAFF[q.who].first}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className={label}>To Win Them</div>
        <ul className="flex flex-col gap-2">
          {w.win.map((x) => (
            <li key={x} className="flex gap-2.5 leading-[1.5] text-body">
              <span className="mt-[8px] size-[5px] shrink-0 bg-faint" aria-hidden="true" />
              {x}
            </li>
          ))}
        </ul>
        {w.risk && (
          <>
            <div className={`${label} mt-5`}>Watch For</div>
            <p className="leading-[1.5] text-body">{w.risk}</p>
          </>
        )}
      </div>
    </div>
  )
}
