# @tacit-ats/cli

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
  guide.ts    tats help, tats agent (the connector's own instructions, live), tats tools, tats help <tool>
  store.ts    ~/.config/tats/credentials.json (0600; the session per server, and the registered client, which a
              logout keeps) and ~/.cache/tats/ (the catalog); XDG_CONFIG_HOME / XDG_CACHE_HOME honoured
```

- **Commands are generated** from the server's `tools/list`, so a tool added to the connector is a command the next time the cache refreshes (or with `--refresh`), with no CLI release. Hand-written aliases only if the generated ones prove clunky.
- **Confirm-first.** In chat the server instructions make the model ask before a change; a terminal agent never sees them unless it runs `tats agent`, so the CLI enforces it: every `destructiveHint` tool, plus `invite_member`, `create_offer` and `convert_prospect` (the rest of the instructions' list, `guide.ts`'s `CONFIRM_ALSO`), exits 3 without `--yes`, or asks y/N at a terminal. `tats agent` says to pass `--yes` only after the user's yes. Keep `CONFIRM_ALSO` in step with the instructions in apps/mcp `client/server.ts`.
- **Output.** `--json` prints `structuredContent` alone, and `{"error": ...}` on any failure; otherwise the connector's sentence and the data indented. Candidate text stays fenced as the server sent it. Exit codes: 0, 1 the tool refused, 2 not signed in or the account refused, 3 needs `--yes`, 64 bad flags.
- **Sign-in facts checked 2026-10-29** against production's AuthKit (`keen-sketch-56-staging.authkit.app`): dynamic registration on, public clients (`none`) allowed, `offline_access` listed, so tats asks for `openid profile email offline_access` and gets a refresh token. The device-code grant is also listed, on the same issuer: a `tats login --device` for SSH machines would need no server change. Still unknown until the first real login: whether AuthKit accepts `http://localhost:33418/callback` from a registered client as it does Claude Code's.

## Tests

`flags.test.ts` maps flags against `test-helpers/tools.json`, a trimmed copy of the real connector's `tools/list` (dumped from `buildClientHandler`; regenerate it when the schemas it covers change). `cli.test.ts` runs `run()` against `test-helpers/fake-tacit.ts`, a fetch-level stand-in for the connector and AuthKit that checks PKCE and the `resource`: help and the agent guide, a call, the cache, refusals, the `--yes` gate and the prompt, refresh before and after a 401, a refused refresh, a 403, and a whole browser login through a real loopback listener, twice, reusing the registered client.

## Trying it

```
pnpm --filter @tacit-ats/cli build
node apps/cli/dist/main.js login        # or: npm link ./apps/cli, then tats login
TATS_URL=http://localhost:3101/api/client node apps/cli/dist/main.js whoami
```

Not published yet (`private: true`); the npm name is still to pick (`tats` may be taken; `@tacitawareness/tats` keeps the command name).
