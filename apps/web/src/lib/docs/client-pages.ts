import type { DocPage } from "./types";

/**
 * The client connector's documentation (apps/mcp's /api/client): what a
 * member of a client company reads at /client/docs. tacit-internal's staff
 * /docs shows a copy of these pages; this file is the source. Pages here link
 * only to each other (docs.test.ts checks).
 *
 * Every tool name, limit and value list below is from apps/mcp's
 * src/client/server.ts and @tacit-ats/core's clientTools; docs.test.ts fails
 * when a tool is added there and not named here, or named here and gone there.
 */

export const CLIENT_CONNECTOR_URL = "https://ats-mcp.tacitawareness.com/api/client";

export const CLIENT_DOCS: DocPage[] = [
  {
    slug: "connect",
    title: "Connect Tacit to Claude",
    category: "Get started",
    description: "Add your company's Tacit workspace to Claude and sign in.",
    body: `The Tacit connector lets you work your company's hiring in Claude. You can ask about jobs and candidates, move people through a pipeline, email candidates, schedule interviews, file feedback and draft offers. Claude acts as you, so it can see and change only what your access in Tacit allows.

## Before you start

You need an invitation to your company's Tacit workspace. An admin at your company sends it from Tacit, and it arrives as an email from WorkOS, our sign-in provider. Sign in once from that email so your account exists. If you have no invitation, ask an admin to [invite you](/docs/admin).

## Add the connector in Claude

1. In Claude, open **Settings → Connectors** and choose **Add custom connector**.
2. Name it **Tacit** and paste this URL:

\`\`\`text
${CLIENT_CONNECTOR_URL}
\`\`\`

3. Choose **Connect**. A Tacit sign-in page opens; sign in with the email you were invited at.
4. Back in Claude, the Tacit tools appear under the connector. Turn it on in a chat from the tools menu.

On a Team or Enterprise plan, an owner may need to add the connector for the organization first. It then shows up for you to connect.

### Claude Code

\`\`\`sh
claude mcp add --transport http tacit ${CLIENT_CONNECTOR_URL}
\`\`\`

Then run \`/mcp\` in Claude Code, choose **tacit** and sign in in the browser it opens.

## Check it works

Ask Claude:

> Who am I in Tacit?

Claude calls \`whoami\` and answers with your company, your name, your access level and the jobs you can see. Start every new chat this way if you are unsure what you can do.

## If sign-in is refused

| What you see | What it means |
| --- | --- |
| You are not a member of this workspace | Your email has not been invited, or the invitation was withdrawn. Ask an admin. |
| Sign in again choosing the company | You belong to more than one company in Tacit. Disconnect, reconnect and pick the company during sign-in. |
| Claude asks you to reconnect | Your sign-in expired. Choose **Connect** again. |

## Disconnect

Remove the connector in **Settings → Connectors**. That stops Claude from acting for you. It changes nothing in Tacit, and your account stays as it is.`,
  },
  {
    slug: "access",
    title: "Access levels",
    category: "Get started",
    description: "What interviewers, hiring teams and admins can see and change.",
    body: `Everyone at your company has one of three access levels. Claude works through your own sign-in, so the level decides what every tool returns. Nothing is filtered by Claude; Tacit itself refuses what you may not see.

## The three levels

| Level | Sees | Can change |
| --- | --- | --- |
| **Interviewer** | Their own interviews, and a short card on each candidate they interview: name, headline, LinkedIn, resume, and their own notes. No pipelines, no tags. | Their own feedback and notes on the people they interview. |
| **Hiring team** | The jobs they are on through a hiring team, those jobs' pipelines and candidates. | What their team role on each job allows (below). |
| **Admin** | Every job, the whole team, pending invitations. | Everything, including jobs, hiring teams, access levels and invitations. |

A job marked confidential is visible only to the people on it, and to admins who have been given confidential access.

## Team roles on a job

The hiring team decides who works each job. A person can hold more than one role on a job.

| Team role | Gives |
| --- | --- |
| \`hiring_manager\`, \`recruiter\` | Manage the job and its pipeline: add candidates, move stages, schedule interviews, draft offers, set the interview plan and scorecard. |
| \`coordinator\`, \`sourcer\` | See the job's candidates and read feedback. |
| \`interviewer\` | Nothing beyond their own interviews. |

Someone at interviewer access who is given a managing role becomes hiring team. Lowering a level later does not remove them from teams; it just stops the team role from granting anything.

## Feedback visibility

Your company has one setting for when interviewers can read each other's feedback:

- **always**: as soon as it is filed;
- **after submit** (the default): once you have filed your own for every interview of that candidate you are on;
- **never**: admins only.

\`get_feedback\` and \`get_interview_plan\` follow it. An interview whose feedback is hidden from you shows as hidden, not missing.`,
  },
  {
    slug: "pipeline",
    title: "Candidates & pipeline",
    category: "Working with candidates",
    description: "Find candidates, add them to jobs and move them through stages.",
    body: `A **job** has a **pipeline**: each candidate in it is an **application** with a stage, an owner and a next action. One person can be in several jobs, with a separate application in each.

## Find what you need

| Ask | Tool |
| --- | --- |
| "What jobs can I see?" | \`list_jobs\` (narrow with a status such as \`open\`) |
| "Where does the Backend Engineer search stand?" | \`get_pipeline\` |
| "Find Priya Shah" / "who from Stripe is in our pipeline?" | \`search_candidates\` |
| "Tell me about Priya" | \`get_candidate\` |
| "Who is on our team?" | \`list_team\` |

\`search_candidates\` matches name, email, company or title, and can be narrowed to one job or one tag. It returns the \`candidate_id\` and each application with its \`application_id\` and stage. When you give Claude only a name, it searches first and uses those ids; if several people match, it asks which one.

\`get_candidate\` returns the profile, tags, every job they are in (stage, how they came in, next action, why they closed, the latest offer if you manage that job), the team's notes and their files.

\`get_pipeline\` lists a job's candidates by stage and flags the ones that **need attention**: no contact for a week, or a next action past its date. Interviewers cannot read pipelines.

## Stages

\`sourced\` → \`contacted\` → \`screening\` → \`interviewing\` → \`offer\` → \`hired\`, plus \`rejected\` and \`withdrawn\`, which close an application.

## Add a candidate

> Add Priya Shah (priya@example.com) to the Backend Engineer job. She was referred by Sam.

\`add_candidate\` puts someone in a job at \`sourced\`. With an email, a person already in your company's records under that address is reused rather than duplicated, and someone already in the job is left where they are. Say how they came in and Claude records it as the source:

| Source | |
| --- | --- |
| \`sourced\` | The default: your team found them. |
| \`applicant\`, \`referral\`, \`agency\`, \`job_board\`, \`event\`, \`suggested\`, \`other\` | With an optional detail: which referrer, agency, board or event. |

Adding, moving and setting next actions need the right to edit the job's pipeline: admins, and the job's hiring managers and recruiters.

## Move a stage

> Move Priya to interviewing.

\`update_stage\` moves one application. Claude tells you the change and waits for your yes before calling it. It passes the stage it last saw, so if a teammate moved the candidate in the meantime, nothing changes and you get the current stage back.

Moving to \`rejected\` or \`withdrawn\` needs a reason from your company's list ([Offers & closing](/docs/offers)) and takes an optional note.

## Next actions and notes

- \`set_next_action\` records what happens next on an application, with an optional due date (YYYY-MM-DD). It replaces the one there; clear it by saying so. A next action past its date makes the card need attention.
- \`add_note\` adds a note on a candidate that your team can read. Interviewers can note the people they interview. Notes cannot be edited or deleted through Claude.`,
  },
  {
    slug: "activity-tags",
    title: "History & tags",
    category: "Working with candidates",
    description: "Read a candidate's history and organize people with tags.",
    body: `## A candidate's history

> What has happened with Priya so far?

\`get_activity\` returns one candidate's history, newest first (30 entries unless you ask for more): when they were added to each job and how, stage moves and why they closed, owner and next-action changes, notes, interviews scheduled, done or cancelled, offers drafted, extended and closed (status only), and tags. Each entry says who did it.

Only what you can read appears. An interviewer gets their own notes and the interviews they are on.

## Tags

Tags are your company's own labels, such as *Strong systems*, *Re-engage in Q3* or *Boston*. They are shared by the whole team.

| Ask | Tool |
| --- | --- |
| "What tags do we have?" | \`list_tags\`: each tag with how many of the candidates you can see carry it. Archived tags on request. |
| "Make a tag called Re-engage" | \`create_tag\`: at most 60 characters. A tag that already exists under that name, ignoring case, is returned instead of duplicated. |
| "Tag Priya with Strong systems" | \`tag_candidate\`: by name or id. Tagging twice changes nothing. |
| "Take the Boston tag off Priya" | \`untag_candidate\`: Claude confirms first. |
| "Archive the Q2 tag" | \`archive_tag\`: admins only, confirmed first. The tag stays on the people who have it and goes on no one new. Creating it again brings it back. |

\`search_candidates\` takes a tag, so "everyone tagged Strong systems in the Backend job" is one request.

Anyone who can add candidates can create tags. Changing a candidate's tags needs the right to change that candidate. Interviewers see no tags.`,
  },
  {
    slug: "files",
    title: "Resumes & attachments",
    category: "Working with candidates",
    description: "Attach resumes and files to a candidate and download them.",
    body: `Each candidate can have resumes and other attachments, such as a portfolio, a work sample or a reference letter.

## List and download

> Show me Priya's files.

\`list_files\` returns a candidate's files, newest first: each with its kind (\`resume\` or \`attachment\`), filename, type, size, who added it and when. \`get_candidate\` lists them too.

> Give me a link to her resume.

\`get_file_link\` returns a download link for one file. **The link expires five minutes after it is made**, and anyone holding it can download the file until then, so open it straight away and do not paste it anywhere else. Ask again for a fresh one.

An interviewer sees only the resume of someone they interview.

## Attach a file

> Attach this PDF to Priya as her resume.

\`add_file\` attaches a file you give Claude. What Tacit accepts:

| | |
| --- | --- |
| Kind | \`resume\` or \`attachment\` |
| Types | PDF, Word (.doc, .docx), plain text, PNG, JPEG |
| Size | 3 MB at most |
| Filename | Letters, digits, spaces and \`. _ - ( ) & , + '\`, ending in the type's extension |

The file's contents must match its type: a PNG renamed to .pdf is refused. Whoever can edit the candidate can add files (their hiring team or an admin), never an interviewer.

Files cannot be replaced or deleted through Claude. To correct one, add the right file; the newest is listed first.`,
  },
  {
    slug: "email",
    title: "Email to candidates",
    category: "Working with candidates",
    description: "Draft and send email to candidates, from your company's templates or from scratch.",
    body: `You can email a candidate from Claude. **It is always two steps**: Claude writes a draft and shows it to you in full, and sends it only after you say yes.

## Draft, then send

> Email Priya to set up a call next week, using our intro template.

1. \`draft_email\` writes a draft to a candidate and sends nothing. It starts from a template (by name or id), or from a subject and body Claude writes from what you asked for; given both, yours replace the template's. Tie it to one of their jobs to fill in the job title. Claude shows you who it goes to, the subject and the whole body exactly as saved. To change anything, it drafts again.
2. \`send_email\` sends that draft, exactly as drafted, once you say yes. Only the person who drafted it can send it, and only once.

The email goes to the candidate's address on file, or to another address on file for them if you name it; Claude cannot type in an address. It comes **from your name at your company** on a Tacit sending address, and **replies come to your own email**.

Drafting and sending need the right to change the candidate. Interviewers cannot email candidates.

## What never goes in an email

Interview feedback, scorecard ratings, offer terms and private notes. Claude leaves them out of every draft; read the draft before you say yes all the same.

## Templates

Templates are your company's reusable emails, shared by the team.

| Tool | |
| --- | --- |
| \`list_email_templates\` | Each template with its subject and body. Archived ones on request. Not available to interviewers. |
| \`create_email_template\` | Admins: a name (unique, ignoring case), a one-line subject and a body. |
| \`update_email_template\` | Admins: rename or rewrite one, or archive it (kept, and drafts already written from it are untouched) or bring it back. Templates are never deleted. Claude confirms first. |

Tacit fills these placeholders in when it drafts:

| Placeholder | Becomes |
| --- | --- |
| \`{{candidate_first_name}}\`, \`{{candidate_name}}\` | The candidate's first or full name |
| \`{{job_title}}\` | The job's title, when the draft is tied to a job |
| \`{{company_name}}\` | Your company's name |
| \`{{sender_name}}\`, \`{{sender_first_name}}\` | Your full or first name |

If a placeholder cannot be filled for this candidate (no job given for \`{{job_title}}\`, say), no draft is written and Claude tells you which one.

## Sent email is on the record

\`list_emails\` shows the emails to one candidate, newest first, with their bodies: every one sent or being sent, and your own drafts, each with its status (\`draft\`, \`sending\`, \`sent\`, \`failed\`). A sent email also appears in \`get_candidate\` and \`get_activity\`, and counts as contact on the job it was tied to.

You can send at most 30 emails an hour.`,
  },
  {
    slug: "interviews",
    title: "Interviews & feedback",
    category: "Interviews & offers",
    description: "Plans, scheduling, scorecards and interview feedback.",
    body: `## Interview plans

A job's **interview plan** is its interview steps in order, such as *Recruiter screen*, *Technical*, *Onsite*.

- \`get_interview_plan\` shows a job's steps. Given a candidate's application, it also shows their progress on each step: its interviews and their status, whether each interviewer's feedback is filed, not filed, or hidden by your company's setting, interviews on no step, and the next step to schedule.
- \`set_interview_plan\` replaces the whole plan with the steps you give, in order: at most 15, each a distinct name of up to 120 characters. An empty list clears it. Interviews already on a step you remove keep its name and show as off the plan. Needs the right to manage the job; Claude reads the new steps back and waits for your yes.

## Schedule an interview

> Schedule Priya's technical screen with Dana and Lee on Thursday at 2pm Pacific for an hour.

\`schedule_interview\` schedules an interview on one application with your company's interviewers. Times include their timezone offset.

**With your Google Calendar connected** (the Calendar page here, once), Tacit first checks the interviewers' calendars. If anyone is busy, nothing is booked and Claude tells you who; you can pick another time or book anyway. Otherwise the event goes on your calendar, Google sends the interviewers their invitations, and a Google Meet link is added unless you give a place.

**Without a connected calendar** it is recorded in Tacit only, and nobody is invited.

The candidate is never put on the calendar invite. Instead Claude drafts an email to them with the time and the link, shows it to you, and sends it only after your yes.

When the job has an interview plan, the step must be one of its steps. Scheduling needs the right to schedule on that job; Claude confirms the time and interviewers first.

## Find a time

> When are Dana and Lee both free for an hour next week?

\`find_interview_times\` reads the interviewers' calendars, busy times only and never what is on them, and suggests times in a window of up to two weeks when all of them are free, inside working hours (9 to 5 on weekdays unless you say otherwise) in your timezone. Each interviewer is read through their own connected calendar, or else through yours when your company shares calendars within its Google Workspace. Anyone Tacit cannot read is named, not assumed free.

## Connect your calendar

Open **Calendar** in Tacit's member area and choose **Connect Google Calendar**. Tacit asks Google for two things: to see when you are busy, and to add and change the interview events it books. You can disconnect there at any time. Microsoft Outlook calendars are not supported yet.

\`update_interview\` moves an interview, changes its interviewers or location, or sets its status: \`scheduled\`, \`done\` or \`cancelled\`. Only what you mention changes, and Claude confirms first. When the interview is on a calendar, the event follows: a move is checked against the interviewers' calendars, new interviewers are invited, and cancelling removes the event, with Google telling everyone on it. A move or a cancellation comes with a draft email to the candidate, sent only after your yes.

\`list_my_interviews\` lists the interviews you are on (upcoming by default, or past, or all), with the candidate, the job and whether you have filed feedback.

## Scorecards

A job's **scorecard** is the list of attributes interviewers rate, such as *System design* or *Communication*.

- \`get_scorecard\`: a job's attributes in order. Anyone who can see the job can read it, interviewers included.
- \`set_scorecard\`: sets the attributes to exactly the list you give. An attribute is matched by name, so you can reorder freely; renaming one keeps its ratings. One you leave out is archived, never deleted, so ratings already filed keep it. Only for the people who manage the job, and confirmed first.

## File feedback

> File my feedback on Priya's technical: yes, rating 3. System design 4, she broke the problem down well. Communication 3.

\`submit_feedback\` files your feedback on an interview you were on, once it has started:

| | |
| --- | --- |
| Recommendation | \`strong_yes\`, \`yes\`, \`no\` or \`strong_no\` |
| Rating | Optional, 1 to 4 |
| Notes | Your own words |
| Scorecard ratings | Optional: 1 to 4 per attribute, with a short note each |

Filing again replaces your earlier feedback, ratings included.

\`get_feedback\` reads the feedback on one interview, or on every interview of one application, with each interviewer and their ratings. Whose feedback you see follows your company's [feedback visibility](/docs/access) setting.

**Feedback is private to your hiring team.** Claude will not put it in anything written to a candidate.

## Your Granola notes

If you take interview notes in Granola, connect it on the **Integrations** page (paste a Granola API key from Granola's Settings → Connectors → API keys). Then \`get_interview_notes\` brings back your own note from an interview you were on: Granola's summary, what you typed, and the transcript if you ask for it. Ask Claude to "write my feedback from my Granola notes" and it drafts \`submit_feedback\` for you to check.

The note is found by the calendar event Tacit booked, the candidate's email, or its start time, and Claude says which. When nothing matches, it lists the notes you took around then so you can pick one. Only your own notes are ever read, never a colleague's, and they are private like feedback.`,
  },
  {
    slug: "offers",
    title: "Offers & closing",
    category: "Interviews & offers",
    description: "Draft and track offers, and close applications with a reason.",
    body: `## Offers

An offer moves through these statuses:

\`draft\` → \`extended\` → \`accepted\` or \`declined\`, and \`draft\` or \`extended\` → \`withdrawn\`.

> Draft an offer for Priya: $185,000 a year, 0.1% equity, start March 2.

- \`create_offer\` drafts an offer on one application: salary (a whole amount a year), currency (three letters, USD unless you say), bonus, equity, start date, expiry date and notes. One open offer per application. Claude confirms the terms first.
- \`update_offer\` changes a draft's terms, or moves an offer along: mark it **extended** once it has gone to the candidate, then **accepted** or **declined**, or **withdrawn**. An extended offer's terms never change: withdraw it and draft a new one, so what was sent stays on record. Claude confirms first.
- \`get_offers\` lists every offer on an application, newest first, with its terms and history.

Recording an offer changes nothing else. Drafting one does not move the stage or send anything, and recording **accepted** does not mark them hired: move the stage with \`update_stage\`.

Offers are only for the people who manage the job. **Compensation is confidential**: Claude shares it only with you.

## Closing an application

Every company has a list of reasons an application can close. \`list_rejection_reasons\` returns them, each with its kind:

| Kind | For |
| --- | --- |
| \`rejected\` | Your company passed on the candidate. Use with stage \`rejected\`. |
| \`withdrew\` | The candidate pulled out. Use with stage \`withdrawn\`. |

> Reject Lee from the Backend job: not enough distributed systems experience.

Claude picks the matching reason, calls \`update_stage\` with it and your note, and confirms first. Calling it again on someone already closed replaces the reason. \`get_candidate\` and \`get_activity\` show why an application closed.`,
  },
  {
    slug: "admin",
    title: "Jobs, teams & invitations",
    category: "Administration",
    description: "Create jobs, staff hiring teams, set access and invite colleagues.",
    body: `## Jobs

- \`create_job\` (admins): a job with a title, and optionally a status, location, level and description. It starts \`open\` unless you say otherwise. Claude confirms the details first.
- \`update_job\`: change a job's title, status (\`open\`, \`paused\`, \`filled\`, \`closed\`), location, level or description. Only what you mention changes. Needs the right to manage the job; confirmed first.

## Hiring teams

> Put Dana on the Backend Engineer job as hiring manager.

- \`get_hiring_team\`: who works a job, their team roles on it, and the access that gives them.
- \`add_to_hiring_team\` (admins): adds a member (from \`list_team\`) as \`hiring_manager\`, \`recruiter\`, \`coordinator\`, \`sourcer\` or \`interviewer\`. See [Access levels](/docs/access) for what each gives.
- \`remove_from_hiring_team\` (admins): takes one team role off a member, or every role they hold on the job. The access it gave goes with it. Confirmed first.

## Access levels

> Make Lee an admin.

\`set_member_access\` (admins) sets a member to interviewer, hiring team or admin. Your company always keeps at least one admin who has signed in, so the last admin cannot be lowered. Claude tells you exactly what will change and waits for a yes.

## Read-only connector

> Make the Claude connector read-only for our company.

\`set_connector_access\` (admins) makes the connector **read-only** for everyone at your company: Claude can still read jobs, candidates and reports, but every change through the connector is refused, with a sentence saying so and that an admin can turn changes back on. Admins can always switch it back to **read-write** with the same tool, even while it is read-only. \`get_connector_settings\` shows which it is and who last changed it. This applies only to the connector: the Tacit workspace on the web works as before. Claude tells you exactly what will change and waits for a yes.

## Invitations

> Invite dana@yourcompany.com as hiring team.

- \`invite_member\` (admins): sends an invitation email from WorkOS to join your company's Tacit workspace, at the access level you choose. Inviting an address that is already invited sends the email again. Claude confirms the address first.
- \`list_invites\` (admins): who has been invited and not signed in yet.
- \`withdraw_invite\` (admins): takes back an invitation nobody has accepted.

Once someone accepts and signs in, they appear in \`list_team\` and can [connect Claude](/docs/connect) themselves.`,
  },
  {
    slug: "client-tools",
    title: "Tool reference",
    category: "Reference",
    description: "Every tool the connector offers, who can use it, and which ones ask first.",
    body: `You rarely need tool names: ask in plain words and Claude picks the tool. This list is for knowing what is possible. **Asks first** means Claude describes the change and waits for your yes.

## Workspace and candidates

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`whoami\` | Your company, name, access level and the jobs you can see | Everyone | |
| \`list_jobs\` | The jobs you can see, with candidate counts | Everyone | |
| \`get_pipeline\` | One job's candidates by stage, flagging who needs attention | Hiring team, admins | |
| \`search_candidates\` | Find candidates by name, email, company, title, job or tag | Everyone (interviewers: their own) | |
| \`get_candidate\` | Profile, jobs, notes, tags and files | Everyone (interviewers: a short card) | |
| \`get_activity\` | A candidate's history, newest first | Everyone (interviewers: their own) | |
| \`list_team\` | Your company's members and their access | Everyone | |
| \`add_candidate\` | Add someone to a job at sourced, with a source | Job managers | |
| \`update_stage\` | Move an application, with a reason when closing | Job managers | Yes |
| \`set_next_action\` | Set or clear what happens next, with a due date | Job managers | |
| \`add_note\` | A note the team can read | Everyone | |

## Tags and files

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`list_tags\` | Your company's tags and how many carry each | Hiring team, admins | |
| \`create_tag\` | Make a tag | Anyone who can add candidates | |
| \`tag_candidate\` | Put a tag on a candidate | Whoever can edit the candidate | |
| \`untag_candidate\` | Take a tag off | Whoever can edit the candidate | Yes |
| \`archive_tag\` | Retire a tag | Admins | Yes |
| \`list_files\` | A candidate's resumes and attachments | Everyone (interviewers: the resume) | |
| \`get_file_link\` | A five-minute download link | Everyone who can see the file | |
| \`add_file\` | Attach a resume or file, up to 3 MB | Whoever can edit the candidate | |

## Email

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`draft_email\` | Draft an email to a candidate; sends nothing | Whoever can edit the candidate | |
| \`send_email\` | Send your draft, once | The draft's author | Yes |
| \`list_emails\` | A candidate's emails and your drafts | Hiring team, admins | |
| \`list_email_templates\` | Your company's email templates | Hiring team, admins | |
| \`create_email_template\` | Make a template | Admins | |
| \`update_email_template\` | Rename, rewrite or archive a template | Admins | Yes |

## Interviews, feedback and offers

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`list_my_interviews\` | Interviews you are on | Everyone | |
| \`get_interview_plan\` | A job's steps, and a candidate's progress | Everyone who can see the job | |
| \`set_interview_plan\` | Replace a job's steps | Job managers | Yes |
| \`find_interview_times\` | Times the interviewers are all free | Job managers | |
| \`schedule_interview\` | Book an interview and invite the interviewers | Job managers | Confirms time |
| \`update_interview\` | Move, change or cancel an interview | Job managers | Yes |
| \`get_scorecard\` | A job's rated attributes | Everyone who can see the job | |
| \`set_scorecard\` | Set a job's attributes | Job managers | Yes |
| \`submit_feedback\` | File your feedback and ratings | The interview's interviewers | |
| \`get_feedback\` | Read filed feedback | Per your company's setting | |
| \`get_interview_notes\` | Your Granola notes from an interview | The interview's interviewers, with Granola connected | |
| \`list_rejection_reasons\` | Your company's closing reasons | Hiring team, admins | |
| \`get_offers\` | An application's offers | Job managers | |
| \`create_offer\` | Draft an offer | Job managers | Confirms terms |
| \`update_offer\` | Change terms or record the outcome | Job managers | Yes |

## Approvals

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`get_approval_flow\` | A job's approval chain for offers or for opening it | Job managers, its approvers | |
| \`set_approval_flow\` | Set or remove a job's approval chain | Job managers | Yes |
| \`request_approval\` | Ask for approval of a draft offer or of opening a job | Job managers | |
| \`list_my_approvals\` | What is waiting on your approval | Everyone | |
| \`approve\` | Approve the step waiting on you | That step's approvers | Yes |
| \`reject\` | Reject it, with a reason | That step's approvers | Yes |

## Custom fields

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`list_custom_fields\` | Your company's fields on candidates, jobs and offers | Hiring team, admins | |
| \`create_custom_field\` | Define a field, with its type and options | Admins | |
| \`update_custom_field\` | Rename, make private, archive, or change a field's options | Admins | Yes |
| \`set_custom_field\` | Set or clear a field on a candidate, job or offer | Whoever can edit it (private fields: admins and job managers) | |

## Departments, offices and openings

Jobs sit in a department (departments can nest) and in one or more offices. A job's openings are how many people it hires: moving someone to hired fills the oldest open one, and when none is left the job is marked filled.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`list_departments\` | Your company's departments and how many jobs are in each | Hiring team, admins | |
| \`create_department\` | Add a department, optionally inside another | Admins | |
| \`update_department\` | Rename, move, archive or bring back a department | Admins | Yes |
| \`list_offices\` | Your company's offices and how many jobs are in each | Hiring team, admins | |
| \`create_office\` | Add an office, with its location | Admins | |
| \`update_office\` | Rename, relocate, archive or bring back an office | Admins | Yes |
| \`list_openings\` | A job's openings: open, filled (and by whom) or closed | Hiring team, admins | |
| \`add_openings\` | Add openings to a job, with your own codes and a target start date | Job managers | Confirms count |
| \`close_opening\` | Close an open opening without a hire, with a reason | Job managers | Yes |

## Prospects and talent pools

A prospect is someone your team wants to keep in touch with before there is a job for them: they are on file but in no job. A talent pool is a named list of prospects or candidates, each at a pool stage (new, contacted, engaged, not interested). Interviewers see neither, and an external recruiter sees only the prospects they added.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`add_prospect\` | Add someone with no job yet, with how they came in, optionally into a pool | Anyone who can add candidates | |
| \`convert_prospect\` | Put a prospect in a job at sourced, carrying their source | Job managers | Yes |
| \`list_pools\` | Your company's talent pools and how many people are in each | Hiring team, admins | |
| \`create_pool\` | Make a talent pool | Anyone who can add candidates | |
| \`archive_pool\` | Retire a pool; its people stay in it | Admins | Yes |
| \`add_to_pool\` | Put someone in a pool, or move them to another pool stage | Anyone who can add candidates | |
| \`remove_from_pool\` | Take someone out of a pool | Anyone who can add candidates | Yes |
| \`list_pool\` | The people in a pool and their pool stage | Hiring team, admins | |

A prospect can be changed by whoever added them and by admins. \`search_candidates\` can look only at prospects or only in one pool, and \`get_candidate\` shows the pools someone is in.

## Job posts

A job post is the public page for a job, with an application form: a title, a location, a description and the questions to ask. Name and email are always asked; you can add phone, LinkedIn, a link to a resume, and your own short-answer, long-answer, yes/no and multiple-choice questions. A post starts as a draft and is public only once it is live, at a link nobody can guess. Applicants join the job at sourced, with the source job board, and their answers stay with their application.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`list_job_posts\` | A job's posts, their status, link, questions and how many applied | Anyone who can see the job | |
| \`create_job_post\` | Write a post for a job, as a draft | Job managers | |
| \`update_job_post\` | Change a post's text or questions; a live post changes at once | Job managers | |
| \`set_job_post_status\` | Publish a post (live) or take it down (closed) | Job managers | Yes |
| \`list_applications_inbox\` | New applicants from job posts, with their answers | Hiring team, admins | |

A post takes applications only while its job is open. \`get_candidate\` and \`get_pipeline\` show a job-board applicant's answers. Applicants cannot upload a resume yet; the resume question asks for a link.

## Duplicates and erasure

For admins only. A merge folds one candidate record into another: notes, files, tags, emails, custom fields, pools, interviews and every job move to the record you keep; where both were in the same job, the further-along application is kept. Blank fields on the kept record are filled from the other, never overwritten, and the duplicate stays on file marked merged, hidden from your team. Erasure (GDPR) is permanent: the candidate's name, contact details, profile, notes, files, emails and the words of their feedback are deleted, and their applications, stages and dates stay under "Anonymized candidate" so your numbers still add up. To erase someone you confirm by typing ANONYMIZE and their name.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`find_duplicates\` | Candidates who are probably the same person: same email, LinkedIn or name | Admins | |
| \`merge_candidates\` | Fold a duplicate into the record you keep | Admins | Yes, naming both |
| \`anonymize_candidate\` | Permanently erase a candidate's personal data | Admins | Yes, naming them |

## Reports

Each report counts only what you can see: an admin the whole company, the hiring team the jobs they are on. Give \`since\` as a date (YYYY-MM-DD) to narrow it. Merged duplicates are not counted twice, and erased candidates still count, without names.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`pipeline_report\` | Per stage: how many are there now, how many got that far, conversion to the next stage, average days in it | Hiring team, admins | |
| \`source_report\` | Per source: applications, still active, hired, rejected, withdrawn, hire rate | Hiring team, admins | |
| \`time_to_hire\` | Median and average days from added to hired, and from a job's creation to its first hire | Hiring team, admins | |
| \`rejection_report\` | Closed applications per rejection or withdrawal reason | Hiring team, admins | |
| \`interviewer_activity\` | Per interviewer: interviews done, feedback filed on time (within 24 hours), late or missing | Admins, job managers | |
| \`offer_report\` | Offers by status, acceptance rate, days to an answer | Job managers | |

## EEOC

Candidates can answer the voluntary US equal-opportunity questions (gender, race / ethnicity, veteran status, disability status) when they apply through a job post, with "I decline to self-identify" on each. **Nobody at your company can see one person's answers**, admins included: they exist only as totals, and any count under five shows as "<5". Erasing a candidate deletes their answers.

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`eeoc_report\` | Totals per answer, for applicants and hires, small counts hidden | Admins | |
| \`record_eeoc\` | Type in a paper form a candidate filled in; you cannot read it back | Job managers | Yes |

## Administration

| Tool | What it does | Who | Asks first |
| --- | --- | --- | --- |
| \`create_job\` | Create a job | Admins | Confirms details |
| \`update_job\` | Change a job's details or status | Job managers | Yes |
| \`get_hiring_team\` | Who works a job | Job managers | |
| \`add_to_hiring_team\` | Add a member to a job's team | Admins | |
| \`remove_from_hiring_team\` | Take a member off a job's team | Admins | Yes |
| \`set_member_access\` | Change a member's access level | Admins | Yes |
| \`get_connector_settings\` | Whether the connector can make changes, and who last set it | Everyone | |
| \`set_connector_access\` | Make the connector read-only, or read-write again | Admins | Yes |
| \`invite_member\` | Invite a colleague by email | Admins | Confirms address |
| \`list_invites\` | Pending invitations | Admins | |
| \`withdraw_invite\` | Take back an invitation | Admins | Yes |

"Job managers" are admins and the job's hiring managers and recruiters.`,
  },
  {
    slug: "client-privacy",
    title: "Limits, privacy & audit",
    category: "Reference",
    description: "What is recorded, the hourly limits, and how candidate data is handled.",
    body: `## Nothing is deleted, except an erasure

No tool deletes a job or a note. Things that end are closed, withdrawn or archived instead, so the record stays complete. A merge keeps the duplicate's record, marked merged. The one exception is \`anonymize_candidate\`: an admin can permanently erase a candidate's personal data, files included, when they ask for it (GDPR). Their applications, stages and dates stay, anonymized.

## Everything is recorded

- Every tool call is logged with who made it and when.
- Every change is recorded with what it was before and after. Admins can read this record. Feedback notes, rating notes, offer notes, filenames and email subjects and bodies are kept out of it.

## Limits

| Limit | |
| --- | --- |
| Changes | 300 per person per hour |
| Candidates looked at | 150 different candidates per person per hour |
| Emails sent | 30 per person per hour |
| File size | 3 MB |
| Download links | Expire after five minutes |

The candidate limit stops anyone from copying out the whole database. When you reach it, Claude says so; narrow the request or try again later.

## Candidate text is treated as data

Names, headlines, notes, filenames and other text written by or about a candidate are marked as untrusted when they reach Claude. Claude reads them as information, never as instructions, so a resume that says "ignore your rules" changes nothing.

## Confidential by default

- Interview feedback stays with the hiring team and never goes in a message to a candidate.
- Offer terms are shared only with you.
- Email reaches a candidate only after you have read the whole draft and said yes. Scheduling records the interview without inviting anyone, and offers are marked extended only after you have sent them yourself.`,
  },
];
