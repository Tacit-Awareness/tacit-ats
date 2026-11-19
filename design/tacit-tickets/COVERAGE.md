# Tacit: what the UI covers

Every tATS capability and where it lives in this front end. "Hidden" means it is not in the
sidebar: you reach it from the command menu (⌘K), a menu on the thing it acts on, or Settings.

Everything here is a prototype on in-memory demo data. Nothing calls the real connector yet.

## Where things are

| Surface | How you get there |
|---|---|
| Home, Triage, Tickets, People, Interviews, Offers, Listings & Asks | Sidebar, for all teams or one team |
| Insights, Settings | Workspace menu (click "Tacit"), the gear, or ⌘K |
| Candidate | Click a name anywhere, or search in ⌘K |
| Command menu | ⌘K, or the search icon |
| New candidate, Schedule interview | ⌘K, the compose icon, or the button on People / Interviews |

## How the sidebar is arranged

- **Triage** is everything waiting on you: a Needs You group (offers to sign off, feedback you owe, tickets the bot is stuck on), then new applicants to route. A Needs You item opens in Triage itself, with the same controls as on its own page, and a link to that page for a wider look.
- **Tickets** is the record of the work, opening with the interview rounds as blocks. People, Interviews and Offers sit under it.
- Status groups on Tickets and Interviews fold when you click their heading.

## Tutorial

The cap icon beside the dark mode button opens a list of six workflows: route an applicant, clear what needs you, follow interviews by round, send an offer, post a role, and find anything. Picking one walks you through it on the real screens, with a ring round what each step is about. tATS had a tutorial of its own; this replaces it.

## Connector tools, by surface

### Home
The Recruiting Overview from tATS. Applications over this calendar year as a map of days, with the days still to come empty; faint arrows, shown on hover, step back a month or a year. Each way in has its count, and the picked day shows who came in. Under it, one funnel of everyone in process now by stage. `pipeline_report`, `source_report`. The day-by-day history is demo data.

The funnel is drawn as a row of isometric blocks, one a stage, a dot a person. Picking a block lists that stage's people under it, the same way a picked day lists who came in.

Each chart has a control at the right of its heading that hides its people. With both hidden, the two charts size themselves to the window so the page fits one screen.

### Triage
| Tool | In the UI |
|---|---|
| `list_applications_inbox` | The queue: Referred, Applied, Sourced |
| `get_candidate`, `list_files`, `get_file_link` | The resume reader and the application pane |
| `update_stage` | Interview and Decline in the bottom bar |
| `list_rejection_reasons` | The reasons Decline asks for |
| `draft_email`, `send_email` | The drafted reply in the bottom bar |
| `add_candidate` | New Candidate (hidden: ⌘K or the compose icon) |
| `add_note` | The grade: confidence 1 to 5 and a comment, saved as a note on the person |
| Declined applicants | Revisit tab: everyone you passed on, surest first, with Reopen. Kept in the app for now; tATS would need to return declined applicants with their grade |
| Testbench attempt | The reader's Testbench page, laid out as the Testbench staff dashboard: Tests against your bar, the triangle beside the team median or another applicant, the three readings with their charts, the path through the session, recordings and activity. tATS stores the invite and attempt id; these results are demo data until Testbench is read |

