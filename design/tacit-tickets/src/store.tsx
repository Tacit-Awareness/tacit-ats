import { createContext, useContext, useEffect, useState } from "react"
import { flushSync } from "react-dom"

import {
  APPLICANTS, ORIGIN_LABEL, PEOPLE, REJECTION_REASONS, ROLES, STAFF, STAGES, TASKS, statusOf,
  type Applicant, type Command, type Person, type Role, type Task,
} from "./data"
import { isOpen, teamOf, toneOf, type Tone } from "./kit"
import {
  ACTIVITY, APPROVAL_FLOWS, EMAILS, FIELDS, FIELD_VALUES, INTEGRATIONS, INTERVIEWS, INVITES, ME, OFFERS, OFFICES, POOLS, PROSPECTS, CHECKINS, DEFAULT_PROCESS, newRound, TAGS, TEMPLATES,
  type Access, type RoundDef, type Activity, type Email, type Interview, type Offer,
} from "./org"
import { PROFILES, type Feedback } from "./profiles"
import type { Routing, Theme, View, Passed } from "./types"

export type Sheet =
  | { kind: "candidate" }
  | { kind: "schedule"; person?: string; interview?: string }
  | { kind: "rounds"; ask?: boolean }
  | { kind: "tutorial" }
  | null
export type CandidateTab = "Resume" | "Testbench" | "Interviews" | "Activity" | "Emails"

