/*
 * Everything here mirrors a shape tATS already has, so the screens need no new backend:
 *
 *   Task      bot_tasks: what the company's Grokbot is doing. Kinds, statuses, steps,
 *             waiting-on and needs_you are that table's; commands are bot_task_commands.
 *   Person    an application: stage, owner, next action, stalled reasons (get_pipeline).
 *   Role      a job: hiring team, openings, interview plan, scorecard.
 *   Staff     an org member with their interviewer profile (weekly cap, away, focus areas).
 *   Applicant list_applications_inbox.
 */

/* bot_tasks.status, with needs_you lifted to the front because it is what a human acts on */
export type Status = "needs" | "failed" | "waiting" | "running" | "done" | "cancelled"
export const STATUS_ORDER: Status[] = ["needs", "failed", "waiting", "running", "done", "cancelled"]
export const STATUS_LABEL: Record<Status, string> = {
  needs: "Needs You",
  failed: "Failed",
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  cancelled: "Cancelled",
}

/* BOT_TASK_KINDS */
export type Kind = "find_interviewer" | "ask_interviewer" | "schedule_interview" | "get_read" | "send_testbench" | "send_rejection" | "send_invite" | "other"
export const KIND_LABEL: Record<Kind, string> = {
  find_interviewer: "Find Interviewer",
  ask_interviewer: "Ask Interviewer",
  schedule_interview: "Schedule Interview",
  get_read: "Get Read",
  send_testbench: "Send Testbench",
  send_rejection: "Send Rejection",
  send_invite: "Send Invite",
  other: "Other",
}

/* BOT_TASK_COMMANDS: the only things a member can tell the bot */
export type Command = "retry" | "nudge" | "send_invite" | "cancel"
export const COMMAND_LABEL: Record<Command, string> = { retry: "Retry", nudge: "Nudge", send_invite: "Send Invite", cancel: "Cancel" }

/* ACTIVE_STAGES of an application */
export const STAGES = ["Sourced", "Contacted", "Screening", "Interviewing", "Offer"]

export type Staff = { id: string; name: string; first: string; load: number; cap: number | null; awayUntil?: string; focus: string[] }
export const STAFF: Record<string, Staff> = {
  nick: { id: "nick", name: "Nick Klatzky", first: "Nick", load: 2, cap: 5, focus: ["Recruiter screen"] },
  luca: { id: "luca", name: "Luca Pastore", first: "Luca", load: 4, cap: 4, focus: ["Databases", "Systems"] },
  kevin: { id: "kevin", name: "Kevin Park", first: "Kevin", load: 1, cap: 4, focus: ["Customer work", "APIs"] },
  ben: { id: "ben", name: "Ben Spector", first: "Ben", load: 3, cap: 4, awayUntil: "Nov 24", focus: ["Design", "Onsites"] },
  ines: { id: "ines", name: "Ines Moreau", first: "Ines", load: 1, cap: null, focus: ["Platform"] },
}

export type Attribute = { id: string; name: string; note?: string }
export type Role = {
  id: string
  team: string
  title: string
  manager: string
  open: number
  filled: number
  /* roles.interview_steps */
  plan: string[]
  /* the job's scorecard: what interviewers are asked to rate */
  scorecard: Attribute[]
  /* update_job */
  closed?: boolean
  office?: string
  /* get_hiring_team, add_to_hiring_team, remove_from_hiring_team: beyond the manager */
  team_members?: string[]
  /* list_job_posts, create_job_post, set_job_post_status: the public post and its form */
  post?: JobPost
  /* shown on the post, beside location and department */
  comp?: string
}
/* The post's description is one document: paragraphs, headings and list items, in order */
export type Block = { id: string; kind: "p" | "h" | "li"; text: string }
export type JobPost = { status: "draft" | "live" | "closed"; applications: number; views: number; questions: string[]; body: Block[] }

export type Person = {
  id: string
  name: string
  role: string
  stage: number
  closed?: "Hired" | "Rejected" | "Withdrawn"
  owner: string
  /* applications.next_action and its due date */
  next: string | null
  due?: string
  /* stalledReasons(): overdue next action, or nobody has touched it in 7 days */
  stalled?: "overdue" | "no_touch"
  source: string
}

