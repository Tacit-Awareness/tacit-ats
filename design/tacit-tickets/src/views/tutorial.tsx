import { useEffect, useState } from "react"
import { ChevronRight, X } from "lucide-react"
import { Btn, Dialog, IconButton } from "../kit"
import { mod } from "../ui"
import { useStore } from "../store"
import type { View } from "../types"

/*
 * The tutorial: the workflows people use most, each as a short guided walk. Picking one takes you
 * to the real screen and points at the part each step is about. Nothing in it is a mock: you can
 * do the thing as you go, or step through and come back to it.
 */

type Step = { title: string; body: string; view?: View; target?: string }
type Flow = { id: string; name: string; line: string; steps: Step[] }

export const FLOWS: Flow[] = [
  {
    id: "route",
    name: "Route A New Applicant",
    line: "Read, grade, and send someone to the right team",
    steps: [
      { view: "triage", target: "#triage-queue", title: "New people land in Triage", body: "Referred, applied and sourced applicants wait here, under whatever else needs you. Pick one to read." },
      { target: "#triage-reader", title: "Read them in the middle", body: "Their resume opens here. The Testbench tab beside it shows their take-home, if they have done one." },
      { target: '[aria-label="Confidence they\'ll pass"]', title: "Grade them", body: "Give a confidence from 1 to 5 and a comment. It stays with them, so you can look again later." },
      { target: '[aria-label="Next step"]', title: "Choose what happens", body: "Interview, Testbench or Decline. The reply is drafted for you; change the team or the person above it if it should go to someone else." },
      { title: "Send", body: `Send routes them and moves you to the next person. ${mod("↵")} does the same.` },
    ],
  },
  {
    id: "needs",
    name: "Clear What Needs You",
    line: "Offers to sign off, feedback you owe, tickets that are stuck",
    steps: [
      { view: "triage", target: "#triage-queue section", title: "Needs You is at the top", body: "Everything waiting on you is listed first: offers to sign off, interview feedback you owe, and tickets where the bot is stuck." },
      { target: "#triage-reader", title: "Deal with it here", body: "Clicking one opens it in the middle with its own buttons. Sign off, file feedback, or send the invite without leaving Triage." },
      { title: "It leaves when it is done", body: "The item drops off the list and the count on Triage goes down. Use Open In at the top right if you want the wider view." },
    ],
  },
  {
    id: "rounds",
    name: "Follow Interviews By Round",
    line: "See who is on which round, and what is stuck",
    steps: [
      { view: "tickets", target: "main svg[role=img]", title: "A block a round, a dot a person", body: "Tickets opens with your rounds. A red or amber block has someone in it who needs a look. Point at a dot to see who it is." },
      { target: "main svg[role=img]", title: "Click a block to narrow down", body: "The list under it shows only the people on that round. Click again to see everyone." },
      { target: "main section", title: "Open a ticket for the detail", body: "Each row is one step the bot is working on. Open it to see who was asked, what was drafted, and to nudge or retry." },
    ],
  },
  {
    id: "offer",
    name: "Send An Offer",
    line: "Draft the letter, get sign-off, send for signature",
    steps: [
      { view: "offers", target: "main article", title: "The letter writes itself", body: "It is your own offer form, filled in from the candidate, the role and the terms. Anything still empty shows in yellow." },
      { target: '[data-tour="offer-fields"]', title: "Fill what is missing", body: "Salary, start date, shares and the rest are on the right. Click any paragraph of the letter to rewrite it for this offer." },
      { title: "Sign off, then send", body: "The bar under the letter always shows the one next step: request sign-off, sign off, then send it through DocuSign." },
    ],
  },
  {
    id: "role",
    name: "Post A Role",
    line: "Write the listing and what you are looking for",
    steps: [
      { view: "asks", target: "main h2", title: "This is your careers page", body: "Roles are grouped by department. Hover a department and press + to add one to it." },
      { title: "Write it like a document", body: "Open a role and type straight into the Overview, or paste or import a job description. Preview As Applicant shows what candidates see." },
      { title: "Internal is for your team", body: "The Internal tab holds who is hiring, what you are looking for, and the interview plan. Set the post to Live when it is ready." },
    ],
  },
  {
    id: "find",
    name: "Find Anything, Fast",
    line: "Search and keyboard shortcuts",
    steps: [
      { view: "home", target: "main header > button", title: `Search with ${mod("K")}`, body: "It finds people, roles, offers and settings from anywhere, and runs commands like New Candidate." },
      { target: "aside nav", title: "Jump with G, then a letter", body: "G then T goes to Triage, G then W to Tickets, G then P to People. Hover a sidebar item to see its keys. C starts a new candidate." },
    ],
  },
]

