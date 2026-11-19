# Tacit design system

How this app is designed, and how to design the next thing so it belongs beside it. Read this before changing or adding any screen, chart, dashboard or artifact.

Everything here is taken from the code in `src/`. Where the code and this file disagree, the code is right and this file needs fixing.

## 1. The idea

The app is a tracker for recruiting. A bot does the coordination; a person opens the app to see where things stand and to act on the few things that need them.

That gives one test for every decision: **does this help someone see what needs them, and act on it, faster?** If not, it goes.

The manner is borrowed from Linear, as we read it. These are our working rules, not Linear's own documentation:

1. **Less is the default.** A screen opens on its content. No summary banners, no helper paragraphs, no decoration. If a number or label can be removed and nobody would ask where it went, remove it.
2. **Grey carries structure, colour carries meaning.** Surfaces, lines and text are greys. Colour appears only to say something about status, and always says the same thing.
3. **One size, one weight, per job.** Body text is one size. Headings are one size. Hierarchy comes from weight and from grey, not from a ladder of font sizes.
4. **Dense, aligned, calm.** Rows are short and line up on a shared grid. Space is used to group, not to pad.
5. **Act where you are.** If something needs a decision, the controls are on the thing itself. Never send the reader to another page to finish what they started here.
6. **Keyboard first.** Everything is reachable from the command menu and by a short key sequence.
7. **Motion explains, then gets out of the way.** Short, eased, and only where something changes place or state.

## 2. Rules that were learned the hard way

Each of these was a correction during the build. They override taste.

| Rule | Wrong | Right |
|---|---|---|
| No dot separators | `Infrastructure · LP Luca` | Two elements with space between, or a comma in a sentence |
| Labels in Title Case | `Send for sign-off` | `Send For Sign-Off` |
| Sentences in sentence case | `36 In Process Now` | `36 in process now` |
| No avatars or initials for applicants in Triage | A coloured circle with "RD" | The name alone |
| One heading style | A 20px title here, 14px there | `heading` from `src/kit.tsx` everywhere |
| No stray stats | "9 applied, 310 views, Copy Link" on a job post | Numbers live in Insights |
| Solve in place | A Needs You item that jumps to another page | It opens inside Triage with the same controls, plus a link out |
| Controls stay put | A team picker that moves as content changes | One fixed place for it |
| No focus box on text fields | A ring round the search field | The caret only; buttons and links keep their ring |
| No visible scrollbars | A bar on the right of a pane | `.scroll-quiet` |
| Flat tints on tiles | A gradient on a person's tile | `.tint-*`, one flat low-opacity colour |
| Colour a block only when it needs you | Every funnel block tinted | A block is tinted only for red or amber; dots carry each person's colour |
| Say what colour means | Coloured dots with no key | `ToneLegend` beside any coloured chart |
| Neighbouring categories must not share a colour | Onsite and Round 3 both violet | Distinct, or no colour at all |
| Shortcut hints are spelled out | `G K` | `G then W`; `⌘K` on Mac, `Ctrl K` elsewhere (`mod()` in `src/ui.tsx`) |
| Setup is a button, not a card | A "Finish setting up" card in the page | A button in the top right corner that goes away when done |
| Loading shows the shape | A spinner | A skeleton (`Bone`, `Loading`) in the layout that is coming |
| Empty shows a way forward | A blank pane | `Empty` with an icon, a title, one line |
| No em dashes in interface copy | `Draft — not sent` | `Draft not sent` |

And one product rule above all of them:

**Do not invent backend work.** Use what tATS already returns. If a design needs a field, a tool or a write that does not exist, stop and record it in `COVERAGE.md` under what would need backend work. Do not quietly build UI that assumes it.

## 3. Colour

### Greys

Defined in `src/index.css`. Dark is the default; `<html data-theme="light">` switches. Use the Tailwind names, never raw hex.

| Token | Use | Dark | Light |
|---|---|---|---|
| `well` | The box the whole app sits in | `#0b0b0c` | `#f4f5f8` |
| `panel` | Any page or pane | `#111112` | `#ffffff` |
| `raised` | Selected row, pressed tab, chips | `#1a1a1c` | `#eef0f4` |
| `hover` | Hover, quiet fills | `#161618` | `#f6f7f9` |
| `line` | Dividers inside a pane | `#1f1f21` | `#e9ebef` |
| `line-strong` | Borders of cards, inputs, buttons | `#2a2a2d` | `#d6d9df` |
| `ink` | Headings, names, values | `#ededec` | `#16171a` |
| `body` | Running text | `#b6b6b3` | `#3a3d44` |
| `mute` | Secondary text, labels | `#8a8a87` | `#62656e` |
| `faint` | Tertiary text, placeholders, icons at rest | `#5d5d5b` | `#8a8d96` |