export type Step = { label: string; at: string }
export type Draft = { to: string; subject: string; body: string }
export type Task = {
  id: string
  person: string
  kind: Kind
  /* the interview step this is about, when there is one */
  step?: string
  status: "running" | "waiting" | "done" | "failed" | "cancelled"
  needsYou: boolean
  waitingOn?: { name: string; channel: "Slack" | "Email" | "iMessage" }
  age: string
  steps: Step[]
  error?: string
  /* a candidate email drafted and not yet sent (draft_email, then send_email) */
  draft?: Draft
  /* ask_interviewer tasks hang off the find_interviewer task that raised them */
  parent?: string
  interviewer?: string
  /* What the bot reports back after a command, so the demo can play it out */
  after?: Partial<Record<Command, { steps: string[]; status: Task["status"]; waitingOn?: Task["waitingOn"] }>>
}

export const statusOf = (t: Task): Status => (t.needsYou && (t.status === "waiting" || t.status === "running") ? "needs" : t.status)

/* Which commands make sense for a task as it stands */
export function commandsFor(t: Task): Command[] {
  if (t.status === "failed") return ["retry", "cancel"]
  if (t.status === "waiting" && t.draft) return ["send_invite", "cancel"]
  if (t.status === "waiting") return ["nudge", "cancel"]
  if (t.status === "running") return ["cancel"]
  return []
}

/* applications.source for someone still at the first stage (list_applications_inbox) */
export type Origin = "referral" | "job_board" | "sourced"
export const ORIGIN_ORDER: Origin[] = ["referral", "job_board", "sourced"]
export const ORIGIN_LABEL: Record<Origin, string> = { referral: "Referred", job_board: "Applied", sourced: "Sourced" }
/*
 * For a referral the bot reads the resume against every open ask and ranks the teams that
 * could pick the person up. That is a task on the application whose steps are the reasoning;
 * the member decides which team's process they go into.
 */
export type Route = { role: string; matched: string[] }
export type Suggestion = { status: "running" | "done"; routes: Route[]; steps: string[] }
export type Applicant = {
  id: string
  name: string
  role: string
  origin: Origin
  /* who referred or sourced them */
  by?: string
  note: string
  time: string
  /* the job post's questions and their answers */
  answers?: { q: string; a: string }[]
  suggestion?: Suggestion
  email: string
  phone?: string
  linkedin?: string
  /* the application's notes: for a referral, what the referrer said */
  notes?: string
  testbench?: Testbench
}

/*
 * Tacit Testbench for this applicant. tATS keeps the invite and its attempt id
 * (testbench_invites); the result itself is Testbench's, read through that attempt.
 */
export type Shape = { understanding: number; time: number; quality: number }
export type TestPart = { key: string; name: string; bar: number; cases: { name: string; pass: boolean; hidden?: boolean }[] }
export type PathKind = "ask" | "do" | "limit" | "check"
export type PathRow = { kind: PathKind | "end"; text: string; test?: string; testOn?: boolean; at: string }
export type Testbench = {
  status: "invited" | "submitted"
  task: string
  when: string
  score?: number
  percentile?: string
  took?: string
  highlights?: string[]
  /* What Testbench staff see on a graded attempt (the review dashboard): tests against the company's bar, the three
     readings out of 10 beside the team median, what is behind each reading, and the path through the session */
  parts?: TestPart[]
  shape?: Shape
  team?: Shape
  claims?: { matched: number; of: number }
  steps?: { min: number; passing: number }[]
  pace?: { min: number; cases: number }[]
  quality?: { name: string; got: number; of: number }[]
  path?: PathRow[]
  recordings?: { name: string; length: string }[]
  activity?: { at: string; text: string }[]
  agent?: string
  minutes?: number
}

/* The org's rejection reasons; declining needs one (list_rejection_reasons) */
export const REJECTION_REASONS = ["Not a fit", "Experience", "Role closed", "Location"]

let n = 0
const attr = (name: string, note?: string): Attribute => ({ id: `a${n++}`, name, note })
const steps = (...rows: [string, string][]): Step[] => rows.map(([label, at]) => ({ label, at }))

