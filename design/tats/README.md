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

- **Inbox** (`#inbox`): only updates and decisions. Open and Done tabs; the first item opens on its own. A decision has its read card (the interviewer's words, a transcript summary and the questions asked) and the next step, such as picking the next round's interviewer.
- **Applicant Tickets** (`#triage`): new applicants, each opened as one document (resume, research statement, anything else they sent) with the Testbench result as `84/100`.
- **Pipeline** (`#all`): every applicant in a Linear-style list, grouped by who has the next move (you, the Grokbots, booked, closed). Hover a row for a profile card.
- **Interviews** (`#interviews`): a list to check off. Each interview shows the interviewer's read after the call, the Granola summary, every question and answer in order, and the full transcript (from the Granola icon).
- **Views** (`#views`): Calendar, Interviewers and Grokbot Activity, plus saved Pipeline filters you can pin to the sidebar.
- **Grokbot Activity** (`#activity`): "Needs you" first (only failed or stuck tasks, each with its fix), then a searchable log of what every Grokbot did.
- **External Facing**: Job Postings (styled like the careers page, see `design/careers`) and Analytics.
- The sidebar resizes by dragging its edge and collapses with `[`. Routing rules live in Settings.
