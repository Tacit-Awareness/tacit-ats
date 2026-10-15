import { CLIENT_CONNECTOR_URL } from "./client-pages";
import type { DocPage } from "./types";

/**
 * Staff-only documentation: Tacit's own connector (apps/mcp's
 * /api/connector), the iMessage MCP (/api/mcp) and how both connectors are
 * run. Shown at /docs beside the client pages; never under /client/docs.
 *
 * Tool names here are checked against apps/mcp's src/connector/server.ts by
 * docs.test.ts, the same way the client pages are.
 */

export const STAFF_CONNECTOR_URL = "https://mcp.tacitawareness.com/api/connector";

export const STAFF_OVERVIEW: DocPage = {
  slug: "overview",
  title: "Tacit's MCP servers",
  category: "Start here",
  description: "The three ways a model reaches Tacit, and which one to use.",
  body: `Tacit has three MCP servers, all in \`apps/mcp\`. They share Tacit's data and core's functions, and nothing else: each has its own sign-in, its own tools and its own audit trail.

| Server | Who uses it | Sign-in | Tools |
| --- | --- | --- | --- |
| **Tacit connector** \`/api/connector\` | Tacit teammates, in Claude | Tacit account (WorkOS OAuth) | 35 tools over Tacit's org: candidates, client roles, pipeline, nudges, email, interviews, Testbench, who-knows |
| **Client connector** \`/api/client\` | A client company's members, in Claude | Their company account (WorkOS OAuth) | 82 tools over their own company only: jobs, pipeline, email, interviews, feedback, offers, files, tags, team, departments and openings, prospects and talent pools, job posts and applicants, duplicates and erasure |
| **iMessage MCP** \`/api/mcp\` | The iMessage bot (tacit-bot) | A static \`tk_\` key per teammate | 24 tools; the bot calls \`tacit_ask\` |

## Which page to read

| You want to… | Read |
| --- | --- |
| Use Tacit from Claude yourself | [Connect the Tacit connector](/docs/connector) |
| Help a client company set up Claude | [Connect Tacit to Claude](/docs/connect), the page they see |
| Know what a client can and cannot see | [Access levels](/docs/access) |
| Look up a tool | [Tacit connector tools](/docs/connector-tools) or [Client tool reference](/docs/client-tools) |
| Configure or debug a deployment | [Setup & operations](/docs/operations) |

## Where clients read this

A client's members see only the client connector pages, at \`/client/docs\` once they are signed in to the client area. Staff see every page here at \`/docs\`. Links between client pages work in both places.`,
};