export const ROLES: Role[] = [
  {
    id: "infra", team: "infra", title: "Infra Engineer", manager: "luca", open: 2, filled: 0,
    plan: ["Recruiter Screen", "Round 2", "Round 3", "Onsite"],
    scorecard: [
      attr("Production ownership", "Has owned a database or core service in production"),
      attr("Debugging under load", "Stays calm and methodical when it is on fire"),
      attr("Writing", "Explains decisions clearly in writing"),
      attr("Open source"),
    ],
  },
  {
    id: "fde", team: "fde", title: "Forward Deployed Engineer", manager: "kevin", open: 1, filled: 0,
    plan: ["Recruiter Screen", "Round 2", "Take-Home", "Round 3", "Onsite"],
    scorecard: [
      attr("Ships in a customer's stack", "Has shipped inside someone else's codebase"),
      attr("Customer presence", "Comfortable on a call with a CTO"),
      attr("Agent tooling"),
      attr("Self-direction", "Starts without a spec"),
    ],
  },
  {
    id: "design", team: "design", title: "Founding Designer", manager: "ben", open: 1, filled: 0,
    plan: ["Recruiter Screen", "Round 2", "Round 3", "Onsite"],
    scorecard: [
      attr("Designs and builds", "Ships the front end, not only the mock"),
      attr("Dense tools", "Taste for information-heavy products"),
      attr("Motion"),
    ],
  },
]

export const PEOPLE: Person[] = [
  { id: "rohan", name: "Rohan Dalal", role: "infra", stage: 3, owner: "luca", next: "Send the Round 2 invite", due: "Today", source: "Referral" },
  { id: "noah", name: "Noah Kim", role: "infra", stage: 3, owner: "nick", next: "Find a Round 2 interviewer", due: "Yesterday", stalled: "overdue", source: "Sourced" },
  { id: "maya", name: "Maya Chen", role: "fde", stage: 3, owner: "ben", next: "Onsite, Thu 10:00 AM", source: "Job board" },
  { id: "sofia", name: "Sofia Reyes", role: "design", stage: 3, owner: "ben", next: "Book Round 3", due: "Thu", source: "Job board" },
  { id: "arjun", name: "Arjun Mehta", role: "infra", stage: 2, owner: "nick", next: "Waiting on a reply", stalled: "no_touch", source: "Sourced" },
  { id: "daniel", name: "Daniel Okafor", role: "fde", stage: 3, owner: "kevin", next: "Take-home due", due: "Sunday", stalled: "overdue", source: "Job board" },
  { id: "lena", name: "Lena Fischer", role: "design", stage: 4, owner: "nick", next: "Offer call, Fri 3:00 PM", source: "Referral" },
  { id: "tom", name: "Tom Becker", role: "infra", stage: 2, closed: "Rejected", owner: "nick", next: null, source: "Job board" },
]

const INVITE = `Hi Rohan,

Great talking with Nick last week. We'd like you to meet Luca Pastore, who leads infrastructure, for a second round.

Tuesday, Nov 24 at 1:00 PM PT, 60 minutes on video. It is a hands-on systems exercise: you will debug a slow service with Luca. No prep needed.

Does that time work? If not, send two or three that do and we will sort it out.

Nick`

