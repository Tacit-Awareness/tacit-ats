# @tacitawareness/tats

`tats`, the command line for the client connector: every tool a member gets from `/api/client` in Claude, as a terminal command, for coding agents (Claude Code, Codex, Cursor) and scripts. Added 2026-10-29. No dependencies; Node 20+.

## What it is, and is not

A thin client of the hosted connector, not a second implementation of it. Each command is one JSON-RPC request to `/api/client` (`TATS_URL`, default `https://ats-mcp.tacitawareness.com/api/client`) with the member's own AuthKit token, so binding, the member token, RLS, audit, the breadth ceiling, read-only mode and the privileged modules (files, calendar, Granola) all stay on the server, unchanged. It never imports `@tacit-ats/core` or `@tacit/*`, and must not: running the tools here would put the service role on members' laptops. The connector is stateless (`mcp-handler`), so `tools/call` needs no `initialize` and nothing runs between commands. Why a CLI next to the connector: a connected MCP server puts all its tool descriptions into every agent session's context, and a CLI composes with files, pipes and loops. The connector stays the way in for Claude and ChatGPT chat.

## Pieces

```
src/
  main.ts     the real world: argv, stdout, files, browser, TTY; agents (CLAUDECODE, CI, TATS_NO_PROMPT) are never prompted
  cli.ts      run(argv, io) -> exit code: login / logout / status / tools / agent / help / <tool>
  oauth.ts    sign-in: protected resource metadata -> AuthKit metadata -> dynamic client registration -> browser + PKCE
              to a loopback listener on localhost:33418 (TATS_CALLBACK_PORT) -> token with `resource`; refresh
  rpc.ts      one request per call (event-stream answers), a 401 refreshes once, 403 passes the server's sentence on;
              the catalog (initialize's instructions + tools/list) cached 6 hours
  flags.ts    a tool's flags from its input schema: kebab or snake, enums checked, booleans bare or --no-x, lists
              repeated or JSON, objects JSON, nullable "null", text-or-JSON values (set_custom_field) unquoted;
              --input <json|@file|->; --<x>-file reads a file into x_base64 (add_file's name and type follow)
  banner.ts   the <> mark, with the name and version
  guide.ts    tats help, tats agent (the connector's own instructions, live), tats tools, tats help <tool>
  setup.ts    `tats agent setup`, shaped after `stripe agent setup`: clients claude-code, codex,
              cursor, detected by their home folders (Claude Code when none is), or named with --client; the skill
              in ~/.claude/skills, ~/.codex/skills, ~/.cursor/skills, or with --skills-scope local (--workspace) in a
              project's .claude/skills, .agents/skills, .cursor/skills; --status, --json (the plan, nothing changed,
              as Stripe's), --dry-run, -y, --force, --remove, --print. cli.ts runs it in order: one Y/n question at a
              terminal (-y skips), npm i -g itself when run from npx's cache (setup stops there if that fails, so no
              skill points at a missing command), the skill, then the browser sign-in (a cancelled one keeps the skill)
  store.ts    ~/.config/tats/credentials.json (0600; the session per server, and the registered client, which a
              logout keeps) and ~/.cache/tats/ (the catalog); XDG_CONFIG_HOME / XDG_CACHE_HOME honoured
```

