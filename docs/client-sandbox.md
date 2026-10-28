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
| Organizer's calendar | Ryan's Google Calendar, connected on Integrations |
| Candidate address | rhuang53jp@gmail.com (Google sends it real invites) |
| The company's bot | Ryan's Grok bot, installed in a test Slack workspace, set on Integrations > Your team's bot |

Treat it as a real client's workspace: it shows in ATS Admin's company list,
and its interviews are real events on Ryan's calendar.

## One-time setup (done by the admin, signed in)

1. Accept the WorkOS invitation and sign in at https://ats.tacitawareness.com.
   If AuthKit asks which organization, choose Tacit Test Co.
2. **Integrations**: connect Google Calendar.
3. Create a job (in the client area or with the client connector's
   `create_job`) and add rhuang53jp@gmail.com as a candidate.
4. **Integrations > Your team's bot**: the Grok routine's webhook URL and, as
   **Your bot's key**, the key from the routine's webhook panel (the Bearer key
   Grok checks). Save, then **Verify**: a success answer from Grok verifies it.
   (The routine's instruction and the steps: the client docs page "Set up a
   Grok bot in Slack"; the contract: "Your team's bot".)
5. In Claude, connect the client connector (https://ats-mcp.tacitawareness.com/api/client)
   and sign in as Tacit Test Co, so Claude can book and move interviews as the admin.

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