export const TASKS: Task[] = [
  {
    id: "t1", person: "rohan", kind: "send_invite", step: "Round 2", status: "waiting", needsYou: true, age: "2h",
    steps: steps(
      ["Asked Luca, Kevin and Ben", "9:02"],
      ["Ben is away through Nov 24", "9:03"],
      ["Kevin can do Thu or Fri", "9:10"],
      ["Luca can do Tue 1:00 PM", "9:14"],
      ["Picked Luca: soonest, and on the hiring team", "9:14"],
      ["Luca asked for 1:00 PM and the systems exercise", "9:31"],
      ["Drafted the invite", "9:31"],
    ),
    draft: { to: "Rohan Dalal", subject: "Round 2 with Luca, Tue 1:00 PM", body: INVITE },
    after: { send_invite: { steps: ["Rohan confirmed Tue 1:00 PM", "Interview booked on Luca's calendar"], status: "done" } },
  },
  { id: "t1a", person: "rohan", kind: "ask_interviewer", parent: "t1", interviewer: "luca", status: "done", needsYou: false, age: "2h", steps: steps(["Can do Tue 1:00 PM", "9:14"]) },
  { id: "t1b", person: "rohan", kind: "ask_interviewer", parent: "t1", interviewer: "kevin", status: "done", needsYou: false, age: "2h", steps: steps(["Can do Thu or Fri", "9:10"]) },
  { id: "t1c", person: "rohan", kind: "ask_interviewer", parent: "t1", interviewer: "ben", status: "cancelled", needsYou: false, age: "2h", steps: steps(["Away through Nov 24", "9:03"]) },

  {
    id: "t2", person: "noah", kind: "find_interviewer", step: "Round 2", status: "waiting", needsYou: true, age: "26h",
    waitingOn: { name: "Kevin", channel: "Slack" },
    steps: steps(["Asked Luca, Kevin and Ben", "Mon"], ["Luca is at his weekly limit", "Mon"], ["Ben is away through Nov 24", "Mon"], ["Nudged Kevin", "Tue"], ["No reply in a day", "10:40"]),
    after: { nudge: { steps: ["Kevin can do Thu 3:00 PM", "Picked Kevin"], status: "done" } },
  },
  { id: "t2a", person: "noah", kind: "ask_interviewer", parent: "t2", interviewer: "luca", status: "cancelled", needsYou: false, age: "26h", steps: steps(["At weekly limit", "Mon"]) },
  { id: "t2b", person: "noah", kind: "ask_interviewer", parent: "t2", interviewer: "kevin", status: "waiting", needsYou: false, age: "26h", waitingOn: { name: "Kevin", channel: "Slack" }, steps: steps(["Asked on Slack", "Mon"], ["Nudged", "Tue"]) },
  { id: "t2c", person: "noah", kind: "ask_interviewer", parent: "t2", interviewer: "ben", status: "cancelled", needsYou: false, age: "26h", steps: steps(["Away through Nov 24", "Mon"]) },

  {
    id: "t3", person: "daniel", kind: "send_testbench", step: "Take-Home", status: "waiting", needsYou: true, age: "2d",
    waitingOn: { name: "Daniel", channel: "Email" },
    steps: steps(["Sent the Testbench link", "Fri"], ["Due Sunday", "Fri"], ["Nothing submitted", "8:15"]),
    after: { nudge: { steps: ["Daniel replied: submitting Thursday"], status: "waiting", waitingOn: { name: "Daniel", channel: "Email" } } },
  },
  {
    id: "t4", person: "tom", kind: "send_rejection", status: "failed", needsYou: false, age: "4d",
    error: "Email is not connected for this sender",
    steps: steps(["Nick filed a no", "Nov 13"], ["Drafted the rejection", "Nov 13"], ["Send failed", "Nov 13"]),
    after: { retry: { steps: ["Rejection sent"], status: "done" } },
  },
  {
    id: "t5", person: "arjun", kind: "schedule_interview", step: "Recruiter Screen", status: "waiting", needsYou: false, age: "4d",
    waitingOn: { name: "Arjun", channel: "Email" },
    steps: steps(["Offered Mon 11:00 AM or Wed 2:00 PM", "Fri"], ["Followed up", "Mon"]),
    after: { nudge: { steps: ["Arjun picked Wed 2:00 PM", "Interview booked"], status: "done" } },
  },
  {
    id: "t6", person: "lena", kind: "get_read", step: "Onsite", status: "waiting", needsYou: false, age: "3h",
    waitingOn: { name: "Ben", channel: "Slack" },
    steps: steps(["Asked Ben how the onsite went", "11:40"]),
    after: { nudge: { steps: ["Ben filed a strong yes"], status: "done" } },
  },
  {
    id: "t7", person: "sofia", kind: "schedule_interview", step: "Round 3", status: "running", needsYou: false, age: "2m",
    steps: steps(["Ben and Luca both can", "10:20"], ["Picked Ben: on the hiring team", "10:20"], ["Checking Ben's calendar for Thu", "10:21"]),
  },
  {
    id: "t8", person: "maya", kind: "schedule_interview", step: "Onsite", status: "done", needsYou: false, age: "1d",
    steps: steps(["Asked Ben to host", "Mon"], ["Ben can do Thu 10:00 AM", "Mon"], ["Maya confirmed", "Mon"], ["Interview booked", "Mon"]),
  },
  { id: "t9", person: "rohan", kind: "get_read", step: "Recruiter Screen", status: "done", needsYou: false, age: "5d", steps: steps(["Asked Nick how it went", "Nov 12"], ["Nick filed a strong yes", "Nov 12"]) },
]

