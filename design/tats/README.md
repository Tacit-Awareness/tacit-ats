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

The sidebar follows the funnel: Inbox and CRM, then **Top of Funnel** (Job Postings, Applicant Tickets, Analytics), then **Routing & Tracking** (Pipeline, Interviews, Calendar, Interviewers, Grokbot Activity). Each of the four daily pages has its own shape, so you can tell them apart before reading a row:

No summary rows or banners: every page opens straight on its content. Color is grey except one accent for the primary action, red for what's broken, and the three interview verdicts. Rows and cards carry no buttons; a reader has one action, and anything else goes to the Grokbot through "Ask your Grokbot" or ⌘K, where open issues show up as one-line commands.

- **Inbox** (`#inbox`): an operational action queue, not an applicant list. Issues are grouped Bot failures (a Grokbot step broke), Unsent invites (drafted in an interviewer's Gmail, not sent), Overdue replies (an interviewer's read or a candidate's Testbench), and Decisions. Each row says what's wrong, who it's about (bot, interviewer or candidate) and has its one action button; resolved and dismissed issues go to Done.
- **Applicant Tickets** (`#triage`): new, unrouted applicants one at a time. A queue strip on top ("2 of 6"), their whole application as one document, and the reply and routing bar below.
- **CRM** (`#crm`): one database of everyone the funnel closed, hired or not, about 2,400 records. A table (candidate, role, profile, owner, Testbench, outcome, last contact) with views for All, Hired, Silver medalists, Rejected and Withdrew, sortable columns, 50 per page, and search. "Ask Grokbot for a list" takes plain words ("silver medalists on infra, Testbench over 85") or the selected rows and shows the Slack post its Grokbot will send, channel included.
- **Pipeline** (`#all`): every open application, as a board by stage (New, Testbench, With Grokbots, Interview booked, Your call); columns show 12 and "Show all", the list layout shows 25 per group. Search says how many past candidates in the CRM also match. A returning candidate is labelled "Applied before" and their ticket lists past applications.
- **Scale test data**: about 260 generated active applicants and 2,400 past applications (seeded, the same on every load). They live only in Pipeline and the CRM, so the Inbox, Tickets and Interviews keep the hand-written examples.
- **Interviews** (`#interviews`): feedback and sentiment. A bar of how interviews went, the list grouped Pass, Mixed, Fail, Read pending, and a reader that opens with the candidate's loop as a tree (the candidate, each round by team, and who ran it with their verdict; the current round is highlighted and rounds still to come are faded), then the interviewer's read, the Granola summary, every question and answer, and the transcript. Check each one off.
- **Grokbot Activity** (`#activity`): "Needs you" first (only failed or stuck tasks, each with its fix), then a searchable log.
- **Job Postings** and **Analytics**: the careers page as applicants see it (see `design/careers`), and how postings perform.
- The sidebar resizes by dragging its edge and collapses with `[`. Routing rules live in Settings.
