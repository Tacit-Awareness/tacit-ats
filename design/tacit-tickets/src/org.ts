/*
 * The rest of what tATS holds, beyond the pipeline: members and access, interviews, offers and
 * their approvals, candidate email, notes, tags, pools, templates, custom fields, integrations,
 * the connector, and the reports. Each block names the connector tools it stands in for.
 */

/* whoami */
export const ME = "nick"

/* list_team, set_member_access, interviewer profiles */
export type Access = "admin" | "hiring" | "interviewer"
export const ACCESS: Access[] = ["admin", "hiring", "interviewer"]
export const ACCESS_LABEL: Record<Access, string> = { admin: "Admin", hiring: "Hiring Team", interviewer: "Interviewer" }
export type Preference = "likes" | "either" | "rather_not"
export const PREFERENCE_LABEL: Record<Preference, string> = { likes: "Likes It", either: "Either Way", rather_not: "Rather Not" }
export type MemberMeta = { email: string; title: string; access: Access; preference: Preference; channel: "Slack" | "Email" }
export const MEMBERS: Record<string, MemberMeta> = {
  nick: { email: "nick@tacit.example", title: "Head of Talent", access: "admin", preference: "likes", channel: "Slack" },
  luca: { email: "luca@tacit.example", title: "Infrastructure Lead", access: "hiring", preference: "either", channel: "Slack" },
  kevin: { email: "kevin@tacit.example", title: "Forward Deployed Lead", access: "hiring", preference: "rather_not", channel: "Slack" },
  ben: { email: "ben@tacit.example", title: "Design Lead", access: "hiring", preference: "likes", channel: "Email" },
  ines: { email: "ines@tacit.example", title: "Platform Engineer", access: "interviewer", preference: "either", channel: "Slack" },
}
/* list_invites, invite_member, withdraw_invite */
export type Invite = { email: string; access: Access; sent: string }
export const INVITES: Invite[] = [{ email: "marvin@tacit.example", access: "interviewer", sent: "2d ago" }]

/* list_my_interviews, schedule_interview, update_interview, get_interview_notes */
export type Interview = {
  id: string
  person: string
  step: string
  /* 0 to 4, Monday to Friday of this week; past ones carry only their label */
  day: number
  start: number
  mins: number
  when: string
  interviewers: string[]
  done: boolean
  /* the meeting notes pulled in from Granola, when there are any */
  notes?: string
}
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
export const INTERVIEWS: Interview[] = [
  { id: "i1", person: "platform-b", step: "Recruiter Screen", day: 0, start: 11, mins: 30, when: "Mon 11:00 AM", interviewers: ["nick"], done: true, notes: "Talked through the migration project. Clear on trade-offs, asked good questions about on-call." },
  { id: "i2", person: "sofia", step: "Round 2", day: 0, start: 14, mins: 60, when: "Mon 2:00 PM", interviewers: ["luca"], done: true },
  { id: "i3", person: "data-b", step: "Recruiter Screen", day: 1, start: 10, mins: 30, when: "Tue 10:00 AM", interviewers: ["nick"], done: false },
  { id: "i4", person: "ml-a", step: "Round 2", day: 2, start: 14, mins: 60, when: "Wed 2:00 PM", interviewers: ["ines"], done: false },
  { id: "i5", person: "maya", step: "Onsite", day: 3, start: 10, mins: 180, when: "Thu 10:00 AM", interviewers: ["ben", "kevin", "nick"], done: false },
  { id: "i6", person: "lena", step: "Offer Call", day: 4, start: 15, mins: 30, when: "Fri 3:00 PM", interviewers: ["nick"], done: false },
]
/* find_interview_times: open slots that respect each interviewer's weekly limit and time away */
export const SLOTS = ["Tue 1:00 PM", "Wed 10:30 AM", "Thu 3:00 PM"]