export const APPLICANTS: Applicant[] = [
  {
    id: "a1", name: "Priya Raman", role: "infra", origin: "referral", by: "luca", email: "priya.raman@ledgerline.example", phone: "+1 617 555 0142", linkedin: "linkedin.com/in/priyaraman", notes: "worked with her at lattice for 2 yrs. best on-call partner ive had, she should talk to us", note: "Ran Postgres at a 40-person fintech", time: "6m",
    suggestion: {
      status: "done",
      routes: [
        { role: "infra", matched: ["Production ownership", "Debugging under load"] },
        { role: "data", matched: ["Has done this job before"] },
        { role: "platform", matched: ["Self-direction"] },
      ],
      steps: ["Read the resume", "Compared against 14 open asks", "3 teams could pick her up"],
    },
  },
  {
    id: "a5", name: "Lucia Ortiz", role: "fde", origin: "referral", by: "ben", email: "lucia@halyard.example", linkedin: "linkedin.com/in/luciaortiz", notes: "met her at a customer onsite, she ran the whole integration herself", note: "Led onboarding for 30 enterprise accounts", time: "22m",
    suggestion: {
      status: "done",
      routes: [
        { role: "fde", matched: ["Ships in a customer's stack", "Customer presence"] },
        { role: "cs", matched: ["Has done this job before", "Writing"] },
      ],
      steps: ["Read the resume", "Compared against 14 open asks", "2 teams could pick her up"],
    },
  },
  {
    id: "a6", name: "Theo Marsh", role: "design", origin: "referral", by: "kevin", email: "theo@plotline.example", linkedin: "linkedin.com/in/theomarsh", notes: "his charting lib is what we use in the dashboard. worth a convo", note: "Design engineer, built a charting library", time: "1m",
    suggestion: { status: "running", routes: [], steps: ["Reading the resume"] },
  },
  {
    id: "a3", name: "Amara Nwosu", role: "design", origin: "job_board", email: "amara@tessellate.example", phone: "+44 20 7946 0331", linkedin: "linkedin.com/in/amaranwosu", note: "Shipped a data tool end to end", time: "3h",
    answers: [
      { q: "Why this role?", a: "I want to own design and the front end together, on a product people use all day." },
      { q: "Link to work", a: "amaranwosu.design" },
    ],
  },
  {
    id: "a7", name: "Hugo Lindberg", role: "infra", origin: "job_board", email: "hugo.lindberg@kvitto.example", linkedin: "linkedin.com/in/hugolindberg", testbench: { status: "invited", task: "Database On-Call", when: "5h ago" }, note: "SRE at a payments company, 4 years", time: "5h",
    answers: [
      { q: "Why this role?", a: "I have been the person on call for our databases and I want that to be the whole job." },
      { q: "Earliest start", a: "January" },
    ],
  },
  { id: "a2", name: "Jonas Weber", role: "fde", origin: "sourced", by: "nick", email: "jonas@fieldkit.example", linkedin: "linkedin.com/in/jonasweber", notes: "found via the testbench leaderboard", testbench: {
      status: "submitted", task: "Agent Integration", when: "2d ago", score: 92, percentile: "Top 3%", took: "1h 48m", agent: "Claude Code, Opus 5.5", minutes: 120,
      highlights: ["All 14 hidden tests pass", "Wrote his own eval harness before starting", "One retry bug left in the webhook handler"],
      parts: [
        { key: "A", name: "Core cases", bar: 7, cases: [{ name: "Creates a ticket from a webhook", pass: true }, { name: "Maps customer fields", pass: true }, { name: "Rejects a bad signature", pass: true }, { name: "Retries on a 5xx", pass: true }, { name: "Stops retrying after the limit", pass: true }, { name: "Deduplicates a repeated event", pass: true, hidden: true }, { name: "Handles an empty payload", pass: true, hidden: true }, { name: "Paginates a long sync", pass: true, hidden: true }, { name: "Reports a partial failure", pass: true, hidden: true }] },
        { key: "B", name: "Edge cases", bar: 3, cases: [{ name: "Clock skew on signatures", pass: true, hidden: true }, { name: "Out-of-order events", pass: true, hidden: true }, { name: "Rate limit back-off", pass: true, hidden: true }, { name: "Unicode in customer names", pass: true, hidden: true }, { name: "Concurrent syncs", pass: true, hidden: true }] },
      ],
      shape: { understanding: 9, time: 8, quality: 8 }, team: { understanding: 6, time: 6, quality: 7 },
      claims: { matched: 9, of: 10 },
      steps: [{ min: 0, passing: 0 }, { min: 14, passing: 2 }, { min: 31, passing: 5 }, { min: 52, passing: 9 }, { min: 78, passing: 12 }, { min: 101, passing: 14 }],
      pace: [{ min: 30, cases: 3 }, { min: 60, cases: 7 }, { min: 90, cases: 11 }],
      quality: [{ name: "Correctness", got: 3.6, of: 4 }, { name: "Structure", got: 2.2, of: 3 }, { name: "Tests", got: 1.6, of: 2 }, { name: "Readability", got: 0.6, of: 1 }],
      path: [
        { kind: "ask", text: "Read the PRD and list what the integration has to do before writing anything.", at: "2:10" },
        { kind: "do", text: "Build an eval harness that replays the sample webhooks.", test: "Public 2 of 6", at: "14:05" },
        { kind: "do", text: "Implement ticket creation and field mapping.", test: "Public 4 of 6", at: "31:20" },
        { kind: "limit", text: "Do not add a queue. Keep retries in process.", at: "44:02" },
        { kind: "do", text: "Add signature checks and retry with back-off.", test: "Public 6 of 6", testOn: true, at: "52:40" },
        { kind: "check", text: "Run the harness against out-of-order and duplicate events.", at: "78:15" },
        { kind: "do", text: "Fix deduplication for repeated event ids.", test: "Public 6 of 6", testOn: true, at: "101:30" },
        { kind: "end", text: "Submitted", test: "Final 14 of 14", testOn: true, at: "108:00" },
      ],
      recordings: [{ name: "Walkthrough", length: "4:12" }, { name: "Session", length: "1:48:00" }],
      activity: [{ at: "Nov 14", text: "Invited by Nick" }, { at: "Nov 16, 1:04 PM", text: "Started the test" }, { at: "Nov 16, 2:52 PM", text: "Submitted" }, { at: "Nov 16, 3:10 PM", text: "Readings graded" }],
    }, note: "Top 3% on the Testbench agent task", time: "40m" },
  { id: "a4", name: "Kenji Sato", role: "infra", origin: "sourced", by: "nick", email: "kenji@hikari.example", linkedin: "linkedin.com/in/kenjisato", testbench: {
      status: "submitted", task: "Database On-Call", when: "1d ago", score: 64, percentile: "Top 40%", took: "1h 58m", agent: "Cursor, Sonnet 5.5", minutes: 120,
      highlights: ["Core failover works", "Edge cases under a slow network fail", "Ran out of time before the schema-change case"],
      parts: [
        { key: "A", name: "Core cases", bar: 6, cases: [{ name: "Promotes a replica on primary loss", pass: true }, { name: "Fences the old primary", pass: true }, { name: "Keeps writes consistent during failover", pass: true }, { name: "Replays the WAL after restart", pass: true }, { name: "Handles a full disk", pass: false, hidden: true }, { name: "Throttles a runaway query", pass: true, hidden: true }, { name: "Reports lag accurately", pass: true, hidden: true }] },
        { key: "B", name: "Edge cases", bar: 3, cases: [{ name: "Split brain with a slow network", pass: false, hidden: true }, { name: "Clock drift between nodes", pass: false, hidden: true }, { name: "Failover during a schema change", pass: false, hidden: true }, { name: "Two replicas tied on lag", pass: true, hidden: true }, { name: "Recovery with a corrupt segment", pass: true, hidden: true }] },
      ],
      shape: { understanding: 7, time: 4, quality: 6 }, team: { understanding: 6, time: 6, quality: 7 },
      claims: { matched: 7, of: 10 },
      steps: [{ min: 0, passing: 0 }, { min: 26, passing: 1 }, { min: 58, passing: 3 }, { min: 84, passing: 5 }, { min: 110, passing: 8 }],
      pace: [{ min: 30, cases: 3 }, { min: 60, cases: 6 }, { min: 90, cases: 9 }],
      quality: [{ name: "Correctness", got: 2.4, of: 4 }, { name: "Structure", got: 2.1, of: 3 }, { name: "Tests", got: 1.0, of: 2 }, { name: "Readability", got: 0.5, of: 1 }],
      path: [
        { kind: "do", text: "Start on replica promotion straight away.", test: "Public 1 of 5", at: "26:10" },
        { kind: "ask", text: "Why does the old primary keep accepting writes?", at: "41:30" },
        { kind: "do", text: "Add fencing before promotion.", test: "Public 3 of 5", at: "58:05" },
        { kind: "do", text: "Replay the WAL on restart.", test: "Public 4 of 5", at: "84:40" },
        { kind: "check", text: "Test with a slow network between nodes.", at: "103:20" },
        { kind: "end", text: "Submitted", test: "Final 8 of 12", at: "118:00" },
      ],
      recordings: [{ name: "Walkthrough", length: "3:05" }, { name: "Session", length: "1:58:00" }],
      activity: [{ at: "Nov 15", text: "Invited by Nick" }, { at: "Nov 17, 10:02 AM", text: "Started the test" }, { at: "Nov 17, 12:00 PM", text: "Submitted" }, { at: "Nov 17, 12:20 PM", text: "Readings graded" }],
    }, note: "Maintains a storage engine", time: "2d" },
]

