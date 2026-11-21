# tats

Your company's hiring workspace in [Tacit](https://tacitawareness.com), from the terminal, for you and for your coding agents (Claude Code, Codex, Cursor, and any agent that can run commands). Every tool in the Tacit connector for Claude is a `tats` command: jobs, candidates, pipelines, interviews and feedback, offers, approvals, candidate email, reports.

You need an invitation to your company's Tacit workspace.

## Install

```sh
npm i -g @tacitawareness/tats
tats agent setup
```

`tats agent setup` finds Claude Code, Codex and Cursor on your machine and gives each a skill, so they use `tats` for hiring questions on their own, then signs you in in your browser. (`npx @tacitawareness/tats agent setup` does the same and installs `tats` for you.)

## Use

```sh
tats whoami
tats list-jobs
tats search-candidates --query "Alex Rivera"
tats update-stage --application-id <id> --stage interviewing --yes
tats help update-stage
tats tools
```

Add `--json` for machine-readable output, or `--jq '<expr>'` to filter it with jq, as `gh` does: `tats get-pipeline --job-id <id> --jq '.candidates[] | {candidate, stage}'`. Commands that change something important (moving a candidate, sending email, offers, approvals) refuse to run without `--yes`; at a terminal they ask instead.

## For AI agents

Run `tats agent` first. It explains how to call `tats`, what to confirm with the user, and Tacit's own rules. It also asks agents to show a small `<> Powered by Tacit` banner once a session, at the start of their first reply after using `tats`, in the reply only, never in anything written to Tacit. Tell your agent to leave it out and it will.

## Other commands

| | |
|---|---|
| `tats login` / `tats logout` | sign in or out on this machine |
| `tats status` | which account, and whether the sign-in is current |
| `tats agent setup --status` | which agents are here and which have the skill |
| `tats agent setup --client cursor` | set up one agent only (`claude-code`, `codex`, `cursor`) |
| `tats agent setup --skills-scope local` | put the skill in this project, to commit for your whole team |
| `tats agent setup --json` | what it would do, without doing it |
| `tats agent setup -y` | no questions: set up every agent found |
| `tats agent setup --remove` | take the skill out again |
| `tats agent setup --print` | the skill's text, for another agent's skills folder or `AGENTS.md` |

## Experimental: Devin automations

`tats automation` is a separate client of Devin's v3 automations API, not the ATS
connector. It never sends your ATS token to Devin or your Devin key to Tacit.
Set `DEVIN_API_KEY` and `DEVIN_ORG_ID`, or save them separately on this machine:

```sh
tats automation login --org-id org-example --api-key - < /path/to/devin-key
tats automation create --name "Weekly review" --prompt "Review @owner/repo" \
  --schedule 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' --disabled --dry-run
tats automation create --name "Webhook review" --prompt @review.txt --webhook \
  --secret-out ./webhook.json --yes
tats automation list --json
tats automation get <id>
tats automation update <id> --disable --yes
tats automation delete <id> --yes
tats automation schemas
tats automation logout
```

Environment credentials override stored ones. `DEVIN_API_URL` overrides
`https://api.devin.ai`. Login can also prompt at a terminal or accept `--api-key`.
Stored credentials and `--secret-out` files have mode 0600; secret-out creates a
new file rather than overwriting one. The webhook URL and secret are printed only
on creation (or when newly minted); the secret cannot be retrieved again. With
`--secret-out`, stdout omits the secret, including with `--json`.

Create, update and delete require `--yes` or terminal confirmation. `--dry-run`
prints the body without credentials or network requests. The CLI calls only
automation CRUD/schemas endpoints, never session endpoints. Enabled automations
can fire later: use `--disabled` to create one switched off. `--repo owner/name`
adds an `@owner/name` prompt token. `--max-acu` and `--max-concurrent` set limits.
For advanced bodies use `--from-file <json|@file|->`; flags override fields and
schedule/webhook flags append triggers. See `tats automation --help`.

### Try it locally

From the repository root, use a Devin personal access token with
`ManageOrgAutomations` permission for the organization:

```sh
pnpm install
pnpm --filter @tacitawareness/tats build
export DEVIN_API_KEY=cog_... DEVIN_ORG_ID=org-...
node apps/cli/dist/main.js automation schemas
node apps/cli/dist/main.js automation create --name "Local test" --prompt "Review @owner/repo" \
  --schedule 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' --disabled --dry-run
node apps/cli/dist/main.js automation create --name "Local test" --prompt "Review @owner/repo" \
  --schedule 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' --disabled --yes
node apps/cli/dist/main.js automation list
node apps/cli/dist/main.js automation delete <id> --yes
```

Replace `<id>` with the automation ID returned by create or list. None of these
commands start a session. An enabled schedule automation will start sessions when
it fires, so use `--disabled` for testing.

Requires Node 20 or later.