/* get_offers, create_offer, update_offer, request_approval, list_my_approvals */
export type OfferStatus = "draft" | "extended" | "accepted" | "declined" | "withdrawn"
export const OFFER_LABEL: Record<OfferStatus, string> = { draft: "Draft", extended: "Extended", accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn" }
/* What DocuSign reports for the letter once it is out for signature */
export type Envelope = { sent: string; candidate: "sent" | "viewed" | "signed" | "declined" }
/* salary, equity and start are the offer; the rest are the blanks of the offer letter, and any clause rewritten for this offer */
export type Offer = {
  status: OfferStatus; salary: string; equity: string; start: string; approval: "none" | "pending" | "approved" | "rejected"; askedBy?: string
  period?: "year" | "month" | "hour"; benefits?: boolean; grant?: "option" | "purchase" | "none"; shares?: string; plan?: string
  expires?: string; address?: string; title?: string; duties?: string; edits?: Record<string, string>; envelope?: Envelope
}
/* The company as its letters name it */
export const COMPANY = { name: "Tacit, Inc.", state: "Delaware" }
export const OFFERS: Record<string, Offer> = {
  lena: { status: "draft", salary: "$185,000", equity: "0.40%", start: "January 5, 2027", approval: "pending", askedBy: "ben", grant: "option", shares: "40,000", plan: "2026 Stock Plan", expires: "November 28, 2026", benefits: true },
}

/* What someone said in their interviews, from the meeting notes (get_interview_notes), and what follows from it for the offer */
export type Win = { said: { quote: string; step: string; who: string }[]; win: string[]; risk?: string }
export const WINS: Record<string, Win> = {
  lena: {
    said: [
      { quote: "I left my last place because design stopped at the handoff. I want to own what ships.", step: "Round 2", who: "luca" },
      { quote: "Berlin is home for now. I can do two weeks a quarter in person, not a move.", step: "Round 3", who: "kevin" },
      { quote: "I have another offer I need to answer by the 28th. I would rather be here.", step: "Onsite", who: "ben" },
    ],
    win: ["Lead with ownership: she ships the design system in code, no handoff", "Put remote from Berlin, with two weeks a quarter on site, in writing", "Send the offer before Nov 28; she has a competing deadline"],
    risk: "Equity came up twice. She asked how the 0.40% compares with the first engineers.",
  },
}

/* list_emails, draft_email, send_email, and the replies that come back */
export type Email = { out: boolean; who: string; subject: string; body: string; when: string }
export const EMAILS: Record<string, Email[]> = {
  rohan: [
    { out: true, who: "nick", subject: "Recruiter screen for Infra Engineer", body: "Hi Rohan, Luca passed your name along and we'd love to talk. Do you have 30 minutes this week for a first call?", when: "Nov 5" },
    { out: false, who: "Rohan", subject: "Re: Recruiter screen for Infra Engineer", body: "Happy to. Thursday after 2 PM Pacific works.", when: "Nov 5" },
    { out: true, who: "nick", subject: "Re: Recruiter screen for Infra Engineer", body: "Booked for Thursday at 2:30 PM. A calendar invite is on its way.", when: "Nov 6" },
    { out: true, who: "nick", subject: "Round 2 for Infra Engineer", body: "Hi Rohan, thanks for the conversation. The team would like to meet you for a second round with Luca. What times work next week?", when: "Nov 12" },
    { out: false, who: "Rohan", subject: "Re: Round 2 for Infra Engineer", body: "Thanks Nick. Tuesday or Wednesday afternoon both work, Pacific time.", when: "Nov 13" },
  ],
  maya: [
    { out: true, who: "nick", subject: "Round 2 for Forward Deployed Engineer", body: "Hi Maya, great talking on Monday. Luca would like to go deeper on the integration work. Are you free Thursday?", when: "Nov 4" },
    { out: false, who: "Maya", subject: "Re: Round 2 for Forward Deployed Engineer", body: "Thursday at 11 works for me.", when: "Nov 4" },
    { out: true, who: "nick", subject: "Round 3 for Forward Deployed Engineer", body: "Hi Maya, Luca enjoyed the session. Next is a customer roleplay with Kevin. Would Monday the 10th suit you?", when: "Nov 7" },
    { out: false, who: "Maya", subject: "Re: Round 3 for Forward Deployed Engineer", body: "Monday is fine. Anything I should prepare?", when: "Nov 7" },
    { out: true, who: "kevin", subject: "Re: Round 3 for Forward Deployed Engineer", body: "Nothing to prepare. I'll play a customer with a broken integration and we'll work through it together.", when: "Nov 8" },
    { out: true, who: "nick", subject: "Onsite for Forward Deployed Engineer", body: "Hi Maya, we'd like to have you in for an onsite with Ben, Kevin and me on Thursday at 10:00 AM. Does that work?", when: "Nov 12" },
  ],
  lena: [{ out: true, who: "nick", subject: "Catching up Friday", body: "Hi Lena, the team loved meeting you. Could we talk Friday at 3:00 PM about next steps?", when: "Nov 15" }],
  daniel: [{ out: true, who: "kevin", subject: "A short take-home for Forward Deployed Engineer", body: "Hi Daniel, before we talk again we'd like you to try a short take-home. The link is below.", when: "Nov 14" }],
}

/* get_activity and add_note */
export type Activity = { who: string | null; text: string; when: string; note?: boolean }
export const ACTIVITY: Record<string, Activity[]> = {
  rohan: [
    { who: "luca", text: "Referred Rohan", when: "Nov 8" },
    { who: "nick", text: "Moved to Screening", when: "Nov 9" },
    { who: "nick", text: "Filed a strong yes on Recruiter Screen", when: "Nov 12" },
    { who: "nick", text: "Moved to Interviewing", when: "Nov 12" },
    { who: "luca", text: "wants the systems exercise for round 2, not the generic one", when: "Nov 17", note: true },
  ],
  lena: [
    { who: "ben", text: "Filed a strong yes on Onsite", when: "Nov 14" },
    { who: "nick", text: "Moved to Offer", when: "Nov 14" },
    { who: "ben", text: "Asked for approval on the offer", when: "Nov 16" },
  ],
}

/* list_tags, create_tag, archive_tag, tag_candidate */
export const TAGS = ["Postgres", "Design engineer", "Enterprise", "Open source", "Relocating", "Returning candidate"]

/* list_pools, create_pool, archive_pool, list_pool, add_prospect, convert_prospect */
/*
 * People to check in on later: who they were to us, where they work now, and when to look again.
 * In tATS this is a pool (add_to_pool), a next action with a date (set_next_action), and the
 * person's current title and company (update_candidate), whose changes tATS already keeps.
 */
export type CheckIn = { id: string; name: string; was: string; now: string; moved?: { from: string; when: string }; due: string; late?: boolean; last?: string }
export const CHECKINS: CheckIn[] = [
  { id: "c1", name: "Ravi Menon", was: "Infra Engineer, reached the onsite in March", now: "Staff Engineer at Corewave", due: "Nov 10", late: true, last: "said to ask again after his launch" },
  { id: "c2", name: "Tom Becker", was: "Infra Engineer, declined after the recruiter screen", now: "Platform Engineer at Ridgeline", moved: { from: "DevOps Engineer at Altamont", when: "Oct" }, due: "Nov 20", last: "wanted to own something in production first" },
  { id: "c3", name: "Grace Oyelaran", was: "Founding Designer, took another offer", now: "Product Designer at Nest & Co", due: "Dec 1", last: "one-year cliff is in January" },
  { id: "c4", name: "Hana Ito", was: "Forward Deployed Engineer, timing was wrong", now: "Solutions Engineer at Parabola", moved: { from: "Support Engineer at Parabola", when: "Sep" }, due: "Feb 2" },
  { id: "c5", name: "Elias Brandt", was: "Infra Engineer, withdrew for a visa", now: "SRE at Baltic Pay", due: "Apr 15", last: "visa decision expected in spring" },
]

export type Prospect = { id: string; name: string; headline: string; pool: string }
export const POOLS = ["Silver Medalists", "Infra Meetup", "Design Twitter"]
export const PROSPECTS: Prospect[] = [
  { id: "p1", name: "Ravi Menon", headline: "Staff Engineer at Corewave", pool: "Silver Medalists" },
  { id: "p2", name: "Alice Hartmann", headline: "Design Engineer at Looplane", pool: "Design Twitter" },
  { id: "p3", name: "Tomasz Wojcik", headline: "SRE at Baltic Pay", pool: "Infra Meetup" },
  { id: "p4", name: "Grace Oyelaran", headline: "Product Designer at Nest & Co", pool: "Silver Medalists" },
]

/* list_email_templates, create_email_template, update_email_template */
export type Template = { id: string; name: string; subject: string; body: string }
export const TEMPLATES: Template[] = [
  { id: "interview", name: "Interview", subject: "Next step for {{job}}", body: "Hi {{first_name}},\n\nThe team would like to meet you. What times work for you this week or next?" },
  { id: "testbench", name: "Testbench", subject: "A short take-home for {{job}}", body: "Hi {{first_name}},\n\nBefore we talk, we'd like you to try a short take-home. Your link is below.\n\n{{testbench_link}}" },
  { id: "decline", name: "Decline", subject: "Your application for {{job}}", body: "Hi {{first_name}},\n\nThank you for your interest. We've decided not to move forward right now." },
]

/* list_custom_fields, create_custom_field, update_custom_field, set_custom_field */
export type Field = { id: string; name: string; type: "Text" | "Number" | "Select" | "Date" | "Yes / No"; on: "Candidate" | "Job" }
export const FIELDS: Field[] = [
  { id: "f1", name: "Notice Period", type: "Text", on: "Candidate" },
  { id: "f2", name: "Needs Visa", type: "Yes / No", on: "Candidate" },
  { id: "f3", name: "Budget Band", type: "Select", on: "Job" },
  { id: "f4", name: "Employment Type", type: "Select", on: "Job" },
  { id: "f5", name: "Workplace", type: "Select", on: "Job" },
  { id: "f6", name: "Level", type: "Text", on: "Job" },
  { id: "f7", name: "Visa Sponsorship", type: "Yes / No", on: "Job" },
  { id: "f8", name: "Start Date", type: "Date", on: "Job" },
]
export const FIELD_VALUES: Record<string, Record<string, string>> = { rohan: { f1: "4 weeks", f2: "No" }, lena: { f1: "3 months", f2: "Yes" }, infra: { f4: "Full-time", f5: "Hybrid" } }

/* list_offices, create_office, update_office */
export const OFFICES = ["San Francisco", "New York", "Remote"]

/*
 * The interview process: its rounds in order. One for the company, and a branch for any team that
 * runs it differently (tATS: one process per company, a branch per team; set_interview_plan).
 */
export type RoundKind = "screen" | "interview" | "takehome" | "onsite" | "reference"
export type RoundBy = "Recruiter" | "Hiring Manager" | "Team"
export type RoundDef = { id: string; name: string; kind: RoundKind; minutes: number; by: RoundBy; people: number }
export const ROUND_KINDS: Record<RoundKind, string> = { screen: "Screen", interview: "Interview", takehome: "Take-Home", onsite: "Onsite", reference: "Reference" }
/* What the builder's palette offers, each a round ready to drop in */
export const ROUND_PRESETS: Omit<RoundDef, "id">[] = [
  { name: "Recruiter Screen", kind: "screen", minutes: 30, by: "Recruiter", people: 1 },
  { name: "Hiring Manager Call", kind: "screen", minutes: 45, by: "Hiring Manager", people: 1 },
  { name: "Technical Interview", kind: "interview", minutes: 60, by: "Team", people: 2 },
  { name: "Take-Home", kind: "takehome", minutes: 0, by: "Team", people: 1 },
  { name: "Onsite", kind: "onsite", minutes: 180, by: "Team", people: 3 },
  { name: "Reference Call", kind: "reference", minutes: 30, by: "Recruiter", people: 1 },
]
export const newRound = (name: string): RoundDef => {
  const preset = ROUND_PRESETS.find((r) => r.name === name) ?? { name, kind: "interview" as const, minutes: 60, by: "Team" as const, people: 2 }
  return { ...preset, name, id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }
}
export const DEFAULT_PROCESS: RoundDef[] = [
  { id: "rd1", name: "Recruiter Screen", kind: "screen", minutes: 30, by: "Recruiter", people: 1 },
  { id: "rd2", name: "Round 2", kind: "interview", minutes: 60, by: "Team", people: 1 },
  { id: "rd3", name: "Take-Home", kind: "takehome", minutes: 0, by: "Team", people: 1 },
  { id: "rd4", name: "Round 3", kind: "interview", minutes: 60, by: "Team", people: 2 },
  { id: "rd5", name: "Onsite", kind: "onsite", minutes: 180, by: "Team", people: 3 },
]

/* get_approval_flow, set_approval_flow */
export const APPROVAL_FLOWS: Record<"offer" | "job_open", string[]> = { offer: ["nick"], job_open: ["nick", "luca"] }

/* The Integrations page: the company's bot, calendars, mailbox, meeting notes, Testbench */
export type Integration = { id: string; name: string; detail: string; on: boolean }
export const INTEGRATIONS: Integration[] = [
  { id: "bot", name: "Grokbot", detail: "Answering at its webhook", on: true },
  { id: "calendar", name: "Google Calendar", detail: "4 of 5 people connected", on: true },
  { id: "mail", name: "Mailbox", detail: "Replies come back to the candidate's page", on: true },
  { id: "granola", name: "Granola", detail: "Meeting notes on interviews", on: false },
  { id: "testbench", name: "Tacit Testbench", detail: "Linked to this company", on: true },
  { id: "docusign", name: "DocuSign", detail: "Offer letters go out for signature", on: true },
]

/* get_connector_settings, set_connector_access */
export const CONNECTOR_URL = "https://ats-mcp.tacitawareness.com/api/client"

/* pipeline_report, source_report, time_to_hire, rejection_report, offer_report, eeoc_report */
export type Bar = [label: string, value: number, note?: string]
export const REPORTS: Record<"30d" | "90d", { funnel: Bar[]; sources: Bar[]; rejections: Bar[]; hire: Bar[]; offers: Bar[]; eeo: Bar[] }> = {
  "30d": {
    funnel: [["Applied", 124], ["Screening", 51, "41%"], ["Interviewing", 29, "57%"], ["Offer", 6, "21%"], ["Hired", 4, "67%"]],
    sources: [["Job board", 71], ["Referral", 28], ["Sourced", 19], ["Tacit", 6]],
    rejections: [["Experience", 34], ["Not a fit", 22], ["Role closed", 9], ["Location", 5]],
    hire: [["Infrastructure", 31, "days"], ["Forward Deployed", 24, "days"], ["Design", 38, "days"]],
    offers: [["Extended", 6], ["Accepted", 4], ["Declined", 1], ["Open", 1]],
    eeo: [["Responded", 86, "of 124"], ["Declined to say", 21], ["Groups under 5 are hidden", 0]],
  },
  "90d": {
    funnel: [["Applied", 402], ["Screening", 158, "39%"], ["Interviewing", 84, "53%"], ["Offer", 17, "20%"], ["Hired", 11, "65%"]],
    sources: [["Job board", 233], ["Referral", 84], ["Sourced", 61], ["Tacit", 24]],
    rejections: [["Experience", 118], ["Not a fit", 77], ["Role closed", 31], ["Location", 16]],
    hire: [["Infrastructure", 34, "days"], ["Forward Deployed", 27, "days"], ["Design", 41, "days"]],
    offers: [["Extended", 17], ["Accepted", 11], ["Declined", 4], ["Open", 2]],
    eeo: [["Responded", 281, "of 402"], ["Declined to say", 64], ["Groups under 5 are hidden", 0]],
  },
}
