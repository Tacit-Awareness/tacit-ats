# tats

Your company's hiring workspace in [Tacit](https://tacitawareness.com), from the terminal, for you and for your coding agents (Claude Code, Codex, Cursor, and any agent that can run commands). Every tool in the Tacit connector for Claude is a `tats` command: jobs, candidates, pipelines, interviews and feedback, offers, approvals, candidate email, reports.

You need an invitation to your company's Tacit workspace.

## Install

```sh
npm i -g @tacitawareness/tats
tats agent setup
```

`tats agent setup` finds Claude Code, Codex and Cursor on your machine and gives each a skill, so they use `tats` for hiring questions on their own, then signs you in in your browser. (`npx @tacitawareness/tats agent setup` does the same and installs `tats` for you. `tats setup` is the same command.)

## Use

```sh
tats whoami
tats list-jobs
tats search-candidates --query "Alex Rivera"
tats update-stage --application-id <id> --stage interviewing --yes
tats help update-stage
tats tools
```

Add `--json` for machine-readable output. Commands that change something important (moving a candidate, sending email, offers, approvals) refuse to run without `--yes`; at a terminal they ask instead.

## For AI agents

Run `tats agent` first. It explains how to call `tats`, what to confirm with the user, and Tacit's own rules.

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

Requires Node 20 or later.