/* ---------------- Teams (departments) ---------------- */

export type Team = { id: string; name: string; color: string }
const EXTRA: [string, string, string, string][] = [
  ["platform", "Platform", "#4cb782", "Platform Engineer"],
  ["data", "Data", "#26a69a", "Data Engineer"],
  ["ml", "ML Research", "#8f7ee6", "Research Engineer"],
  ["security", "Security", "#eb5757", "Security Engineer"],
  ["mobile", "Mobile", "#5aa9e6", "iOS Engineer"],
  ["growth", "Growth", "#e0a23c", "Growth Engineer"],
  ["sales", "Sales", "#c2703d", "Account Executive"],
  ["cs", "Customer Success", "#d4628a", "Success Manager"],
  ["finance", "Finance", "#8a8a87", "Finance Lead"],
  ["peopleops", "People Ops", "#a35fc2", "Recruiter"],
  ["legal", "Legal", "#5e6ad2", "Commercial Counsel"],
]
export const TEAMS: Team[] = [
  { id: "infra", name: "Infrastructure", color: "#4ea7fc" },
  { id: "fde", name: "Forward Deployed", color: "#f2994a" },
  { id: "design", name: "Design", color: "#d16ad6" },
  ...EXTRA.map(([id, name, color]) => ({ id, name, color })),
]