- **Commands are generated** from the server's `tools/list`, so a tool added to the connector is a command the next time the cache refreshes (or with `--refresh`), with no CLI release. Hand-written aliases only if the generated ones prove clunky.
- **How an agent finds tats**: a skill, as Google's agents-cli and `stripe agent setup` do. Stripe's also installs its plugin and MCP server; tats's does not, on purpose: an MCP server in every session is what tats exists to avoid. Global is the default scope (Stripe's is local) because hiring is not one project's. Nothing else tells Claude Code a new CLI exists. The skill is short on purpose: its description says when (hiring work), its body sends the agent to `tats agent`, so the rules come from the server and the skill never goes stale. `tats agent setup` overwrites only a SKILL.md carrying its own marker comment.
- **Confirm-first.** In chat the server instructions make the model ask before a change; a terminal agent never sees them unless it runs `tats agent`, so the CLI enforces it: every `destructiveHint` tool, plus `invite_member`, `create_offer` and `convert_prospect` (the rest of the instructions' list, `guide.ts`'s `CONFIRM_ALSO`), exits 3 without `--yes`, or asks y/N at a terminal. `tats agent` says to pass `--yes` only after the user's yes. Keep `CONFIRM_ALSO` in step with the instructions in apps/mcp `client/server.ts`.
- **The banner.** `banner.ts` is the `<>` mark with `Powered by Tacit` and the version beside it. `tats agent` asks agents to open their first reply after using tats in a session with it, once a session, in a code block and in the reply only, and the README says so; `tats` and `tats help` print it at a person's terminal (`interactive`). It lives in the guide and never in tool output: a directive in stdout is a prompt injection, which agents rightly distrust, and it would blur the rule that results are data.
- **Output.** `--json` prints `structuredContent` alone, and `{"error": ...}` on any failure; `--jq <expr>` (gh's) is `--json` run through `jq -r` from the PATH (macOS ships it; tats bundles none, and says so when there is none), a jq error being a usage error; otherwise the connector's sentence and the data indented. Candidate text stays fenced as the server sent it. Exit codes: 0, 1 the tool refused, 2 not signed in or the account refused, 3 needs `--yes`, 64 bad flags.
- **Sign-in facts checked 2026-10-29** against the WorkOS staging AuthKit production ran on until 2026-10-31 (`keen-sketch-56-staging.authkit.app`; now `persuasive-purity-54.authkit.app`, not rechecked): dynamic registration on, public clients (`none`) allowed, `offline_access` listed, so tats asks for `openid profile email offline_access` and gets a refresh token. The device-code grant is also listed, on the same issuer: a `tats login --device` for SSH machines would need no server change. The first real login (2026-10-29, Ryan at Tacit Test Co) confirmed the rest: AuthKit took `http://localhost:33418/callback`, gave a refresh token, and `whoami` came back as the member.

## Tests

`flags.test.ts` maps flags against `test-helpers/tools.json`, a trimmed copy of the real connector's `tools/list` (dumped from `buildClientHandler`; regenerate it when the schemas it covers change). `cli.test.ts` runs `run()` against `test-helpers/fake-tacit.ts`, a fetch-level stand-in for the connector and AuthKit that checks PKCE and the `resource`: help and the agent guide, a call, the cache, refusals, the `--yes` gate and the prompt, refresh before and after a 401, a refused refresh, a 403, and a whole browser login through a real loopback listener, twice, reusing the registered client. `setup.test.ts` writes, refreshes, keeps, forces and removes the skill in a temporary home, finds Cursor, reports `--status`, and runs `tats agent setup` through its order: the question and `-y`, the npx install and its failure, a missing PATH, sign-in after, a failed sign-in, `--client`, the local scope, `--json`'s plan, `--dry-run`. `version.test.ts` keeps `version.ts` equal to package.json. apps/mcp's `src/cli-confirm.test.ts` fails when the connector's instructions name a tool to confirm that `--yes` does not guard (`guide.ts`'s `CONFIRM_ALSO`).

## Trying it

```
pnpm --filter @tacitawareness/tats build
npm link ./apps/cli && tats agent setup        # or: node apps/cli/dist/main.js <command>
TATS_URL=http://localhost:3101/api/client tats whoami
```

`npx` from a local tarball, without touching the real install (`TATS_INSTALL_SPEC` points setup's `npm i -g` at the tarball instead of the registry; checked this way in a throwaway home and npm prefix on 2026-10-29: tats on the PATH, both skills, `Next: tats login`):

```
cd apps/cli && npm pack --pack-destination /tmp/tats
HOME=/tmp/tats/home npm_config_prefix=/tmp/tats/g TATS_INSTALL_SPEC=/tmp/tats/tacitawareness-tats-0.1.0.tgz \
  npx -y --package=/tmp/tats/tacitawareness-tats-0.1.0.tgz tats agent setup -y
```

## Publishing

npm `@tacitawareness/tats` (unscoped `tats` is someone else's), public (`publishConfig.access`, or the first publish is a 403), license `UNLICENSED`, only `dist/*.js` and the README. Pushing a tag `cli-v<version>` runs `.github/workflows/publish-cli.yml`: the tag must equal package.json's version, then typecheck, the CLI's tests, build, `npm publish` with the `NPM_TOKEN` secret. No `--provenance`: npm attests only builds from public repositories. To release, bump `version` in package.json and `version.ts` together. The build deletes `dist` and the tsbuildinfo first: with `composite`, a stale tsbuildinfo makes tsc skip files whose output was deleted.