Four steps of text grey is the whole range. If you want a fifth, the hierarchy is wrong.

### Status colour

One meaning each, everywhere: rows, dots, tiles, blocks, charts.

| Tone | Means | Token | Dark | Light |
|---|---|---|---|---|
| `needs` | Waiting on you | `s-needs` | `#dcbf8e` | `#b98a35` |
| `failed` | Overdue, failed, rejected | `bad` | `#dfa3a3` | `#c8615a` |
| `waiting` | Waiting on someone else | `s-routing` | `#a7b3e6` | `#6276c9` |
| `running` | Moving, nothing to do | `s-scheduled` | `#9ccdb3` | `#3f9a6c` |
| done | Finished | `s-done` | `#6f6f6c` | `#a3a6ae` |
| cancelled | Passed on | `s-passed` | `#4a4a48` | `#c3c6cd` |

The colours are muted on purpose. They sit on grey without shouting, and importance reads from red to amber to blue to green.

How colour is applied:

- **A row** gets a soft wash from the left: `.wash-needs`, `.wash-failed`, `.wash-waiting`, `.wash-running` (`wash(status)` in `kit.tsx`).
- **A tile** for a person gets a flat tint: `.tint-*`.
- **A dot** is the full colour: `TONE_COLOR[tone]`.
- **A block** holding many people is tinted only by `worst()`: red if anyone is overdue, else amber if anyone needs you, else plain.
- **A person's tone** comes from one place, `s.toneFor(person)` in the store. It reads their own standing and their open tickets. Never work it out again locally, or the same person will be two colours on two pages.
- **Gold** (`.wash-gold`, `.text-gold`) is for approvals only. It is the one place a row is allowed to shine.
- **Intensity** for a quantity uses one hue in steps, as the activity map does: `bg-raised`, then `bg-s-scheduled` at 25, 45, 70 and 100 percent.

Anything not about status stays grey. There is no brand accent inside the box.

### The shell

The app is one rounded box (`.tb-box`, 16px radius) on a sky gradient with a faint grain. Night sky in dark, day sky in light. The sky is the only decoration in the product; nothing inside the box competes with it.

## 4. Type

Inter Variable, set on `body`: 13px, line height 1.4, weight 450, tracking -0.006em, features `cv01` and `ss03`.

| Job | Style |
|---|---|
| Body, rows, buttons | 13px, weight 450, `text-body` or `text-ink` |
| Heading of a card, pane or section | `heading`: 15px, semibold, tracking -0.01em, `text-ink` |
| Small label above a group | `label`: 12px, `text-faint` |
| A name or value that matters | 13px, `font-medium text-ink` |
| Numbers | `tabular-nums` always |
| The Home greeting | 34px semibold, tracking -0.03em. The single exception, because it is a welcome and not a heading |

A heading that carries a number states it in a sentence: "443 applications in 2026", "36 in process now". Same size, same weight as every other heading.

## 5. Space, shape and layout

- **Radius:** 3px for map squares, `rounded-md` (8px) for small controls, `rounded-lg` (10px) for inputs, tiles and buttons, `rounded-xl` (14px) for cards and dialogs, 16px for the box.
- **Row heights:** 28px (`h-7`) for compact controls and tabs, 32px (`h-8`) for buttons and inputs, 40 to 48px for list rows.
- **Card:** `rounded-xl border border-line-strong px-5 pt-4 pb-5`. A card has a border and no shadow. Shadows are for things that float: menus, dialogs, tooltips.
- **Page:** a `main` that is `rounded-lg border border-line bg-panel`, inside the box, beside the sidebar.
- **Three-pane work view** (Triage, the candidate view, Offers): list on the left, the document in the centre, what is known and what to do on the right. Panes resize and fold; sizes are remembered.
- **Width is by container, not by window:** `@container` on the page and `@2xl:`, `@5xl:` on its children, so a pane behaves the same whether it is narrow because the window is small or because a neighbour is open.
- **Fit the screen when you can.** If a dashboard can show everything without scrolling, size it from the height that is left, as Home does when its tiles are closed.

## 6. Components

Reach for these before writing anything new. They are in `src/kit.tsx` and `src/ui.tsx`.

| Need | Use |
|---|---|
| Page top bar with tabs | `Header` |
| A button | `Btn` (`solid` for the one primary action in view) |
| An icon button | `IconButton` with a `label` |
| Any dropdown or picker | `Menu` |
| A modal | `Dialog` |
| Two to four exclusive choices | `Segmented` |
| A text field | `Field` |
| An on/off | `Toggle` |
| Nothing to show | `Empty` |
| Loading | `Bone`, `Loading` |
| Status mark with its meaning on hover | `StatusIcon` |
| A team | `TeamTile` |
| A staff member | `Person`, `Avatar` (staff only, never applicants in Triage) |
| A keyboard hint | `Kbd`, `mod()` |
| The key to the colours | `ToneLegend` |
| People by stage as blocks | `Funnel` in `src/views/funnel.tsx` |
| A long document to edit | `DocEditor`, `DocView` in `src/views/doc.tsx` |
| A PDF | `src/pdf-reader.tsx` |

