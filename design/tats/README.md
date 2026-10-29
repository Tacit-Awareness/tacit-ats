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

The sidebar follows the funnel: Inbox, then **Top of Funnel** (Job Postings, Applicant Tickets, Analytics), then **Routing & Tracking** (Pipeline, Interviews, Calendar, Interviewers, Grokbot Activity). Each of the four daily pages has its own shape, so you can tell them apart before reading a row:

- **Inbox** (`#inbox`): an issue queue grouped Blocked, Your call, Updates. Each row leads with what happened, and the reader on the right has the fix or the decision. Open and Done tabs.
- **Applicant Tickets** (`#triage`): new, unrouted applicants one at a time. A queue strip on top ("2 of 6"), their whole application as one document, and the reply and routing bar below.
- **Pipeline** (`#all`): a board of every candidate by stage (New, Testbench, With Grokbots, Interview booked, Your call, Closed). A list layout and saved Views are in the header.
- **Interviews** (`#interviews`): feedback and sentiment. A bar of how interviews went, the list grouped Pass, Mixed, Fail, Read pending, and a reader with the interviewer's read, the Granola summary, every question and answer, and the transcript. Check each one off.
- **Grokbot Activity** (`#activity`): "Needs you" first (only failed or stuck tasks, each with its fix), then a searchable log.
- **Job Postings** and **Analytics**: the careers page as applicants see it (see `design/careers`), and how postings perform.
- The sidebar resizes by dragging its edge and collapses with `[`. Routing rules live in Settings.