/* The list of workflows, to pick one */
export function Tutorial() {
  const s = useStore()
  return (
    <Dialog title="Tutorial" onClose={() => s.setSheet(null)} width={520}>
      <p className="text-mute">Pick a workflow and you will be walked through it on the real screens.</p>
      <div className="-mx-2 mt-3 flex flex-col">
        {FLOWS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              s.setSheet(null)
              s.setTour({ id: f.id, step: 0 })
            }}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{f.name}</span>
              <span className="block truncate text-mute">{f.line}</span>
            </span>
            <span className="shrink-0 text-xs text-faint tabular-nums">{f.steps.length} steps</span>
            <ChevronRight size={14} className="shrink-0 text-faint transition-colors group-hover:text-ink" />
          </button>
        ))}
      </div>
    </Dialog>
  )
}

/* The walk itself: a ring round what the step is about, and a card with the words */
export function Tour() {
  const s = useStore()
  const tour = s.tour!
  const flow = FLOWS.find((f) => f.id === tour.id)!
  const step = flow.steps[tour.step]
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const last = tour.step === flow.steps.length - 1
  /* The card keeps out of the way: at the top when the step points at something low on the screen */
  const low = !!box && box.y + box.h / 2 > window.innerHeight * 0.6
  const go = (n: number) => s.setTour({ id: flow.id, step: n })
  const stop = () => s.setTour(null)

  /* Go where the step is, then find what it points at once the screen has settled */
  useEffect(() => {
    if (step.view && s.view !== step.view) s.go(step.view, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, tour.step])
  useEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null
      const r = el?.getBoundingClientRect()
      setBox(r && r.width > 0 ? { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 } : null)
    }
    const timers = [80, 500, 1100].map((ms) => window.setTimeout(measure, ms))
    window.addEventListener("resize", measure)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener("resize", measure)
    }
  }, [step.target, tour.id, tour.step, s.view])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        stop()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {box && <div aria-hidden="true" className="pointer-events-none fixed z-[70] rounded-xl outline outline-2 outline-ink transition-all duration-300" style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: "0 0 0 9999px var(--scrim)" }} />}
      <div role="dialog" aria-label={`Tutorial: ${flow.name}`} className={`anim-rise fixed left-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-line-strong bg-panel p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ${low ? "top-6" : "bottom-6"}`}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-faint">
            {flow.name}, {tour.step + 1} of {flow.steps.length}
          </span>
          <IconButton label="End the tutorial" onClick={stop}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">{step.title}</div>
        <p className="mt-1.5 leading-[1.55] text-body">{step.body}</p>
        <div className="mt-4 flex items-center gap-1.5">
          <span className="flex flex-1 gap-1" aria-hidden="true">
            {flow.steps.map((_, i) => (
              <span key={i} className={`h-1 w-5 rounded-full ${i <= tour.step ? "bg-ink" : "bg-raised"}`} />
            ))}
          </span>
          {tour.step > 0 && <Btn onClick={() => go(tour.step - 1)}>Back</Btn>}
          {last ? (
            <>
              <Btn onClick={() => { stop(); s.setSheet({ kind: "tutorial" }) }}>More Workflows</Btn>
              <Btn solid onClick={stop}>
                Done
              </Btn>
            </>
          ) : (
            <Btn solid onClick={() => go(tour.step + 1)}>
              Next
            </Btn>
          )}
        </div>
      </div>
    </>
  )
}