/* The other teams get a small seeded pipeline so every team in the sidebar opens onto real rows */
const NAMES = [
  "Elena Petrova", "Marcus Hale", "Yuki Tanaka", "Omar Farouk", "Clara Jensen", "Diego Alvarez", "Hannah Schmidt", "Raj Patel",
  "Zoe Laurent", "Felix Braun", "Aisha Karim", "Leo Novak", "Mei Lin", "Samuel Adeyemi", "Nora Lindqvist", "Victor Costa",
  "Isla Murray", "Tariq Aziz", "Greta Olsen", "Paulo Ribeiro", "Chloe Bennett", "Andre Dubois",
]
const OWNERS = ["luca", "ines", "kevin", "nick"]

EXTRA.forEach(([id, , , title], i) => {
  const manager = OWNERS[i % OWNERS.length]
  const lead = OWNERS[(i + 1) % OWNERS.length]
  ROLES.push({
    id, team: id, title, manager, open: 1 + (i % 2), filled: 0,
    plan: ["Recruiter Screen", "Round 2", "Onsite"],
    scorecard: [attr("Has done this job before"), attr("Writing"), attr("Self-direction")],
  })
  const [a, b] = [NAMES[i * 2], NAMES[i * 2 + 1]]
  const first = (name: string) => name.split(" ")[0]
  const kind = i % 4
  PEOPLE.push({
    id: `${id}-a`, name: a, role: id, stage: 3, owner: lead, source: "Job board",
    next: ["Round 2, Wed 2:00 PM", "Book Round 2", "Send the Round 2 invite", "Find a Round 2 interviewer"][kind],
    due: kind === 3 ? "Yesterday" : undefined, stalled: kind === 3 ? "overdue" : undefined,
  })
  PEOPLE.push({ id: `${id}-b`, name: b, role: id, stage: 2, owner: manager, source: "Referral", next: "Recruiter Screen, Mon 11:00 AM" })

  const base = { person: `${id}-a`, step: "Round 2", needsYou: false, age: `${i + 1}h` }
  if (kind === 0) {
    TASKS.push({ ...base, id: `${id}-t`, kind: "schedule_interview", status: "done", steps: steps([`${STAFF[lead].first} can do Wed 2:00 PM`, "Mon"], [`${first(a)} confirmed`, "Mon"], ["Interview booked", "Mon"]) })
  } else if (kind === 1) {
    TASKS.push({ ...base, id: `${id}-t`, kind: "schedule_interview", status: "running", steps: steps([`Asked ${STAFF[lead].first}`, "9:40"], ["Checking calendars", "9:41"]) })
  } else if (kind === 2) {
    TASKS.push({
      ...base, id: `${id}-t`, kind: "send_invite", status: "waiting", needsYou: true,
      steps: steps([`${STAFF[lead].first} can do Wed 2:00 PM`, "Mon"], ["Drafted the invite", "Mon"]),
      draft: { to: a, subject: `Round 2 with ${STAFF[lead].first}, Wed 2:00 PM`, body: `Hi ${first(a)},\n\nWe'd like you to meet ${STAFF[lead].name} for a second round on Wednesday at 2:00 PM, 45 minutes on video.\n\nDoes that time work?\n\nNick` },
      after: { send_invite: { steps: [`${first(a)} confirmed Wed 2:00 PM`, "Interview booked"], status: "done" } },
    })
  } else {
    TASKS.push({
      ...base, id: `${id}-t`, kind: "find_interviewer", status: "waiting", needsYou: true, age: "30h",
      waitingOn: { name: "Kevin", channel: "Slack" },
      steps: steps(["Asked Luca and Kevin", "Mon"], ["Luca is at his weekly limit", "Mon"], ["No reply in a day", "9:10"]),
      after: { nudge: { steps: ["Kevin can do Thu 3:00 PM", "Picked Kevin"], status: "done" } },
    })
    TASKS.push({ ...base, id: `${id}-ta`, kind: "ask_interviewer", parent: `${id}-t`, interviewer: "luca", status: "cancelled", steps: steps(["At weekly limit", "Mon"]) })
    TASKS.push({ ...base, id: `${id}-tb`, kind: "ask_interviewer", parent: `${id}-t`, interviewer: "kevin", status: "waiting", waitingOn: { name: "Kevin", channel: "Slack" }, steps: steps(["Asked on Slack", "Mon"]) })
  }
})

