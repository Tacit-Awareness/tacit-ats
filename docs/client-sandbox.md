# The client sandbox: Tacit Test Co

A permanent test company in production, set up like a real client, so any
change to the client side can be tried end to end once it is live. Everything
here is production: one database, and the notify cron and reminder timers run
only on production deploys. It tests a change after it merges; the automated
tests are what run on a PR.

| | |
| --- | --- |
| Company | **Tacit Test Co**, created 2026-10-28 with the staff connector's `recruit_company` (company id `fc931289-fbe4-4165-9b7d-2f972f104139`) |
| Admin | Ryan Huang, ryan@tacitawareness.com (the same person as his Tacit staff actor, a separate actor in this org) |
| Organizer's calendar | Ryan's Google Calendar, connected in Settings |
| Candidate address | rhuang53jp@gmail.com (Google sends it real invites) |
| The company's bot | Ryan's Grok bot, installed in a test Slack workspace, set in Settings > Your team's bot |

Treat it as a real client's workspace: it shows in ATS Admin's company list,
and its interviews are real events on Ryan's calendar.

## One-time setup (done by the admin, signed in)

1. Accept the WorkOS invitation and sign in at https://ats.tacitawareness.com.
   If AuthKit asks which organization, choose Tacit Test Co.
2. **Settings**: connect Google Calendar.
3. Create a job (in the client area or with the client connector's
   `create_job`) and add rhuang53jp@gmail.com as a candidate.