### Tickets
| Tool | In the UI |
|---|---|
| Bot tasks (`bot_tasks`, reported by the company's bot) | The list, by status, and the panel's steps |
| Bot commands: retry, nudge, send invite, cancel | The buttons at the foot of a ticket |
| `list_my_approvals` | The Approvals group at the top |

### People and the candidate view
On a team, People opens with that team's blocks: everyone in process by stage, a dot a person. Pointing at a dot shows who it is, their role and next step; clicking a block shows only that stage.

The candidate view is laid out like Triage: the reader in the centre (Resume, Testbench, then Interviews, Activity, Emails, Offer as tabs) and what is known about them on the right.

The summary line is `people.summary`, which `get_candidate` already returns. Nothing in the client tools writes it today (`update_candidate` takes education, title, company and location only), so having the bot write summaries would need that one field added.

| Tool | In the UI |
|---|---|
| `get_pipeline`, `search_candidates` | The People list; search in ⌘K |
| `update_stage` | The stage menu on a candidate (move, hired, withdrawn, reject with a reason) |
| `set_next_action` | The Next line: click and type |
| `update_candidate` | Owner menu |
| `get_activity`, `add_note` | Activity tab |
| `list_emails`, `draft_email`, `send_email`, `list_email_templates` | Emails tab: one chain per conversation (the invitation to each round and its replies), the latest open, with Reply In This Chain and Template |
| `get_offers` | The Offer row on a candidate, which opens the Offers page |
| `get_feedback`, `get_scorecard` | Interviews tab: each interviewer's call and ratings |
| `tag_candidate`, `untag_candidate`, `list_tags` | Tags on the candidate |
| `set_custom_field`, `list_custom_fields` | The extra rows under Source |
| `add_file`, `list_files`, `get_file_link` | Files on the candidate. Click one to read it in place |
| `add_to_pool`, `list_pools` | Hidden: the "…" menu on a candidate |
| `find_duplicates`, `merge_candidates` | Hidden: the "…" menu |
| `anonymize_candidate` | Hidden: the "…" menu |
| `list_pool`, `add_prospect`, `convert_prospect`, `remove_from_pool` | People, Prospects tab |
| Referrals | People, Referred tab |
| `add_to_pool`, `set_next_action`, `update_candidate` | People, Check In tab: who to look at again, when, and where they work now. A job change shows as "New job", with the old one under it |

### Interviews
The interview rounds as blocks now sit at the top of Tickets, not here.

| Tool | In the UI |
|---|---|
| `list_my_interviews` | List and Week |
| `submit_feedback`, `get_scorecard` | The feedback form on an interview you owe |
| `get_interview_notes` | Meeting Notes on an interview |
| `find_interview_times`, `schedule_interview` | Schedule |
| `update_interview` | Reschedule and Cancel |
| `interviewer_activity`, interviewer limits | Each interviewer's "2 of 5 this week" and "Away through" |

### Interview rounds and setting up
The rounds builder is a pop-up: rounds to add on the left, the flow in the middle ending in a decision with Offer and Decline, and the picked round's details on the right. One process for the company, and a branch for any team that differs (`get_interview_plan`, `set_interview_plan`). It opens from the setup card on Home, from Settings, Rounds, and from Edit Rounds on Tickets.

Its Ask Claude tab gives the words to say to Claude or the company's bot, which hold the connector and can save the rounds themselves. Nothing in this prototype calls them.

Home has a "Finish Setup" button in its top right corner, with a menu of the steps, until every step is done: connect Claude or the bot, build the rounds, invite the team, post a role. tATS has a fuller onboarding (people, teams, process, interview skills); the skills sheet is not here.

### Offers
An offer has its own page, not a tab on the candidate: the letter and contract in the middle, the terms and sign-off steps on the right, the one next step in the bar under the letter.

| Tool | In the UI |
|---|---|
| `get_offers`, `create_offer`, `update_offer` | The list, New, the terms, Send, They Signed / Declined, Withdraw |
| `request_approval`, `list_my_approvals`, `get_approval_flow` | Request Sign-Off, Sign Off / Send Back, the Sign-Off steps |
| `get_interview_notes` | What They Said |

The letter is the company's own form (a California employee offer letter), clause for clause. The app fills company, date, name, title, manager's title, duties (from the job post), salary, equity, start and expiry; an empty blank shows in yellow and is a field on the right. Any clause can be rewritten for one offer, and put back. After sign-off it goes out through DocuSign.

Not in tATS today, and needed for this to be real: fields on the offer for shares, stock plan, expiry, pay period, address and rewritten clauses; turning the letter into a PDF; a DocuSign connection that creates the envelope and reports viewed, signed or declined back. Here "Send Through DocuSign" and "They Signed" only change the offer's state. Attachment A (the confidentiality agreement) is a placeholder page.

### Listings & Asks
The list is the careers page: roles by department, with a "+" on hover to add one. A role opens as its
public post, with Edit and Preview As Applicant.

| Tool | In the UI |
|---|---|
| `list_jobs`, `create_job` | The list, Add A Role, the "+" on a department |
| `update_job` | Title, Location, Department and Compensation on the role; Open / Closed under Internal |
| `list_job_posts`, `create_job_post`, `update_job_post` | Overview (about, what you'll do, you might be a fit if) and Application (the questions asked) |
| `set_job_post_status` | Draft / Live / Closed, top right of a role |
| `get_scorecard`, `set_scorecard` | Internal: Looking For |
| `get_interview_plan`, `set_interview_plan` | Internal: Interview Plan |
| `get_hiring_team`, `add_to_hiring_team`, `remove_from_hiring_team` | Internal: Hiring Team |
| `list_openings`, `add_openings`, `close_opening` | Internal: the "0 of 2 filled" menu |

The description is one document you type into anywhere (Enter for a new line, "- " for a list, "# " for a
heading), or fill by pasting or importing a text or Markdown file. Extra details on the left (Employment Type,
Workplace, Level and any you name) are the job's custom fields: `set_custom_field`, `create_custom_field`.
A checklist on a new role says what is still missing and whether it is required, suggested or optional.

Unconfirmed against tATS: a compensation field on the job, and whether a job's custom fields can be shown on the public post.

### Settings (all hidden)
| Tool | Section |
|---|---|
| `whoami` | General |
| `list_team`, `set_member_access`, `invite_member`, `list_invites`, `withdraw_invite` | Members |
| Interviewer profiles: preference, weekly limit, away, focus | Interviewers |
| `list_departments`, `list_offices`, `create_office`, `update_office` | Teams |
| `list_email_templates`, `create_email_template`, `update_email_template` | Templates |
| `create_tag`, `archive_tag`, `create_pool`, `archive_pool`, `list_rejection_reasons` | Labels |
| `create_custom_field`, `update_custom_field` | Fields |
| `get_approval_flow`, `set_approval_flow` | Approvals |
| Bot webhook, calendar, mailbox, Granola, Testbench | Integrations |
| `get_connector_settings`, `set_connector_access` | Connector |

### Insights (hidden)
| Tool | In the UI |
|---|---|
| `pipeline_report` | Pipeline, with pass-through per stage |
| `source_report` | Sources |
| `time_to_hire` | Time To Hire |
| `interviewer_activity` | Interviewer Load |
| `offer_report` | Offers |
| `rejection_report` | Rejections |
| `eeoc_report` | Equal Opportunity, totals only |
| `list_job_posts` (views, applications) | Job Posts tab: views, applied and rate per post |

## Not surfaced, on purpose

| Tool | Why |
|---|---|
| `add_contact` | A company contact, not a candidate. No place for it without a companies view. |
| `create_department`, `update_department` | Departments show in Settings but are read-only here; they are set up at onboarding. |
| `record_eeoc` | Filled in by the applicant on the public form, never by a member. |
| Public careers page and application form | Applicant-facing, outside this app. Asks links to the post. |
| Home widgets, saved views, the tutorial | tATS pages this design replaces with Tickets, team scoping and ⌘K. |

## Checklist: things I would add, not built

These are not in tATS today, or need a decision. None of them are in the UI.

Done since: resume in the candidate view (files open in the same reader Triage uses).

- [ ] **Review-then-send for email.** tATS writes a draft, shows it, then sends. Here Send is one step.
- [ ] **Real Testbench results.** tATS stores the invite and attempt id; the score and highlights shown are demo data.
- [ ] **Bot ranking of teams for a referral.** The UI shows it, but nothing makes the bot read a resume against the asks yet.
- [ ] **Per-team match list.** A bot task carries step labels only; "what matched" has no field.
- [ ] **Interviewer asks grouped under a ticket.** Assumed joinable by application; unconfirmed.
- [ ] **Bulk actions.** Select several rows in People or Triage and move, tag or decline them together.
- [ ] **Keyboard list navigation.** J / K to move through rows, as tATS has; only ⌘K, ⌘↵ and the Triage keys exist here.
- [ ] **Saved views.** Named filters on People (stage, source, tag).
- [ ] **Undo.** A toast with Undo after a stage move, decline or send.
- [ ] **Team switcher on a phone.** The phone bar opens ⌘K, which lists teams, but there is no persistent switcher.
- [ ] **Filter and sort on lists.** Lists group by status only.
- [ ] **Headcount plan.** Openings exist; a plan to compare them against does not.
- [ ] **Bulk import.** Spreadsheet or sourcing export into Triage.
- [ ] **Suspicious-application flag.**