export const STAFF_DOCS: DocPage[] = [
  {
    slug: "connector",
    title: "Connect the Tacit connector",
    category: "Tacit connector",
    description: "Add Tacit to Claude and sign in with your Tacit account.",
    body: `The Tacit connector is Tacit's candidate database in Claude: candidates, client companies and their roles, each candidate's stage and next action, interviews, notes and email. Claude acts as you, and every change is recorded under your name.

## Add it in Claude

1. Open **Settings → Connectors → Add custom connector**.
2. Name it **Tacit** and paste:

\`\`\`text
${STAFF_CONNECTOR_URL}
\`\`\`

3. Choose **Connect** and sign in with your Tacit account (your tacitawareness.com address).

### Claude Code

\`\`\`sh
claude mcp add --transport http tacit ${STAFF_CONNECTOR_URL}
\`\`\`

Then \`/mcp\` → **tacit** to sign in.

## First sign-in

Your first sign-in is matched by verified email to your teammate record (\`actors.email\`). If there is no match you get a 403 and nothing is created. Ask an admin to set your actor's email, then connect again.

## Start here

> What needs my attention today?

Claude calls \`list_my_nudges\`: interviews starting soon, next actions due, candidates you own who have gone quiet, and feedback you owe.

## Two kinds of stage

A person has **one Tacit stage**, where they stand with Tacit itself (\`get_funnel\`, \`update_tacit_stage\`), and **a stage in each client role** they are in (\`get_pipeline\`, \`update_stage\`). Say which one you mean; Claude will ask if it is unclear.

## What Claude will always ask first

\`update_stage\`, \`update_tacit_stage\`, \`create_role\`, opening a role with \`update_role\`, \`send_message\`, \`approve\`, \`schedule_interview\` and \`reschedule_interview\`. Email is always two steps: a draft you see, then a send you approve.`,
  },
  {
    slug: "connector-candidates",
    title: "Candidates, roles & funnel",
    category: "Tacit connector",
    description: "Search candidates, work client roles and companies, and move people through the Tacit funnel.",
    body: `## Candidates

| Tool | |
| --- | --- |
| \`search_candidates\` | By name, email, school or keywords, or by stage, role or owner. Use it whenever you only have a name. Someone in two pipelines appears once per role. |
| \`get_candidate\` | The full record: profile, Tacit stage, every application, the last 10 notes, upcoming interviews, the last 5 emails, and Testbench assessments when connected. By id or email. |
| \`add_candidate\` | By name and email. An email already on file returns the existing person instead. With \`role_id\`, also adds them to that role at sourced; with \`note\`, files a first note. |
| \`add_note\` | A note on a person; with \`application_id\` it also shows on that application's history and counts as contact. |

## Client companies and roles

| Tool | |
| --- | --- |
| \`list_companies\` | Client companies, most recently active first, with owner and open-role count. \`query\` finds one by name. |
| \`get_company\` | Owner, contacts (and which owns the hire), pending, open and paused roles with brief, pay and interview steps, the last 10 notes and recent pipeline activity. |
| \`list_roles\` | Open roles with live candidate counts; \`status: pending_approval\` lists roles nobody has opened yet. |
| \`create_role\` | A new role at a company on file. It starts **pending_approval**: saved, not live. |
| \`update_role\` | Partial edits; the interview steps and owners lists are replaced whole. Setting \`status: open\` makes the role live, and only after you say to open it. |

\`get_company\`'s \`private_context\` is Tacit's internal read on the client. Claude uses it to inform what it does and never puts it in anything a candidate or the client reads.

A company that is not on file has to be added in the internal app first (\`/companies/new\` or \`/pipeline\`'s **+ Add company**).

## Pipeline

| Tool | |
| --- | --- |
| \`get_pipeline\` | Counts per stage for one role or every open role, plus candidates nobody has contacted in 7 days. To list who is at a stage, use \`search_candidates\` with stage and role. |
| \`update_stage\` | Moves one application: \`sourced\`, \`contacted\`, \`screening\`, \`interviewing\`, \`offer\`, \`hired\`, or \`rejected\` / \`withdrawn\`. Confirmed first. |
| \`set_next_action\` | What happens next on an application, who it waits on and when. Replaces the current one (the old one stays in history). It is a plan, not contact: use \`add_note\` to record that something happened. |

## The Tacit funnel

| Tool | |
| --- | --- |
| \`get_funnel\` | How many people are at each Tacit stage; with \`stage\`, who is there (longest first) and the roles each is in. |
| \`update_tacit_stage\` | Moves one person's Tacit stage. Confirmed first. |

The stages are \`new\`, \`met\`, \`interviewing\`, \`ready\`, \`in_process\`, \`placed\`, \`passed\` and \`inactive\`. Joining a role's pipeline sets \`in_process\` and being hired sets \`placed\` automatically, so set those by hand only to correct the record.`,
  },
  {
    slug: "connector-nudges",
    title: "Nudges",
    category: "Tacit connector",
    description: "What needs your attention, worked out fresh every time you ask.",
    body: `> What's on my plate?

\`list_my_nudges\` returns, soonest first:

| Nudge | When |
| --- | --- |
| \`interview_soon\` | An interview of yours starts within the hour |
| \`next_action_due\` | A next action of yours is due within a day |
| \`quiet_candidate\` | A candidate you own has had no contact for 7 days |
| \`feedback_due\` | An interview you were on has finished and you have not filed feedback |

Each nudge carries the ids to act on it and a link into the internal app. The list is computed on every call (there is no background job), so a nudge disappears on its own once it stops being true.

| Tool | |
| --- | --- |
| \`complete_nudge\` | You dealt with it. It will not come back for the same thing that day. This only clears the nudge: record contact with \`add_note\`. |
| \`snooze_nudge\` | Hide it until a time you choose. It returns on the first list after that, if still true. |
| \`dismiss_nudge\` | It was not useful. Give a reason if you have one; it is kept to tune what gets nudged. |

A nudge belongs to its owner only: anyone else's reads as not found.`,
  },
  {
    slug: "connector-email",
    title: "Email & approvals",
    category: "Tacit connector",
    description: "Draft, send and review email to candidates and client contacts.",
    body: `Email through the connector is always **two steps**, and Claude cannot type an address.

## Draft, then send

> Draft a follow-up to Priya about next week's onsite.

1. \`draft_message\` writes a draft to a candidate (\`candidate_id\`) or a client contact (\`contact_id\` from \`get_company\`). The address is the one on file, and it goes from your own Tacit address. Claude shows you the recipient, subject and full body exactly as saved. To change it, it drafts again.
2. \`send_message\` sends it, once you have read it and said to. A message is delivered once and cannot be unsent; calling send twice never sends twice.

Pick the message type honestly: \`follow_up\`, \`status_update\`, \`scheduling\`, \`offer\`, \`rejection\`, \`intro\` or \`other\`.

## Offers, rejections and intros are reviewed

An \`offer\`, \`rejection\` or \`intro\` is **not delivered** by \`send_message\`. It goes to a reviewer: the teammate who owns the client company, or the fallback reviewer when there is no owner or the owner wrote it. The author never reviews their own draft. Claude tells you who it is waiting on.

| Tool | |
| --- | --- |
| \`list_pending_approvals\` | Drafts waiting on your review, in full, plus where your own drafts stand (out for review, or rejected in the last week with the reviewer's note). |
| \`approve\` | Your decision on a draft sent to you. **approve sends it immediately**, from its author's address. **reject** sends nothing and returns it to the author with your note. |

## What never goes in an email

Interview feedback, internal notes and a client's \`private_context\`. Nothing that drafts or sends reads the feedback table.

## Limits

30 sends and 300 writes per teammate per hour. \`draft_email\` and \`send_email\` are old names for \`draft_message\` (to a candidate, type \`other\`) and \`send_message\`, kept for one release.`,
  },
  {
    slug: "connector-interviews",
    title: "Interviews & feedback",
    category: "Tacit connector",
    description: "Book interviews on Google Calendar and collect feedback.",
    body: `## Upcoming interviews

\`list_upcoming_interviews\` lists your interviews over the next 7 days by default (time, candidate, role, interviewers, link). Set \`mine\` to false for the whole team's.

## Book an interview

> Book Priya's technical with Dana for Thursday at 2pm, an hour.

\`schedule_interview\` books one step of a candidate's process. Claude confirms the candidate, step, interviewers, time and length first.

- **With a start time**: checks the interviewers' calendars, creates a Google Calendar event on **your** calendar with a Meet link, invites the interviewers, records the interview, and writes a **draft** confirmation to the candidate.
- **With proposed times**: only drafts a message offering them. Book with a start time once the candidate picks.

The candidate is never on the calendar event and is never emailed by this tool: you send the draft with \`send_message\`. If an interviewer is busy, nothing is booked and Claude says who; it books anyway only after you say so. A step holds one booking at a time.

\`reschedule_interview\` moves a booked interview to a new start (same length), moves the calendar event with the booker's grant, and drafts a note to the candidate.

Both need your Google grant from the internal app's **Connect** page (Google Workspace). Without it, they refuse and say to connect.

## Feedback

| Tool | |
| --- | --- |
| \`submit_feedback\` | Your feedback on an interview you were on: \`strong_yes\`, \`yes\`, \`no\` or \`strong_no\`, an optional 1–4 rating, and notes in your words. Filing again replaces yours and clears your \`feedback_due\` nudge. |
| \`get_feedback\` | Feedback on one interview or every interview of an application: each interviewer's recommendation, rating and notes, and who has not filed. |
| \`request_feedback\` | Gives each interviewer who has not filed a \`feedback_due\` nudge. **Nothing is emailed or messaged to anyone.** |

Feedback is private to the team and never goes in a message to a candidate or a client.`,
  },
  {
    slug: "connector-testbench",
    title: "Testbench assessments",
    category: "Tacit connector",
    description: "Read candidates' technical assessment results from Tacit Testbench.",
    body: `Tacit Testbench is the technical assessment platform at testbench.tacitawareness.com: its own app, database and sign-in. The connector reads its results through Testbench's read-only reporting API. Nothing is written to Testbench, and nothing read from it is stored in Tacit.

## Connect once per company

> How did Priya do on her assessment?

The first time, the assessment tools say Testbench is not connected and Claude calls \`connect_testbench\`. It returns a link and a code:

1. Open the link while signed in to Testbench.
2. Check the code matches, choose the **company**, pick an expiry and approve.
3. Ask again.

A connection covers **one Testbench company** and lasts **at most 7 days** (Testbench's limit). Connect again for another company, or when it lapses. You can revoke it on Testbench's reporting connections page.

## Read results

| Tool | |
| --- | --- |
| \`get_candidate_assessments\` | A candidate's assessments in the companies you connected: role, company, status (\`invited\`, \`in_progress\`, \`pending_review\`, \`advanced\`, \`rejected\`, \`expired\`), stage and score. Matched by the candidate's email on file, exactly. An empty result means none under those companies. |
| \`get_assessment_report\` | One attempt: overall and per-criterion scores, tests passed and which failed, and reviewers' recorded decisions and notes. |

\`get_candidate\` includes the assessment list when it can, with a note saying why when it cannot.

A score is test evidence, not a hiring decision: Claude reports a decision only if a reviewer recorded one. Testbench's own docs cover the reporting CLI and MCP in depth.`,
  },
  {
    slug: "connector-reach",
    title: "Who knows whom",
    category: "Tacit connector",
    description: "Find the teammate who knows a person, and the people the team knows for a hiring need.",
    body: `\`search_candidates\` reads candidate records only. It answers neither of these questions.

## Does anyone know this person?

> Does anyone at Tacit know Sanjay Mehta?

\`who_knows\` answers for one named person, as separate lists that are never merged:

| List | Means |
| --- | --- |
| \`people\` | A candidate record a teammate knows, with who and how |
| \`rolodex\` | In both a teammate's LinkedIn and Instagram; the owner is the teammate to ask |
| \`circle\` | A teammate's closest-friends circle, or someone who follows it |
| \`meetings\` | Teammates who sat in a recorded meeting with them |

Only \`meetings\` is evidence anyone has actually met them. Claude always names the teammate.

## Who do we know for a need?

> Who do we know in computational biology?

\`find_adjacent\` takes a hiring need in plain words and returns the closest people the team already knows: candidates in Tacit and people in both a teammate's LinkedIn and Instagram. Each has a fit score (0–100), a one-line why, and the teammates who can reach them.

It is slow (two model calls, 10–30 seconds), so use it for open-ended sourcing. For one named person use \`who_knows\`; for a name, school or company you can spell, \`search_candidates\`. A result without a \`candidate_id\` is a teammate's contact only: ask the owner.`,
  },
  {
    slug: "connector-tools",
    title: "Tacit connector tools",
    category: "Tacit connector",
    description: "All 35 tools on /api/connector, and which ones ask first.",
    body: `**Asks first** means Claude describes the change and waits for a yes. Tools marked *reads* only read.

## Candidates, companies and roles

| Tool | What it does | |
| --- | --- | --- |
| \`search_candidates\` | Find candidates by name, email, school, keywords, stage, role or owner | reads |
| \`get_candidate\` | A candidate's full record | reads |
| \`add_candidate\` | Add a person, optionally to a role | |
| \`add_note\` | A note on a person or application | |
| \`list_companies\` | Client companies on file | reads |
| \`get_company\` | One company in full | reads |
| \`list_roles\` | Roles and live candidate counts | reads |
| \`create_role\` | A new role, pending approval | Asks first |
| \`update_role\` | Edit a role; opening it makes it live | Asks first for status |

## Pipeline and funnel

| Tool | What it does | |
| --- | --- | --- |
| \`get_pipeline\` | Stage counts and quiet candidates | reads |
| \`update_stage\` | Move an application | Asks first |
| \`set_next_action\` | Plan what happens next | |
| \`get_funnel\` | People by Tacit stage | reads |
| \`update_tacit_stage\` | Move a person's Tacit stage | Asks first |

## Nudges

| Tool | What it does | |
| --- | --- | --- |
| \`list_my_nudges\` | What needs your attention | reads |
| \`complete_nudge\` | Mark one done | |
| \`snooze_nudge\` | Hide one until later | |
| \`dismiss_nudge\` | Drop one as not useful | |

## Email and approvals

| Tool | What it does | |
| --- | --- | --- |
| \`draft_message\` | Draft to a candidate or client contact | |
| \`send_message\` | Send a draft, or route it for review | Asks first |
| \`list_pending_approvals\` | Drafts waiting on you, and yours | reads |
| \`approve\` | Approve (sends) or reject a draft | Asks first |
| \`draft_email\` | Old name for \`draft_message\` | |
| \`send_email\` | Old name for \`send_message\` | Asks first |

## Interviews and feedback

| Tool | What it does | |
| --- | --- | --- |
| \`list_upcoming_interviews\` | Your (or the team's) upcoming interviews | reads |
| \`schedule_interview\` | Book on Google Calendar, or propose times | Asks first |
| \`reschedule_interview\` | Move a booked interview | Asks first |
| \`submit_feedback\` | File your feedback | Reads it back first |
| \`get_feedback\` | Read filed feedback | reads |
| \`request_feedback\` | Nudge interviewers who have not filed | |

## Testbench and reach

| Tool | What it does | |
| --- | --- | --- |
| \`connect_testbench\` | Link one Testbench company for a week | |
| \`get_candidate_assessments\` | A candidate's assessments | reads |
| \`get_assessment_report\` | One attempt's results | reads |
| \`who_knows\` | Which teammate knows a person | reads |
| \`find_adjacent\` | People the team knows for a need | reads |`,
  },
  {
    slug: "imessage-mcp",
    title: "The iMessage MCP",
    category: "Other servers",
    description: "The static-key MCP server behind Tacit on iMessage.",
    body: `\`/api/mcp\` is the server the iMessage bot (tacit-bot, its own repo) calls. It is the only one of the three whose caller is another program rather than a person in Claude.

## Keys

Each teammate has a \`tk_<key_id>_<secret>\` key, sent as a bearer token. Keys come from:

- signing up for iMessage at \`/imessage\` in this app (tacit-bot mints one for the teammate), or
- an admin running:

\`\`\`sh
pnpm --filter @tacit/core mint-key <email>
\`\`\`

The key is printed once and cannot be read back; a lost key is revoked and a new one minted.

## Why it is separate

A failed request gets a bare 401 with **no** \`WWW-Authenticate\` challenge. A challenge would push a client off its static key into OAuth discovery, which this route does not serve. The two connectors need the opposite (their challenge is what starts sign-in), so they live on their own routes. Never add a challenge here.

## Tools

24 tools over core's reads and writes. tacit-bot calls \`tacit_ask\`, which runs a read-only tool loop and is audited per tool as \`imessage:<tool>\`. Every call is a row in \`mcp_calls\`, and reads share the same 150-distinct-people-per-hour ceiling as the connectors.

\`apps/mcp/CLAUDE.md\` has the full tool list and the design notes.`,
  },
  {
    slug: "operations",
    title: "Setup & operations",
    category: "Administration",
    description: "Environment, production state, audit trails and limits for both connectors.",
    body: `## Endpoints

| Server | URL | State |
| --- | --- | --- |
| Tacit connector | \`${STAFF_CONNECTOR_URL}\` | Live since 2026-10-08, on a WorkOS staging AuthKit tenant |
| Client connector | \`${CLIENT_CONNECTOR_URL}\` | Built; production env not set yet, and no client has signed in |
| iMessage MCP | \`https://mcp.tacitawareness.com/api/mcp\` | Live |

OAuth metadata is served at \`/.well-known/oauth-protected-resource\` (the client connector's under \`/.well-known/oauth-protected-resource/api/client\`). Any required variable unset makes the route answer 503.

## Tacit connector environment

| Variable | |
| --- | --- |
| \`WORKOS_AUTHKIT_DOMAIN\`, \`CONNECTOR_RESOURCE_URL\` | Required: the AuthKit issuer and the token audience |
| \`WORKOS_API_KEY\` | First sign-in email lookup, if the JWT template has no \`email\` claim |
| \`RESEND_API_KEY\` | Email delivery; unset, \`send_message\` refuses (unset in production today) |
| \`ANTHROPIC_API_KEY\` | \`find_adjacent\`; unset, it refuses |
| \`GOOGLE_OAUTH_CLIENT_ID\` / \`_SECRET\` | Scheduling, on each teammate's own Google grant |
| \`INTERNAL_ORIGIN\` | Links on nudges |
| \`REVIEW_FALLBACK_EMAIL\` | Reviewer when a client has no owner, or the owner wrote the draft |
| \`TESTBENCH_URL\` | Testbench tools; unset, they refuse |

## Client connector environment

| Variable | |
| --- | --- |
| \`CLIENT_MCP_AUTHKIT_DOMAIN\`, \`CLIENT_MCP_RESOURCE_URL\` | Required: the client AuthKit tenant and the token audience |
| \`SUPABASE_URL\`, \`SUPABASE_PUBLISHABLE_KEY\`, \`SUPABASE_TACIT_SIGNING_KEY\` | Required: the server mints each member a 5-minute database token so RLS decides every read |
| \`CLIENT_WORKOS_API_KEY\` | Optional: the org fallback when a token carries no \`org_id\`, first-sign-in emails, and \`invite_member\` |
| \`CLIENT_FILES_DISABLED\` | Set it until the \`org-files\` bucket exists; file links and uploads then refuse |
| \`RESEND_API_KEY\` | Candidate email delivery; unset, drafts are written and \`send_email\` says sending is not set up |
| \`CLIENT_EMAIL_FROM\` | The sending address, default \`hiring@tacitawareness.com\` (a domain verified in Resend); mail goes out as "<member> at <company>" with Reply-To the member's own address |
| \`CLIENT_EMAIL_DISABLED\` | Set it to turn drafting and sending off; templates still work |

### The org-files bucket, once

Create a private Storage bucket named \`org-files\`: **Public off**, 3 MB file limit, MIME types \`application/pdf\`, \`application/msword\`, \`application/vnd.openxmlformats-officedocument.wordprocessingml.document\`, \`text/plain\`, \`image/png\`, \`image/jpeg\`. Add **no** Storage policies: only the server touches it. Then unset \`CLIENT_FILES_DISABLED\`.

## Onboarding a client

1. Create the org and invite its first admin on [Orgs](/orgs) in this app.
2. They accept the WorkOS email and sign in to \`/client\`.
3. Send them [Connect Tacit to Claude](/docs/connect). They can read the same page at \`/client/docs/connect\` once signed in.

## Audit and limits

| | Tacit connector | Client connector |
| --- | --- | --- |
| Call log | \`mcp_calls\`, as \`connector:<tool>\` | \`mcp_calls\`, as \`client:<tool>\` |
| Change log | \`audit_log\`, claimed before each write | \`audit_log\`, claimed on the member's own token |
| Writes | 300 per teammate per hour | 300 per member per hour |
| Sends | 30 per teammate per hour | 30 per member per hour |
| Reads | 150 distinct candidates per hour | 150 distinct candidates per hour |

A call refused by input validation never reaches a handler and leaves no row. Candidate-derived text in every result is fenced as untrusted data.`,
  },
];
