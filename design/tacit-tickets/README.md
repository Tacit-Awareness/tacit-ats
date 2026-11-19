# Tacit Tickets

A redesign of the client side of tATS, laid out like an issue tracker: the company's bot does the recruiting coordination and people step in where it needs them. It is a standalone Vite app on in-memory demo data. Nothing here calls the connector or `apps/web` yet.

Every person, role, resume, email and offer in it is placeholder data.

## Run it

It is its own pnpm project, outside the repo's workspace, so install from this folder:

```bash
cd design/tacit-tickets
pnpm install
pnpm dev
```

`pnpm build`, `pnpm lint` and `pnpm typecheck` all pass.

## What's in it

- **Home**: applications over the year as a map of days, and everyone in process now as a funnel of blocks.
- **Triage**: everything waiting on you. Offers to sign off, feedback you owe and stuck tickets open in place, then new applicants to route with a resume reader, the Testbench report, a grade and a drafted reply.
- **Tickets**: the bot's work by status, with the interview rounds as blocks. People, Interviews and Offers sit under it.
- **Offers**: the offer letter filled from fields, clause rewrite, sign-off and a DocuSign step.
- **Listings & Asks**: job posts and internal asks, edited as a document.
- **Rounds builder**, **Insights**, **Settings**, a command menu, a tutorial and dark mode.

[COVERAGE.md](COVERAGE.md) maps every tATS connector tool to where it lives in this UI, and lists what would need backend work before it could be wired up.

## Stack

React 19, TypeScript, Tailwind v4, Vite. Components in `src/components/ui` and `src/components/arc` were installed from registries and are kept as they came, so they are left out of lint.
