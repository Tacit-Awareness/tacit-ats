# The master prompt

The original prompt that started this app, what it left for later, and one prompt that carries all of it from the first message. Every prompt as typed is in `PROMPT_LOG.md`.

## What the original prompt did well

It is worth keeping these; they are why the first pass was a usable start.

- **It named a reference to match:** "looks exactly like linear".
- **It stated the taste in one line:** "the less words & marking as possible the better".
- **It gave real context:** a full meeting about how the bots and people work together, not a feature list.
- **It gave install commands** for a component instead of describing one.
- **It said what to build first:** the list of tickets, where a ticket is where a person is in the process.
- **It said what not to copy:** "Don't use what tATS looks like right now."

## What it left out, and what that cost

Each line below took follow-up prompts to fix. The last column is a rough count from reading the 84 follow-ups in `PROMPT_LOG.md`, not an exact tally.

| Missing from the original | What happened | About |
|---|---|---|
| "Use only what the backend already does" | Features were designed that Ryan would have had to build, then walked back | 3 |
| What colour means | Colours were decorative, then confusing, then rebuilt around four meanings | 7 |
| Rules of finish (no dot separators, no applicant avatars, one heading size, no focus box, no scrollbars) | Each was noticed and removed one at a time | 10 |
| "Act in place, do not redirect" | Triage sent people to other pages; rebuilt to solve things where they are | 2 |
| How the pages relate | Tickets, Triage and People overlapped; the navigation was restructured late | 4 |
| "Show me options for anything visual" | The funnel was redrawn several times before four variants were asked for | 6 |
| "Look at it in the browser yourself" | Had to be asked for more than once | 3 |
| Both themes, loading and empty states | Added afterwards as separate requests | 4 |
| Where things must fit | Charts and the offer letter were resized after the fact | 4 |

The rest of the follow-ups were new features, which no first prompt could have listed, and that is fine. The point of the master prompt is to remove the rework, not the conversation.

## The master prompt

Paste this as the first message of a new project. Fill the parts in square brackets. Keep it this short: the rules live in `DESIGN.md`, which the session loads with `CLAUDE.md`, so they do not need repeating here.

```text
You are designing and building [what it is] for [who uses it].

CONTEXT
[Paste the meeting notes or transcript that explain the workflow. Real
context beats a feature list.]

The existing product is at [repo or path]. Read it to learn what it can
already do and what things are called. Do not copy how it looks.

WHAT TO BUILD FIRST
[The one module that matters most, in two or three sentences. Say what
the unit is: for example, "each row is where one person is in the
process".]
Build that one screen to a finished standard before starting another.

THE MANNER
Follow DESIGN.md exactly. In short: it should feel like Linear. The less
on screen the better. Grey for structure, colour only for status, and a
colour means the same thing everywhere. One text size for body, one for
headings. If something needs a decision, the controls are on the thing
itself; never send me to another page to finish it.

HARD LIMITS
- Use only what the backend already returns. If a design needs a new
  field, tool or write, stop and list it in COVERAGE.md. Do not build
  screens that assume it.
- Every screen works in light and dark, has a loading skeleton and an
  empty state, and is reachable from the command menu.
- All data is placeholder. No real people.

COMPONENTS
Install, do not redraw. Use these as they come and wrap them:
[pnpm dlx shadcn@latest add <address>, one per line]
If a component you want is in a registry, ask me for its command
instead of building it from a picture. The pictures in reference/ are
for the manner only; reference/README.md says what to take from each.

HOW TO WORK
- One screen or one change at a time.
- For anything visual and new, such as a chart, a graphic or a layout,
  build three or four real variants in the running app and show me. I
  will choose; then delete the rest.
- Start every graphic from the question it answers. Draw one mark per
  person where you can. Every mark can be pointed at and clicked. What
  is picked is listed directly underneath in the same colours.
- Open the result in the browser yourself before telling me it is done.
  Measure spacing and fit; do not estimate. Check 1280x720 and 1440x900.
- When I correct something, fix it everywhere it occurs and add it to
  the rules table in DESIGN.md with a wrong and a right example.
- Change only what I asked. Keep what already works.

WHEN YOU FINISH A STEP
Run lint, typecheck and build. Tell me what you checked, what you did
not check, and anything that would need backend work.

Before you write any code, tell me in five lines what you understood
the rules to be, and name the first screen you will build.
```

## The follow-up prompts, tuned

The same requests that worked here, in the form that needed the fewest rounds. Each pairs with a pattern seen in the log.

**Point at the thing by its words, and say what bothers you.**

```text
In Triage, the box that says "Infrastructure, LP, Luca" moves whenever
the text beside it changes length. Give it one fixed place.
```

**Remove, do not rearrange.**

```text
On a job post, "9 applied, 310 views, Copy Link" does not belong there.
Move the numbers to Insights and take the line out.
```

**Ask for a rule, not a fix.**

```text
Remove every dot separator in the app. Add that as a rule in DESIGN.md
so it does not come back.
```

**Ask for consistency by naming the source of truth.**

```text
The blocks on Tickets have no colour. Use the same rule as Home, from
one place in the code, so a person is the same colour on every page.
```

**Ask for options when it is visual.**

```text
The funnel looks flat. Build four real versions in the app: shading,
depth, a different shape, and one of your own. Keep the reading
direction, top left to right. I will pick one.
```

**Give the command when a component exists.**

```text
Loading should show a skeleton. Install it:
pnpm dlx shadcn@latest add https://www.affectui.com/r/skeleton-clean.json
Wrap it and give it the app's greys.
```

**State the fit you need, in numbers.**

```text
With the people tiles closed, both Home charts must fit one screen with
no scrolling, from 1280x720 up. Measure it at four sizes.
```

**Ask what is missing before you ship.**

```text
Is there any part of the old product this design does not cover yet?
List it against COVERAGE.md.
```

**Protect the backend.**

```text
Compare this UI with what the product can do today. Did we add anything
that would need new backend work? List each one; do not build around it.
```

**Close out.**

```text
Push this as a pull request. Run every check first and fix what fails.
Then confirm the branch matches my local copy file for file.
```

## Using this with a different model

- Send the master prompt once, then one follow-up at a time.
- If the model is weaker, shorten each step and ask for a screenshot after every visual change.
- Do not paste the whole prompt log into a session. It is a record, not instructions; the lessons from it are already in `DESIGN.md` and in the prompt above.