const POST_COPY: Record<string, { about: string; doing: string[]; fit: string[] }> = {
  infra: {
    about: "Tacit runs on Postgres, and we need someone to own it. You will be the person who decides how our data layer grows, and the one we trust when it is under load.",
    doing: ["Own the Postgres fleet behind every customer workspace", "Make failover, upgrades and backups boring and rehearsed", "Write the runbooks and reviews the rest of the team learns from"],
    fit: ["You have owned a database or core service in production", "You stay calm and methodical when something is on fire", "You explain your decisions clearly in writing"],
  },
  fde: {
    about: "Forward deployed engineers sit with our customers and ship inside their stacks. You will be the reason a pilot becomes a rollout.",
    doing: ["Embed with a handful of customers and build what they need", "Run technical calls with engineers and executives", "Bring back what you learn so the product gets better for everyone"],
    fit: ["You have shipped inside someone else's codebase", "You are comfortable on a call with a CTO", "You start without waiting for a spec"],
  },
  design: {
    about: "We are looking for our first designer: someone who designs the product and builds the front end that ships.",
    doing: ["Design and build the core surfaces of the product", "Set the visual and interaction standards the team follows", "Work with engineers daily, in code"],
    fit: ["You ship the front end, not only the mock", "You have taste for dense, information-heavy tools", "You care about motion and the small details"],
  },
}

/* Every job gets an office, a hiring team and, for most, a public post */
ROLES.forEach((r, i) => {
  r.office = ["San Francisco", "New York", "Remote"][i % 3]
  r.team_members = [OWNERS[(i + 2) % OWNERS.length], "nick"].filter((id, n, all) => id !== r.manager && all.indexOf(id) === n)
  const copy = POST_COPY[r.id] ?? {
    about: `We are hiring a ${r.title} to join a small team that owns its work end to end.`,
    doing: ["Own projects from the first conversation to the shipped result", "Work directly with the people who depend on what you build", "Leave things clearer and better documented than you found them"],
    fit: r.scorecard.map((a) => a.note ?? a.name),
  }
  r.comp = ["$170,000 to $210,000", "$150,000 to $190,000", "$130,000 to $165,000"][i % 3]
  const lines: [Block["kind"], string][] = [["p", copy.about], ["h", "What you'll do"], ...copy.doing.map((t): [Block["kind"], string] => ["li", t]), ["h", "You might be a fit if"], ...copy.fit.map((t): [Block["kind"], string] => ["li", t])]
  const body = lines.map(([kind, text], n) => ({ id: `${r.id}-b${n}`, kind, text }))
  r.post = i % 5 === 4
    ? { status: "draft", applications: 0, views: 0, questions: ["Resume", "LinkedIn"], body }
    : { status: "live", applications: 9 + ((i * 7) % 23), views: 310 + ((i * 131) % 900), questions: ["Resume", "LinkedIn", "Why this role?"], body }
})