`src/components/ui` and `src/components/arc` hold components installed from registries. Use them through the wrappers above and do not edit them.

Icons are `lucide-react`, 13 to 16px, `text-faint` at rest and `text-ink` on hover. One icon per control. No icon where a word is clearer.

## 7. Motion

| What | How |
|---|---|
| Something appears | `.anim-rise`: 240ms, up 4px, `cubic-bezier(0.22, 1, 0.36, 1)` |
| A panel comes in from the side | `.anim-slide`: 260ms |
| Changing page | View transition: old fades in 140ms, new in 260ms. The sidebar holds still |
| Opening and closing a section | Height by `grid-template-rows` 0fr to 1fr with opacity, 300ms, same easing |
| Hover and press | `transition-colors`, about 150ms |
| A funnel block under the pointer | Lifts 8px, 260ms |

One easing curve for everything that moves. Everything is off under `prefers-reduced-motion`. Nothing loops except the gold glint on approvals.

## 8. Words

- Labels and buttons: Title Case, two or three words, a verb first when it acts ("Send Back", "Edit Rounds", "Ask Claude").
- Sentences: plain, short, sentence case. Say what is true ("Nobody came in"), not what the system did.
- No dot separators, no em dashes, no exclamation marks.
- Empty states: a title of a few words and one line that says what will appear here or what to do.
- A tooltip says what the thing means or does, in a few words.
- Never explain the interface in the interface. If a screen needs a paragraph to be understood, redesign the screen. The tutorial exists for walkthroughs.

## 9. Making the next graphic, chart or dashboard

This is the method that produced the Home page, the funnel and the Testbench report. Follow it for anything new.

**Start from the question, not the chart.** Write the one question the reader has ("where are people getting stuck?", "who came in today?"). The graphic answers that and nothing else. If you cannot write the question, there is no graphic to make.

**Prefer one strong picture over several cards.** Six stat cards were replaced by one funnel. A row of KPI tiles is almost always worse than a single chart you can read at a glance.

**Make the unit a person.** The best graphics here draw one mark per person: a dot in a funnel block, a square per day. The reader can point at a mark and see who it is, and click to open them. Aggregate only when there are too many to draw.

**Every mark is a way in.** Hover shows who or what. Click filters the page under the chart or opens the thing. A chart that cannot be clicked is a picture, and pictures get removed.

**The chart and the list under it are one thing.** Picking a block or a day lists what is in it, directly below, in the same colours. The reader never has to match a chart to a table by eye.

**Draw in the house manner.**

- Thin strokes (about 0.9px, non-scaling), panel-coloured faces, grey edges.
- Depth, if any, is isometric and plain: solid faces that hide what is behind them, as in `funnel.tsx`. No gradients, glows or drop shadows on charts.
- Colour only from the status table. A quantity uses steps of one hue.
- Labels are 13px text under or beside the drawing, aligned to it, with the count in `heading` weight above the name.
- No axes, gridlines or legends unless the reader cannot do without them. A legend, when needed, is `ToneLegend`.
- SVG with a `viewBox`, `w-full`, a `role="img"` and an `aria-label` that states the numbers.

**Keep navigation quiet.** Controls for stepping through time or changing scope are hidden until hover or focus, as the month and year steps on the activity map are.

**Let it fold.** Detail under a chart opens and closes, remembers its state, and the chart resizes so the page still fits one screen.

**Explore before you commit.** For anything visual and new, build three or four real variants in the running app, look at each in the browser, and choose. Do not pick from a description. The funnel went through four before the blocks won.

**Then check it.** Light and dark. 1280x720 up to 2560x1440. One person, zero people, far too many people. Keyboard reach. Reduced motion.

### For artifacts and documents outside the app

A report, a one-page summary or a shared dashboard should read as the same product:

- Same greys, same four status colours with the same meanings, same type scale.
- Open on the finding. No cover, no "overview" paragraph.
- One chart per question, each built by the method above.
- Tables are rows with a thin divider, no zebra stripes, no cell borders, numbers right-aligned and tabular.
- Dark and light both defined; never assume one.

## 10. Before calling anything done

1. `pnpm lint`, `pnpm typecheck` and `pnpm build` pass.
2. Open it in the browser and look. Measure with the DOM where it matters; do not trust a guess about spacing.
3. Check the rules in section 2, one by one.
4. Check both themes and at least two window sizes.
5. Update `COVERAGE.md` if a screen, a tool mapping or a backend gap changed.
6. Say plainly what you did not check.
