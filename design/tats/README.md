# tATS prototype

A design shell for the client side of tATS: the place a client's hiring team checks where every applicant stands, reads interviews, and steps in only when something needs them. Grokbots (one per interviewer, working as that interviewer's assistant) do the asking, scheduling and chasing. It is a single static page with no backend. Nothing here is wired to `apps/web` yet.

Meridian is the example client. Every applicant, interviewer, run and transcript is placeholder data.

## Run it

```bash
python3 -m http.server 4480 --directory design/tats
```

Then open http://localhost:4480. GSAP, Flip and morphdom load from public CDNs, so it needs a network connection.

To change it, edit `src/` and run `python3 design/tats/build.py`, which inlines `src/` into `index.html`.

## What's in it

The sidebar follows the funnel: Home, Inbox and CRM, then **Top of Funnel** (Job Postings, Applicant Tickets, Analytics), then **Routing & Tracking** (Pipeline, Interviews, Calendar, Interviewers, Grokbot Activity). Each of the four daily pages has its own shape, so you can tell them apart before reading a row:

No summary rows or banners: every page opens straight on its content. Color is grey except one accent for the primary action, red for what's broken, and the three interview verdicts. Rows and cards carry no buttons; a reader has one action, and anything else goes to the Grokbot through "Ask your Grokbot" or ⌘K, where open issues show up as one-line commands.

- **Home** (`#home`, the default): Recruiting Overview, built around "where are candidates getting stuck?". Filters for period, team and role.
  - KPI row: New applications (daily, against the period before), Candidates in process (by stage; opens the CRM filtered to active), Time to review applications, Time to schedule, Time to submit interviewer feedback (each a chart of how long open items have waited), and Interview workload (team hours booked or awaiting feedback, by team). Workload carries a dashed "Estimate" callout for Testbench replacing first-round live technicals (30 to 60 minutes each), kept apart from actual hours. Targets are user-set; none are assumed.
  - "Where are candidates getting stuck?": Bottlenecks beside Time in stage. Stages use the company's interview process, set and renamed in Settings.
  - Secondary grid: Time to submit by interviewer, Interview efficiency (round pass-through, interviews and interviewer hours per hire, from closed applications), Outstanding feedback. Interview outcomes and Offer approvals are left out until confirmed.
  - Compare styles (`#compare`): the same layout in the current styling and in the previous palette with refined shading, side by side; either can be applied everywhere (`?pal=prev` also works).
- **Inbox** (`#inbox`): an operational action queue, not an applicant list. Issues are grouped Bot failures (a Grokbot step broke), Unsent invites (drafted in an interviewer's Gmail, not sent), Overdue replies (an interviewer's read or a candidate's Testbench), and Decisions. Each row says what's wrong and who it's about (bot, interviewer or candidate). Every action is a letter, like Superhuman: F runs the fix, E dismisses, / asks the Grokbot, Enter opens the ticket, J/K move, and A/O/R decide; the buttons show their keys on the hovered row and in the reader. Resolved and dismissed issues go to Done.
- **Applicant Tickets** (`#triage`): new, unrouted applicants in an email-style list; the reader shows their whole application as one document, with the reply and routing bar below (Interview, Testbench, Decline glow as the next move).
- **CRM** (`#crm`): one database of every candidate: those in process and everyone the funnel closed, hired or not. A table (candidate, role, profile, owner, Testbench, outcome, last contact) with views for All, In process, Hired, Silver medalists, Rejected and Withdrew, sortable columns, 50 per page, and search. "Ask Grokbot for a list" takes plain words ("silver medalists on infra, Testbench over 85") or the selected rows and shows the Slack post its Grokbot will send, channel included.
- **Pipeline** (`#all`): every open application, as a board by stage (New, Testbench, With Grokbots, Interview booked, Your call); columns show 12 and "Show all", the list layout shows 25 per group. Search says how many past candidates in the CRM also match. A returning candidate is labelled "Applied before" and their ticket lists past applications.
- **Scale test data**: about 260 generated active applicants and 2,400 past applications (seeded, the same on every load). They live only in Pipeline and the CRM, so the Inbox, Tickets and Interviews keep the hand-written examples.
- **Interviews** (`#interviews`): feedback and sentiment. A bar of how interviews went, the list grouped Pass, Mixed, Fail, Read pending, and a reader that opens with the candidate's loop as a tree (the candidate, each round by team, and who ran it with their verdict; the current round is highlighted and rounds still to come are faded), then the interviewer's read, the Granola summary, every question and answer, and the transcript. Check each one off.
- **Referrals** (`#referrals`): every referral (open and closed) with who referred them and where they are now, plus top referrers by hires. "Add referral" opens a form that creates an Applicant Ticket sourced to the referrer; "Add with Grokbot" takes a pasted Slack message, email or link and fills the form. Typing "refer …" in ⌘K or the chat does the same.
- **Grokbot Activity** (`#activity`): "Needs you" first (only failed or stuck tasks, each with its fix), then a searchable log.
- **Job Postings** and **Analytics**: the careers page as applicants see it (see `design/careers`), and how postings perform.
- **Chat with your Grokbot** (`#chat`, the button at the bottom of the sidebar): the same DM as in Slack. tATS is Slack-native; this dashboard is for checking in and delegating. The Grokbot answers "what needs me", "who owes a scorecard", "nudge Daniel", "send the invite", "silver medalists on infra" and referrals, with Slack-style buttons.
- **Tutorial** (bottom of the sidebar): a twelve-step walkthrough that moves across the pages, spotlighting each part and shading the rest. Arrow keys or Next/Back; Esc ends it.
- The sidebar resizes by dragging its edge and collapses with `[`. Routing rules live in Settings.
