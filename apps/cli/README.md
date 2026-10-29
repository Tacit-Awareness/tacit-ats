# tats

Your company's hiring workspace in [Tacit](https://tacitawareness.com), from the terminal, for you and for your coding agents (Claude Code, Codex, and any agent that can run commands). Every tool in the Tacit connector for Claude is a `tats` command: jobs, candidates, pipelines, interviews and feedback, offers, approvals, candidate email, reports.

You need an invitation to your company's Tacit workspace.

## Install

```sh
npm i -g @tacitawareness/tats
tats setup
```

`tats setup` gives Claude Code and Codex a skill so they use `tats` for hiring questions on their own, then signs you in in your browser. (`npx @tacitawareness/tats setup` does the same and installs `tats` for you.)

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
| `tats setup --workspace` | put the skill in this project, to commit for your whole team |
| `tats setup --remove` | take the skill out again |
| `tats setup --print` | the skill's text, for another agent's skills folder or `AGENTS.md` |

Requires Node 20 or later.