/* All of the app's state and the writes on it. One hook builds it; a context hands it to every view. */
export function useStoreState() {
  const [view, setView] = useState<View>("home")
  const [team, setTeam] = useState<string | null>(null)
  const [tasks, setTasks] = useState(TASKS)
  const [people, setPeople] = useState(PEOPLE)
  const [roles, setRoles] = useState(ROLES)
  const [triage, setTriage] = useState(APPLICANTS)
  const [passed, setPassed] = useState<Passed[]>([])
  const [offerId, setOfferId] = useState<string | null>(null)
  /* The guided walk in progress: which workflow, and which step */
  const [tour, setTour] = useState<{ id: string; step: number } | null>(null)
  /* The interview process: the company's rounds, and a branch for any team that differs. Built in the rounds builder. */
  const [process, setProcess] = useState<Record<string, RoundDef[]>>({ company: DEFAULT_PROCESS })
  /* The company's rounds by name, as the blocks on Tickets show them */
  const rounds = process.company.map((r) => r.name)
  const setRounds = (names: string[]) => setProcess((p) => ({ ...p, company: names.map((n) => p.company.find((r) => r.name === n) ?? newRound(n)) }))
  /* Whether the rounds have been looked at in the builder: the last step of setting up */
  const [roundsBuilt, setRoundsBuilt] = useState(false)
  /* The role to open when Listings & Asks is reached from search */
  const [askId, setAskId] = useState<string | null>(null)
  /* On a wide screen the first ticket is open beside the list; on a narrow one the panel would cover it */
  const [openId, setOpenId] = useState<string | null>(() => (window.innerWidth >= 1024 ? "t1" : null))
  const [working, setWorking] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ id: string; tab: CandidateTab } | null>(null)
  const [palette, setPalette] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [settings, setSettings] = useState("General")
  const [, setTick] = useState(0)

  const [interviews, setInterviews] = useState(INTERVIEWS)
  const [filed, setFiled] = useState<Record<string, Feedback[]>>({})
  const [offers, setOffers] = useState(OFFERS)
  const [emails, setEmails] = useState(EMAILS)
  const [activity, setActivity] = useState(ACTIVITY)
  const [personTags, setPersonTags] = useState<Record<string, string[]>>(() => Object.fromEntries(Object.entries(PROFILES).map(([id, p]) => [id, p.tags])))
  const [tags, setTags] = useState(TAGS)
  const [pools, setPools] = useState(POOLS)
  const [prospects, setProspects] = useState(PROSPECTS)
  const [checkins, setCheckins] = useState(CHECKINS)
  const [invites, setInvites] = useState(INVITES)
  const [templates, setTemplates] = useState(TEMPLATES)
  const [fields, setFields] = useState(FIELDS)
  const [fieldValues, setFieldValues] = useState(FIELD_VALUES)
  const [offices, setOffices] = useState(OFFICES)
  const [reasons, setReasons] = useState(REJECTION_REASONS)
  const [flows, setFlows] = useState(APPROVAL_FLOWS)
  const [integrations, setIntegrations] = useState(INTEGRATIONS)
  const [connector, setConnector] = useState<Record<Access, boolean>>({ admin: true, hiring: true, interviewer: false })

  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("tacit-theme") as Theme | null) ?? "system" } catch { return "system" }
  })
  /* Light, dark, or whatever the system is on; remembered in this browser */
  useEffect(() => {
    try { localStorage.setItem("tacit-theme", theme) } catch { /* private window: the choice lasts the session */ }
    const system = window.matchMedia("(prefers-color-scheme: light)")
    const apply = () => {
      const t = theme === "system" ? (system.matches ? "light" : "dark") : theme
      const root = document.documentElement
      if (root.dataset.theme === t) return
      // Flip every colour in one frame: no row fades from the old theme's colour
      root.classList.add("theme-switching")
      root.dataset.theme = t
      root.classList.toggle("dark", t === "dark")
      void root.offsetHeight
      window.setTimeout(() => root.classList.remove("theme-switching"), 60)
    }
    apply()
    system.addEventListener("change", apply)
    return () => system.removeEventListener("change", apply)
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const personOf = (id: string) => people.find((p) => p.id === id)!
  const roleOf = (id: string) => roles.find((r) => r.id === id)!
  const tickets = tasks.filter((t) => !t.parent)
  /*
   * The one colour for a person, wherever they are drawn: red if a ticket of theirs has failed or
   * they are overdue, amber if a ticket of theirs is waiting on you, else where they stand.
   */
  const toneFor = (p: Person): Tone => {
    const mine = tickets.filter((t) => t.person === p.id).map(statusOf).filter(isOpen)
    const own = toneOf(p)
    return own === "failed" || mine.includes("failed") ? "failed" : mine.includes("needs") ? "needs" : own
  }
  const attn = (t: Task) => statusOf(t) === "needs" || t.status === "failed"
  const sourceOf = (a: Applicant) => (a.by ? `${ORIGIN_LABEL[a.origin]} by ${STAFF[a.by].first}` : "Job board")
  /* Moving to another view puts away the open ticket: a panel never follows you somewhere it was not opened */
  /* Moving to another view crossfades, where the browser can and motion is welcome */
  const go = (v: View, t: string | null = team, ticket: string | null = null) => {
    const apply = () => {
      if (v !== view || ticket) setOpenId(ticket)
      setView(v)
      setTeam(t)
    }
    const doc = document as Document & { startViewTransition?: (run: () => void) => unknown }
    if (v === view || !doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return apply()
    doc.startViewTransition(() => flushSync(apply))
  }
  const openProfile = (id: string, tab: CandidateTab = "Resume") => setProfile({ id, tab })
  /* An offer opens on its own page, never inside the candidate */
  const openOffer = (id: string) => {
    setProfile(null)
    if (!offers[id]) setOffer(id, () => ({ salary: "", equity: "", start: "", status: "draft", approval: "none" }), "Drafted an offer")
    setOfferId(id)
    go("offers", null)
  }
  const log = (id: string, a: Activity) => setActivity((all) => ({ ...all, [id]: [...(all[id] ?? []), a] }))
  const patchPerson = (id: string, fn: (p: Person) => Person) => setPeople((ps) => ps.map((p) => (p.id === id ? fn(p) : p)))
  const patchRole = (id: string, fn: (r: Role) => Role) => setRoles((rs) => rs.map((r) => (r.id === id ? fn(r) : r)))
  const patch = (id: string, fn: (t: Task) => Task) => setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  const step = (label: string) => ({ label, at: "now" })

  /* A member's command goes to the bot (bot_task_commands); the bot then reports what happened */
  const command = (t: Task, c: Command) => {
    if (c === "cancel") return patch(t.id, (x) => ({ ...x, status: "cancelled", needsYou: false, steps: [...x.steps, step("Cancelled")] }))
    const said = c === "retry" ? "Retrying" : c === "nudge" ? `Nudged ${t.waitingOn?.name ?? "them"}` : `Invite sent to ${t.draft?.to ?? "the candidate"}`
    const reply = t.after?.[c]
    setWorking(t.id)
    patch(t.id, (x) => ({ ...x, status: "running", needsYou: false, error: undefined, draft: c === "send_invite" ? undefined : x.draft, steps: [...x.steps, step(said)] }))
    window.setTimeout(() => {
      patch(t.id, (x) => ({
        ...x,
        status: reply?.status ?? "waiting",
        waitingOn: reply ? reply.waitingOn : c === "send_invite" ? { name: personOf(t.person).name.split(" ")[0], channel: "Email" } : x.waitingOn,
        steps: [...x.steps, ...(reply?.steps ?? []).map(step)],
      }))
      setWorking(null)
    }, 3600)
  }

  /*
   * The routing bar's three moves (New Applicants in tATS):
   *   interview  the applicant goes onto a team's job at Screening and the bot starts finding an interviewer
   *   testbench  they are sent the take-home link; nobody moves stage
   *   decline    rejected, with one of the org's reasons
   */
  const route = (a: Applicant, r: Routing) => {
    setTriage((xs) => xs.filter((x) => x.id !== a.id))
    /* The grade is kept as a note on the person: add_note */
    if (r.grade && (r.grade.confidence || r.grade.note)) {
      log(a.id, { who: ME, note: true, when: "now", text: [r.grade.confidence && `Confidence ${r.grade.confidence} of 5.`, r.grade.note].filter(Boolean).join(" ") })
    }
    if (r.move === "decline") return setPassed((ps) => [{ a, reason: r.reason ?? "", confidence: r.grade?.confidence, note: r.grade?.note ?? "" }, ...ps])
    const role = roleOf(r.roleId ?? a.role)
    const testbench = r.move === "testbench"
    setPeople((ps) => [{
      id: a.id, name: a.name, role: role.id, stage: testbench ? 1 : 2, owner: r.to ?? role.manager, source: sourceOf(a),
      next: testbench ? "Testbench sent" : `Book the ${role.plan[0]}`,
    }, ...ps])
    setTasks((ts) => [testbench
      ? { id: `t-${a.id}`, person: a.id, kind: "send_testbench" as const, status: "waiting" as const, needsYou: false, age: "now", waitingOn: { name: a.name.split(" ")[0], channel: "Email" as const }, steps: [{ label: "Sent the Testbench link", at: "now" }] }
      : { id: `t-${a.id}`, person: a.id, kind: "find_interviewer" as const, step: role.plan[0], status: "running" as const, needsYou: false, age: "now", steps: [{ label: `Sent to ${teamOf(role.team).name}`, at: "now" }, { label: "Asking the hiring team who can take it", at: "now" }] },
    ...ts])
  }

  /* Back into Triage, to be routed again */
  const reopen = (id: string) => {
    const hit = passed.find((x) => x.a.id === id)
    if (!hit) return
    setPassed((ps) => ps.filter((x) => x.a.id !== id))
    setTriage((xs) => [hit.a, ...xs])
    setToast(`${hit.a.name} is back in Triage`)
  }

  /* update_stage: forward, back, or closed with a reason */
  const moveStage = (id: string, to: number | { closed: "Rejected" | "Withdrawn" | "Hired"; reason?: string }) => {
    if (typeof to === "number") {
      patchPerson(id, (p) => ({ ...p, stage: to, closed: undefined, stalled: undefined }))
      log(id, { who: ME, text: `Moved to ${STAGES[to]}`, when: "now" })
    } else {
      patchPerson(id, (p) => ({ ...p, closed: to.closed, next: null, due: undefined, stalled: undefined }))
      log(id, { who: ME, text: to.reason ? `${to.closed}: ${to.reason}` : `Marked ${to.closed.toLowerCase()}`, when: "now" })
    }
  }
  /* add_note */
  const addNote = (id: string, text: string) => log(id, { who: ME, text, when: "now", note: true })
  /* draft_email then send_email */
  const sendEmail = (id: string, e: Pick<Email, "subject" | "body">) => {
    setEmails((all) => ({ ...all, [id]: [...(all[id] ?? []), { ...e, out: true, who: ME, when: "now" }] }))
    log(id, { who: ME, text: `Emailed: ${e.subject}`, when: "now" })
  }
  /* submit_feedback */
  const fileFeedback = (i: Interview, f: Feedback) => {
    setFiled((all) => ({ ...all, [i.person]: [...(all[i.person] ?? []), f] }))
    log(i.person, { who: f.who, text: `Filed feedback on ${i.step}`, when: "now" })
    setToast("Feedback filed")
  }
  /* schedule_interview and update_interview */
  const book = (i: Omit<Interview, "id" | "done">, replace?: string) => {
    setInterviews((all) => replace ? all.map((x) => (x.id === replace ? { ...x, ...i } : x)) : [...all, { ...i, id: `i${Date.now()}`, done: false }])
    patchPerson(i.person, (p) => ({ ...p, next: `${i.step}, ${i.when}`, due: undefined, stalled: undefined }))
    log(i.person, { who: ME, text: `${replace ? "Moved" : "Booked"} ${i.step} for ${i.when}`, when: "now" })
    setToast(replace ? "Interview moved" : "Interview booked")
  }
  const setOffer = (id: string, fn: (o: Offer | undefined) => Offer, said: string) => {
    setOffers((all) => ({ ...all, [id]: fn(all[id]) }))
    log(id, { who: ME, text: said, when: "now" })
  }
  /* add_candidate: someone added by hand lands in Triage as sourced */
  const addCandidate = (name: string, email: string, roleId: string) => {
    const id = `n${Date.now()}`
    setTriage((xs) => [{ id, name, role: roleId, origin: "sourced", by: ME, note: "Added by hand", time: "now", email }, ...xs])
    setToast(`${name} added to Triage`)
  }
  /* For edits to the constant member records (profiles, access): redraw after changing them in place */
  const touch = () => setTick((n) => n + 1)

  const approvals = Object.entries(offers).filter(([, o]) => o.approval === "pending" && flows.offer.includes(ME)).map(([id]) => id)

  return {
    view, team, tasks, people, roles, triage, passed, offerId, tour, askId, rounds, process, roundsBuilt, openId, working, profile, palette, sheet, toast, settings, theme,
    interviews, filed, offers, emails, activity, personTags, tags, pools, prospects, checkins, invites, templates, fields, fieldValues, offices, reasons, flows, integrations, connector,
    tickets, approvals,
    setView, setTeam, setRoles, setOpenId, setProfile, setPalette, setSheet, setToast, setSettings, setTheme,
    setInterviews, setOffers, setPersonTags, setTags, setPools, setProspects, setCheckins, setInvites, setTemplates, setFields, setFieldValues, setOffices, setReasons, setFlows, setIntegrations, setConnector, setPeople, setTriage,
    personOf, roleOf, toneFor, attn, sourceOf, go, openProfile, openOffer, setOfferId, setTour, setAskId, setRounds, setProcess, setRoundsBuilt, patchPerson, patchRole, command, route, reopen, moveStage, addNote, sendEmail, fileFeedback, book, setOffer, addCandidate, touch, log,
  }
}

export type Store = ReturnType<typeof useStoreState>
const Ctx = createContext<Store | null>(null)
export const StoreProvider = Ctx.Provider
export const useStore = () => useContext(Ctx)!
