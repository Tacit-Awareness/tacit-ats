# Careers page prototype

A design shell for the public side of tATS: a client's careers page and the one-page application a candidate fills in. It is a single static HTML file with no backend. Nothing here is wired to `apps/web` yet; the public `/jobs/[slug]` form is what it would eventually replace.

Polymr is the example client. The roles, pay ranges and the "reading" of a resume are all placeholder data.

## Run it

```bash
python3 -m http.server 4470 --directory design/careers
```

Then open http://localhost:4470. GSAP and Inter load from public CDNs, so it needs a network connection.

## What's in it

- **Board** (`#`): open roles grouped by team (Product, GTM, Research) in a lined, collapsible list. Search is a command menu (⌘K, or Ctrl K off a Mac).
- **Role page** (`#role~<id>`): clicking a role grows the row into the role's sheet (GSAP Flip). The sheet has Overview and Application tabs. Overview has a side column of facts: location, employment type, location type, department and compensation.
- **Application** (`#role~<id>~apply`): resume drop zone, About you, Why this role (write it, turn bullet points into a note, or upload a cover letter), Questions, voluntary EEO, consent, Submit. A resume or cover letter fills every empty About you field.
- **Your application**: the side checklist replaces the facts on the Application tab. Each item ticks green with what was entered, and each step turns green when it's finished. On phones it becomes a bar at the bottom.
