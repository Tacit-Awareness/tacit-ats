import { useEffect, useRef } from "react"
import { ChevronRight, Search } from "lucide-react"

import { TEAMS } from "./data"
import { ME } from "./org"
import { PROFILES } from "./profiles"
import { TeamTile, teamOf } from "./kit"
import { TacitMark } from "./ui"
import { StoreProvider, useStoreState } from "./store"
import { GO_KEYS, type TeamStat, type View } from "./types"
import { Asks } from "./views/asks"
import { Candidate } from "./views/candidate"
import { Home } from "./views/home"
import { CommandMenu } from "./views/command"
import { CandidateSheet, Interviews, ScheduleSheet } from "./views/interviews"
import { Offers } from "./views/offers"
import { People } from "./views/people"
import { Insights, SettingsView } from "./views/settings"
import { RoundsBuilder } from "./views/rounds-builder"
import { Sidebar } from "./views/sidebar"
import { Tour, Tutorial } from "./views/tutorial"
import { TicketPanel, Tickets } from "./views/tickets"
import { Triage } from "./views/triage"

export default function App() {
  const s = useStoreState()
  const { view, team, tasks, people, roles, triage, tickets, personOf, roleOf, attn } = s

  /* When G was last pressed, so the next key can finish the go-to */
  const armed = useRef(0)
  /* ⌘K opens the command menu from anywhere; Escape closes the top-most thing */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); s.setPalette(!s.palette); return }
      /* G, then a letter, goes to a view; C starts a new candidate. Never while typing or with a modifier held. */
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !s.palette && !s.sheet && !s.profile) {
        const key = e.key.toUpperCase()
        if (Date.now() - armed.current < 1200) {
          armed.current = 0
          const to = (Object.keys(GO_KEYS) as View[]).find((v) => GO_KEYS[v] === key)
          if (to) {
            e.preventDefault()
            s.go(to, null)
            return
          }
        } else if (key === "G") {
          armed.current = Date.now()
          return
        } else if (key === "C") {
          e.preventDefault()
          s.setSheet({ kind: "candidate" })
          return
        }
      }
      if (e.key !== "Escape") return
      if (s.palette) s.setPalette(false)
      else if (s.sheet) s.setSheet(null)
      else if (s.profile) s.setProfile(null)
      else s.setOpenId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  /* Feedback you owe on interviews already held: part of what Triage counts */
  const owed = s.interviews.filter((i) => i.done && i.interviewers.includes(ME) && ![...(PROFILES[i.person]?.feedback ?? []), ...(s.filed[i.person] ?? [])].some((f) => f.step === i.step && f.who === ME)).length

  /* Everything below the sidebar is scoped to one team (a department), or to all of them */
  const inTeam = (roleId: string) => !team || roleOf(roleId).team === team
  const tix = tickets.filter((t) => inTeam(personOf(t.person).role))
  const ppl = people.filter((p) => inTeam(p.role))
  const tri = triage.filter((a) => inTeam(a.role))
  const scope = team ? <><TeamTile id={team} /><span className="text-mute">{teamOf(team).name}</span><ChevronRight size={12} className="text-faint" /></> : null
  const stats: Record<string, TeamStat> = {}
  for (const t of TEAMS) stats[t.id] = { attn: 0, stuck: false, triage: 0 }
  for (const t of tickets) {
    const st = stats[roleOf(personOf(t.person).role).team]
    if (attn(t)) st.attn++
    if (t.status === "failed") st.stuck = true
  }
  for (const a of triage) stats[roleOf(a.role).team].triage++

  const shown = tasks.find((t) => t.id === s.openId)
  const paneled = view === "tickets" || view === "people" || view === "asks"

  return (
    <StoreProvider value={s}>
      <div className="ui-root"><div className="tb-box">
        {/* On a phone the sidebar gives way to one bar; the command menu carries the navigation */}
        <button onClick={() => s.setPalette(true)} className="flex h-11 shrink-0 items-center gap-2.5 px-4 text-left md:hidden">
          <span className="flex size-5 shrink-0 items-center justify-center text-ink">
                <TacitMark size={18} />
              </span>
          <span className="font-medium text-ink capitalize">{team ? teamOf(team).name : view}</span>
          <Search size={15} className="ml-auto text-mute" />
        </button>
        <Sidebar view={view} team={team} go={s.go} triage={triage.length} needs={tickets.filter(attn).length + s.approvals.length + owed} stats={stats} />

        {view === "triage" && <Triage key={team ?? "all"} scope={scope} items={tri} roles={roles} roleOf={roleOf} sourceOf={s.sourceOf} onRoute={s.route} onTickets={() => s.go("tickets")} />}
        {view === "home" && <Home />}
        {view === "interviews" && <Interviews scope={scope} />}
        {view === "offers" && <Offers scope={scope} />}
        {view === "insights" && <Insights />}
        {view === "settings" && <SettingsView />}

        {paneled && <main className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
          {view === "tickets" && <Tickets scope={scope} allTeams={!team} tickets={tix} personOf={personOf} roleOf={roleOf} openId={s.openId} onOpen={s.setOpenId} />}
          {view === "people" && <People scope={scope} people={ppl} tickets={tickets} openId={s.openId} onOpen={s.setOpenId} onProfile={s.openProfile} />}
          {view === "asks" && <Asks key={`${team ?? "all"}${s.askId ?? ""}`} scope={scope} />}
        </main>}

        {shown && tix.includes(shown) && (view === "tickets" || view === "people") && (
          <TicketPanel
            key={shown.id}
            task={shown}
            asked={tasks.filter((t) => t.parent === shown.id)}
            person={personOf(shown.person)}
            role={roleOf(personOf(shown.person).role)}
            busy={s.working === shown.id}
            onClose={() => s.setOpenId(null)}
            onCommand={s.command}
            onProfile={s.openProfile}
          />
        )}

        {s.profile && people.some((p) => p.id === s.profile!.id) && <Candidate key={s.profile.id} />}
        {s.sheet?.kind === "schedule" && <ScheduleSheet />}
        {s.sheet?.kind === "candidate" && <CandidateSheet />}
        {s.sheet?.kind === "rounds" && <RoundsBuilder />}
        {s.sheet?.kind === "tutorial" && <Tutorial />}
        {s.tour && <Tour />}
        {s.palette && <CommandMenu />}
        {s.toast && <div role="status" className="anim-rise fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-3.5 py-2 text-ink shadow-[0_12px_32px_-10px_rgba(0,0,0,0.5)]">{s.toast}</div>}
      </div></div>
    </StoreProvider>
  )
}
