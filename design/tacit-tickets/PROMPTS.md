# Working on this with a model

How to get work at the level of this app from a coding model, whichever one it is. Written for whoever picks this up next.

## Why this file exists

The quality here did not come from one good prompt. It came from about seventy short requests, each followed by looking at the result and correcting it. `DESIGN.md` holds those corrections so they do not have to be made twice. This file holds the way of asking.

## Set up once

1. Open the session in this folder. `CLAUDE.md` loads by itself and pulls in `DESIGN.md` with it, so the rules are in front of the model from the first message without being pasted.
2. Give the model a browser it can drive, pointed at `pnpm dev`. Most fixes in this app came from looking at the running page.
3. The reference pictures are in `reference/`, with a note on each in `reference/README.md`. The pictures stay on your machine; only the notes are in git.

## The first message of a session

```text
Read CLAUDE.md, DESIGN.md and COVERAGE.md, then src/kit.tsx.
Tell me in five lines what the rules are before you change anything.
```

Having it say the rules back catches a model that skimmed.

## Asking for a change

Small, concrete, one thing. Name the screen, say what is wrong or wanted, and stop.

```text
On Tickets, the round blocks have no colour. Colour them by the same rule
as Home, so a person is the same colour on every page.
```

```text
In Triage, add a minimize button to the reply card so it does not take up
most of the screen.
```

What made requests land:

- **Point at the exact thing**, by its words on screen: "the box that says Infrastructure LP Luca".
- **Say what bothers you**, not how to fix it: "it moves around, find one fixed place for it".
- **Attach a screenshot** when it is about how something looks.
- **Give the reason** when there is one: "so they can come back and review that applicant later".

## Asking for something new and visual

Ask for options, in the running app, and choose.

```text
I want one graphic on Home that shows everyone in process by stage.
Build four real variants in the app, following DESIGN.md section 9.
Show me each in the browser. I will pick one and you will delete the rest.
```

Then, once chosen:

```text
Keep the blocks. Remove the others. Under it, list who is in the picked
block, the same way the activity map lists who came in on the picked day.
```

## Asking for a dashboard, report or artifact

```text
Make a one-page hiring report for <team>, as an artifact.
Follow DESIGN.md: same greys, same four status colours and meanings,
same type. Start from these questions, one chart each:
1. Where are people getting stuck?
2. Who needs a decision this week?
Open on the finding. No cover, no overview paragraph. Light and dark.
Use only data tATS returns today; list anything missing.
```

## Asking for a component that already exists

Give the install command, not a picture of it.

```text
Add a loading skeleton to Triage. Install it, do not draw it:
pnpm dlx shadcn@latest add https://www.affectui.com/r/skeleton-clean.json
Wrap it in src/kit.tsx and give it the app's greys.
```

A screenshot is for the manner of a thing. A command is for the thing itself.

## Correcting

Correct in one line and let it fix. Then make the correction permanent:

```text
Add that to the table in DESIGN.md section 2, with the wrong and right
example, and apply it everywhere it already occurs.
```

A rule that is not written down will be broken again in the next session.

## Finishing

```text
Run lint, typecheck and build. Open it at 1280x720 and 1440x900, in light
and dark. Tell me what you checked and what you did not.
```

## What a weaker model needs more of

- **Smaller steps.** One screen per request. Asking for a whole area at once is where consistency goes.
- **The nearest example named.** "Build it the way `src/views/triage.tsx` is built."
- **The rules said back** at the start of each session.
- **More looking.** Ask for a screenshot after every visual change.
- **You, choosing.** It will produce acceptable options; it will not reliably pick the best one.

## References

`reference/README.md` has a note on each of the 29 pictures: what it shows, what this app took from it, and what to leave. Without that note a model copies the wrong part. The other sources, which are not pictures in that folder:

| Reference | Take | Leave |
|---|---|---|
| Linear | Density, grey structure, one type size, in-place actions, command menu, quiet motion | Its brand colour, its exact layouts, its icons |
| The existing tATS (`apps/web`) | What the product can actually do; the names of things | Its visual style |
| Testbench staff dashboard | Which readings matter for an attempt: tests against the bar, the triangle, the path through the session | Its layout |
| A node-based workflow builder | A flow as cards joined by lines, with an inspector at the side | Anything that implies branching the product does not have |
| A pitch-deck funnel | The idea of a funnel that narrows | The glossy rendering |
| A standard employee offer letter form | The clauses and the blanks to fill | Nothing; check the form's own terms before reuse |
| Claude's home screen | A greeting with the mark beside it, changing each visit | Everything else |

The components in `src/components/ui` (empty state, skeleton, thinking loader) and `src/components/arc` (resizable panels, avatar group) came from public registries and are used as they came.
