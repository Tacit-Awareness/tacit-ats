# References

The 29 screenshots collected before Tacit Tickets was built, renamed by what they show. They are previews of components and app templates from a component library (one of them carries Affect UI's own `affect.app` address). The images are kept on this machine only and are left out of git, because they are pictures of someone else's product.

## How to use them

**They are for seeing the manner, not for redrawing.** If one of these is the component you want, install it from its registry and wrap it; do not rebuild it from the picture. See "Install, do not redraw" in `CLAUDE.md`.

Every note below says what Tacit took from the picture and what to leave. Several of these pictures break Tacit's own rules (dot separators, initials for people, sentence-case buttons). Where they do, Tacit's rules in `DESIGN.md` win.

## What they share

Looked at together, these are the manner the app follows:

- White or near-black panels with a hairline border, large radius, and almost no shadow.
- Grey text in three or four steps. Colour only on a status pill, a small dot, or one primary button.
- One line per item: a name in ink, a short grey note beside it, and a number or time at the right edge.
- Status as a small tinted pill ("Needs you", "Failed", "Done"), never a coloured row.
- A three-pane app: sidebar, list, and a detail pane that opens on the right.
- Keyboard hints drawn as small key caps at the foot of a panel.
- Charts with thin lines, no axes to speak of, and marks that carry a status colour.

## Components

| File | Shows | Tacit took | Leave |
|---|---|---|---|
| `01-answer-with-sources.png` | An answer with its sources as cards above and inline source chips | Claims that carry where they came from, as the "To Win Them" quotes carry their interview | The chips' wording and the card row |
| `02-thinking-steps.png` | A live list of steps while something works | The thinking loader used while Claude builds the rounds | Nothing; this one is installed |
| `03-people-picker-grouped.png` | A picker of people grouped by team, with keys shown at the foot | The team and person picker in Triage | The initials circles for applicants |
| `04-command-menu.png` | A command menu in sections with a shortcut on each row | The ⌘K menu and its "G then letter" hints | The third-party app icons |
| `05-file-upload-progress.png` | A drop zone and a list of uploads with progress | Importing a job description into a listing | The per-file progress bars; Tacit imports text at once |
| `06-file-upload-drop.png` | The drop zone while something is held over it | The same import, in its held state | Nothing |
| `07-setup-stepper.png` | A four-step setup form with a numbered bar | The checklist of what a new listing is still missing | The numbered bar; Tacit uses a list |
| `08-actions-and-toast.png` | A card of actions and a stacked confirmation | The toast after an action | The grid of four buttons |
| `09-agent-run-card.png` | One agent's run: what it is doing, steps done, pause and cancel | A ticket's panel: the bot's steps and the commands at its foot | The cost figure |
| `10-model-fallback-flow.png` | A request passing through attempts drawn as cards joined by lines | The Rounds builder: cards joined by lines, ending in a decision | The dotted canvas and the retry numbering |
| `13-run-cost-table.png` | A table whose rows carry a small bar on a shared scale | Bars inside rows, as on the Testbench report | The cost and token columns |
| `14-judge-bracket.png` | A bracket narrowing from many to one | The idea of a field narrowing by round | The bracket itself; Tacit uses the block funnel |
| `15-checkpoints-timeline.png` | A vertical timeline with a branch for a second attempt | A person's activity and a ticket's steps | The branching line |
| `19-agent-steps-steer.png` | Steps with a field to steer the work at the foot | The composer under a ticket, and Ask Claude in the Rounds builder | Nothing |
| `20-review-center.png` | A queue on the left, the thing to review in the centre, approve and reject with keys at the foot | Triage, and signing off an offer in place | The diff view |
| `25-pivot-table.png` | A dense table with cells shaded by value in one hue | Intensity in steps of one hue, as on the activity map | The pivot controls |
| `26-budget-vs-actual.png` | Rows with a bar against a target mark, and rows that open | "Tests against your bar" on the Testbench report | The gradient avatars |
| `27-activity-feed.png` | A feed grouped by day with tabs that carry counts | Tabs with counts, and the Activity tab on a candidate | The gradient avatars and the dot separators |
| `28-webhook-tester.png` | A form on the left and its result on the right, with a three-step progress line | The offer's sign-off steps | The code panes |
| `29-mcp-servers.png` | A list of connections, each with its state and one action | Settings, Integrations and the Connector | The context budget bar |

## Whole screens

| File | Shows | Tacit took | Leave |
|---|---|---|---|
| `11-app-schedules.png` | Sidebar, a small chart over a list, and a detail pane | The page shape of Tickets: a graphic above the list it filters | The toggles on every row |
| `12-app-chat-with-progress.png` | A conversation with a pane of progress and outputs | The right-hand pane of what is known and what was made | The chat itself |
| `16-mission-control.png` | A chart of activity, the agents at work, and a "Needs you" column | Home: one chart of activity, and Needs You as its own group in Triage | The cost figures and the agent tree |
| `17-agent-team-thread.png` | A thread beside a plan and a grid of small squares for usage | A grid of small squares as a quantity, as on the activity map | The thread |
| `18-app-settings-models.png` | A settings page: a sidebar of sections and grouped rows with a control at the right | Settings | Nothing |
| `21-app-crm-table.png` | A table of companies with coloured category pills | The People list's columns | The many pill colours; Tacit colours only status |
| `22-app-tasks.png` | Tasks grouped by project with "Needs you" pills and a detail pane with a Decide button | Tickets and its panel; the phrase "Needs you" | The pills; Tacit washes the row instead |
| `23-app-memory.png` | A grouped list with collapsible headings and a detail pane | Collapsible groups on Tickets and Interviews | The highlight sweep on a row |
| `24-app-onboarding.png` | A getting-started page with a checklist and a list of tools to connect | Setup, which Tacit reduced to one button in the corner of Home | The full-page layout and the changelog card |

## Other sources, not pictured here

- **Linear:** density, grey structure, one type size, acting in place, the command menu.
- **The existing tATS:** what the product can do and what things are called.
- **The Testbench staff dashboard:** which readings matter for an attempt.
- **A standard employee offer letter form:** the clauses and the blanks to fill.
- **Claude's home screen:** a greeting with the mark beside it.
