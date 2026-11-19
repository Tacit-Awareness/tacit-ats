# Tacit Tickets

A redesign of the client side of tATS as a tracker, on in-memory demo data. Standalone Vite app: React 19, TypeScript, Tailwind v4. Nothing here calls the connector or `apps/web`.

The design system is part of these instructions, loaded with this file:

@DESIGN.md

## Read first, every time

1. `DESIGN.md` (imported above): how everything here looks and behaves, the rules that override taste, and the method for new charts and dashboards.
2. `COVERAGE.md`: which tATS connector tool each screen stands for, and what would need backend work.
3. `src/kit.tsx` and `src/ui.tsx`: the shared components. Use them before writing new ones.
4. The screen closest to what you are building, in `src/views/`. Build the new thing the way that one is built.
5. `reference/README.md` when the work is visual: what each reference picture shows, what was taken from it and what to leave.

## Hard rules

- **No new backend behaviour.** Design with what tATS already returns. If something needs a new field, tool or write, stop and record it in `COVERAGE.md`. Do not build UI that silently assumes it.
- **Follow the table in `DESIGN.md` section 2.** No dot separators, Title Case labels, one heading style, no avatars for applicants in Triage, solve things in place, colour only for status.
- **Colour comes from tokens and from `s.toneFor(person)`.** Never a raw hex, never a tone worked out locally.
- **Do not edit `src/components/ui` or `src/components/arc`.** They are installed from registries. Wrap them.
- **Change only what was asked.** Keep what already works. Do not restyle neighbours or add features nobody asked for.
- **All data is placeholder.** Never put a real person's details in `src/data.ts`, `src/org.ts`, `src/profiles.ts` or `public/resumes`.

## Install, do not redraw

When a component already exists in a registry, install it with its command and wrap it. Never rebuild one from a screenshot: the picture has none of its states, motion or keyboard handling.

```bash
# An item by its registry address, as these two were added
pnpm dlx shadcn@latest add https://www.affectui.com/r/skeleton-clean.json
pnpm dlx shadcn@latest add https://www.affectui.com/r/empty-state-clean.json

# An item from a registry named in components.json
pnpm dlx shadcn@latest add @uiarc/<name>
```

Then:

1. Leave the installed file as it came, in `src/components/ui` or `src/components/arc`.
2. Give it the app's colours through its own CSS variables in `src/index.css`, the way `.ui-sklc`, `.ui-estc` and `.ui-tl` do.
3. Export a small wrapper from `src/kit.tsx` (`Bone`, `Loading`, `Empty`) and use only the wrapper in screens.
4. If you do not know an item's address, ask for it or look it up on the registry's site. Do not guess a URL.

Order of preference for anything new: a component already in `src/kit.tsx`, then a registry install, then a native browser feature, and only then new code.

## How to work

- One screen or one change at a time.
- For anything visual and new, build three or four real variants in the running app, look at them in the browser, and let the person choose.
- Look at the result in a browser before saying it is done. Measure with the DOM when spacing or fit matters. Check light and dark, and at least 1280x720 and 1440x900.
- Say plainly what you did not verify.

## Commands

```bash
pnpm install
pnpm dev         # the app
pnpm lint
pnpm typecheck
pnpm build
```

All three checks must pass before a change is finished.

## Where things are

```
src/
  index.css       tokens, themes, washes, tints, motion
  kit.tsx         shared components, tones, the heading and label styles
  ui.tsx          status icons, avatars, keyboard hints, the mark
  store.tsx       all state; go() changes page, toneFor() colours a person
  data.ts         people, roles, tasks, applicants (demo)
  org.ts          staff, teams, offers, rounds, emails, settings (demo)
  profiles.ts     what get_candidate returns for each person (demo)
  views/          one file per screen; funnel.tsx is the block chart
  components/     installed components, left as they came
```

State that should survive a reload uses `localStorage` under a `tacit-` key.