4. **Settings > Your team's bot**: the Grok routine's webhook URL and, as
   **Your bot's key**, the key from the routine's webhook panel (the Bearer key
   Grok checks). Save, then **Verify**: a success answer from Grok verifies it.
   (The routine's instruction and the steps: the client docs page "Set up a
   Grok bot in Slack"; the contract: "Your team's bot".)
5. In Claude, connect the client connector (https://ats-mcp.tacitawareness.com/api/client)
   and sign in as Tacit Test Co, so Claude can book and move interviews as the admin.

## Mock data

`scripts/seed-test-co/` fills the company with design/tats's Meridian cast:
ten teammates who never sign in (Priya the talent engineer, Daniel, Sam, ...),
six jobs in three departments with hiring teams, interview plans and job
board posts, and 43 fictional candidates across every stage. That includes 12
unrouted job board applicants for New Applicants, with their answers, and
past interviews with feedback, so Pipeline's Your call column and Interviews
have something to show. Emails are `@example.com`. It makes no upcoming
interviews, because the company's bot is real and would get a reminder for
each one.

```bash
pnpm seed:test-co --env-file=<tacit-internal checkout>/.env            # add what is missing
pnpm seed:test-co --env-file=<tacit-internal checkout>/.env --reset    # remove, then seed again with times relative to now
pnpm seed:test-co --env-file=<tacit-internal checkout>/.env --remove   # take it all out
```

The env file needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (production's).
Every row's id comes from a fixed key, so `--remove` deletes only the seed's
rows, plus anything since added to its applications (routing events,
interviews, feedback). The script refuses to run against any other org.

## The interview notifications run

About 30 minutes. Times are from the booking; the cron runs every two minutes.

| Step | How | Expected |
|---|---|---|
| Book | `schedule_interview` for the candidate, start 8+ minutes out, you as interviewer | Event on your calendar; a reminder timer starts on the next cron run |
| Reminder | wait | The bot gets `interview.reminder_t5m` within ~2 seconds of T-5, and posts its hello |
| Move in Tacit | `update_interview` to a new time before T-5 | No reminder at the old time; one at the new T-5 |
| Move in Google | drag a booked interview in Google Calendar (by hand) | The interview's time in Tacit follows within 2 minutes; reminder at the new T-5 |
| Check-in | let an interview end, don't file feedback | `interview.finished` about 5 minutes after the end, in the reminder's thread |
| Cancel | delete an interview in Google Calendar, or `update_interview` to cancel | The interview is cancelled in Tacit; `interview.cancelled` in its thread |

## Where to look when something does not arrive

- **The cron's own answer**: Vercel, project `web`, logs for `/api/cron/notify`
  (`vercel logs --environment production --query /api/cron/notify --project web --scope tacit-d9033b91`).
  The JSON lists each company it ran for, with what the calendar sync moved,
  which timers it started, what it published and what it delivered.
  No row for Tacit Test Co means its bot is not enabled and verified.
- **The timers**: the Vercel dashboard's Workflows tab for project `web`; each
  run logs `[reminder timer] org <id> interview <id> at <start>: <outcome>`
  (`reminded`, `stale` for a timer left from a move, `moved_in_google`,
  `cancelled_in_google`, `started`, `no_bot`).
- **The bot itself**: if Tacit delivered (`sent` in the cron's answer) and
  nothing appeared in Slack, the problem is on the bot's side.

## Trying the new client pages

The pages ported from design/tats (2026-10-29) have not been used by a signed-in
person yet. Walk through them on https://ats.tacitawareness.com once they are
deployed, about 15 minutes. You need three sign-ins to see every role: Ryan as
**Admin**, plus a **Hiring team** member (the access levels on Interviewers' invite
form; give them one job) and an **Interviewer**, both invited from Interviewers
to addresses you can read. The sidebar shows the level under the member's name. Set up first: at
least two open jobs, a few candidates spread across stages (add them from a
job's board, or use the client connector), one interview booked with a second
person as interviewer, and one application from a public job post
(`/jobs/<slug>`, or find it on the board at `/careers/<org slug>`) so Applicant
Tickets has something in it.

Roles in short: **Admin** and **Hiring team** see the pages below; a Hiring
team member sees only the jobs they are on. An **Interviewer** (limited) gets
a pointer back to Home on Pipeline, CRM and New Applicants, because their
token cannot read applications.

### Home: the Recruiting Overview (`/client`)

- [ ] Admin: cards for new applications (against the period before),
  candidates in process by column, waiting for review, waiting to be
  scheduled, interviewer feedback on time and workload by interviewer.
- [ ] Switch the period (7 / 30 / 90 days) and a job tab; the numbers and the
  URL (`?days=`, `?job=`) change together.
- [ ] Bottlenecks: open a row, check it lists the longest waits and that a
  name opens the candidate page. Time in stage and the average stay per stage
  sit beside it.
- [ ] Hiring team: the numbers count only their job. The feedback card is
  there only if they manage a job, and with a job picked it says "every job
  you manage".
- [ ] Interviewer: not the overview, but the older Home: the people they
  interview, the jobs they can see, the team.
- Left out on purpose: Testbench, targets and alerts, interview efficiency
  (pass rates, interviews per hire), the team filter, "Compare styles".

### CRM and the candidate page (`/client/candidates`)

- [ ] Admin: one table of every candidate. Try the view tabs (All, In process,
  Hired, Rejected, Withdrew; counts can add up past All because a candidate
  is in each view one of their applications puts them in), the search (name,
  email, headline, job title), sorting by a column and paging at 50.
- [ ] A candidate in no job shows as Prospect. The footer says so if the
  table stopped short of everyone.
- [ ] Open a row: the candidate page shows each job with stage, source,
  owner and next action (red when overdue), the profile summary, contact,
  tags, pools, file names and the activity feed, newest first.
- [ ] A made-up id (`/client/candidates/00000000-0000-0000-0000-000000000000`)
  is a 404, the same as a candidate you cannot see.
- [ ] Hiring team: only candidates on their job. Interviewer: the CRM points
  home; the candidate page, opened from Interviews, shows just the card, the
  resume, their own notes and interviews.
- Left out: a Silver medalists view (no rule for it yet), file downloads
  (names only), the Grokbot "court", Testbench and sentiment. Nothing here
  edits a candidate.

### New Applicants (`/client/applicants`) (this one moves stages)

- [ ] Admin: new job-board applicants (source job board, still at the first
  stage) grouped by job, newest first. Open one: name, email and phone, every
  answer, resume and LinkedIn as links only if they are http(s) URLs, and the
  source.
- [ ] Below it the routing bar: **Interview**, **Move to screening**,
  **Decline**. Decline needs a rejection reason from the list. Each moves the
  application's stage and opens the next ticket; check the candidate's
  activity feed shows the move.
- [ ] Open the same ticket in two tabs, route it in one, then in the other:
  the second does not move it twice.
- [ ] Hiring team: only their job's applicants, and the routing bar only
  where they can edit that job's pipeline. Interviewer: pointed home.
- [ ] Reply (R): needs `RESEND_API_KEY` and `CLIENT_EMAIL_FROM` on the web
  project; without them the box says email isn't set up and Reply is off.
  Write to yourself: Review draft sends nothing and shows the stored draft;
  Send delivers it once, the ticket stays open and says who emailed. Change it
  writes a new draft, and only the newest reaches the Inbox.
- [ ] A reply: needs `CLIENT_EMAIL_REPLY_DOMAIN` on both projects. Send to the
  candidate address, reply from that mailbox: within a minute it is under
  Replies in the Inbox and forwarded to your own mail, and the candidate's
  activity says they replied. Write to them again and it leaves the queue.

### Pipeline (`/client/pipeline`)

- [ ] Admin: every open job's live applications on one board. The columns are
  computed: New, Screening, Scheduling (interviewing, nothing booked),
  Interview booked, Your call (interviews held, nothing booked next), Offer.
  Hired, rejected and withdrawn are not on it. Move one candidate to match
  (book an interview, let it pass) and see its card change column.
- [ ] Job tabs, the name filter, and "Show all" on a column over a dozen cards.
- [ ] A card: the person, the job, one status line in relative times
  ("Interview in 2d"), red when stalled, and the owner. The name opens the
  candidate page.
- [ ] Hiring team: only their job's cards. Interviewer: pointed home.
- Left out: moving cards (it is read-only; edit on a job's own board,
  `/client/jobs/<id>`).

### Interviews (`/client/interviews`)

- [ ] Admin: a list grouped as Upcoming, then past interviews by verdict
  (Pass, Fail, Mixed, Read pending) from the feedback you may read. Cancelled
  interviews are not listed.
- [ ] Pick one: the candidate's loop (planned rounds, then off-plan ones; this
  round highlighted, later ones faded) with who ran each and Filed / Not
  filed / Not visible to you, then this interview's feedback: recommendation,
  rating, scorecard and notes.
- [ ] File feedback as the second person, then reload as Admin: the verdict
  changes from Read pending.
- [ ] Hiring team: interviews on their job; whether others' feedback shows
  follows the org's feedback visibility, and a line says when some is hidden.
- [ ] Interviewer: only the interviews they sit on, with only their own
  feedback.
- [ ] As an interviewer with Granola connected, on an interview you sat on
  that has started: **Your Granola notes** fills in after the rest of the page,
  says how it matched, and **Show the transcript** adds the transcript (or says
  it needs a paid plan). The rest of the reader never waits on it.
- [ ] Not connected: a line pointing at Settings. No match: the meetings
  around then, each with **Use this one**.
- [ ] As Admin on an interview you did not sit on: no Granola section at all.
