import { agentGuide, mainHelp, needsConfirm, toolHelp, toolList } from "./guide.js";
import { booleanFlags, describeFlags, normalize, parseArgv, toolArguments, UsageError, type ArgsDeps, type Parsed } from "./flags.js";
import { AuthRequired, login, type AuthDeps } from "./oauth.js";
import { callTool, catalog as loadCatalog, Refused } from "./rpc.js";
import type { Catalog, Store, Tool } from "./store.js";
import { VERSION } from "./version.js";

/**
 * tats, argv to exit code. main.ts passes the real world; tests pass fakes.
 *
 *   0  done                         2  not signed in, or Tacit refused the account
 *   1  the tool refused, or failed  3  a change that needs --yes
 *                                  64  bad command line
 */

export const DEFAULT_SERVER = "https://ats-mcp.tacitawareness.com/api/client";

export type Io = {
  env: NodeJS.ProcessEnv;
  out: (text: string) => void;
  err: (text: string) => void;
  fetch: typeof fetch;
  now: () => number;
  store: Store;
  openBrowser: (url: string) => Promise<boolean>;
  /** A person at a terminal who can answer a y/N; false for agents, pipes and CI. */
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  args: ArgsDeps;
};

const EXIT = { ok: 0, refused: 1, auth: 2, confirm: 3, usage: 64 } as const;

const flag = (p: Parsed, name: string) => p.flags.some((f) => f.name === name);
const flagValue = (p: Parsed, name: string) => {
  for (let i = p.flags.length - 1; i >= 0; i--) if (p.flags[i]!.name === name) return p.flags[i]!.value;
  return undefined;
};

export async function run(argv: string[], io: Io): Promise<number> {
  const first = parseArgv(argv, booleanFlags(null));
  const server = (flagValue(first, "url") ?? io.env.TATS_URL ?? DEFAULT_SERVER).replace(/\/+$/, "");
  const deps: AuthDeps = { fetch: io.fetch, store: io.store, now: io.now };
  const json = flag(first, "json");
  const [command, ...rest] = first.positionals;

  try {
    if (!command && flag(first, "version")) {
      io.out(`tats ${VERSION}`);
      return EXIT.ok;
    }
    if (!command || command === "help" || (flag(first, "help") && !command)) {
      if (command === "help" && rest[0]) return await help(rest[0], server, deps, io);
      io.out(mainHelp(server, (await io.store.session(server)) !== null));
      return EXIT.ok;
    }
    if (flag(first, "help")) return await help(command, server, deps, io);
    switch (command) {
      case "version":
        io.out(`tats ${VERSION}`);
        return EXIT.ok;
      case "login":
        return await doLogin(server, deps, io);
      case "logout":
        io.out((await io.store.forgetTokens(server)) ? "Signed out of Tacit on this machine." : "Not signed in.");
        return EXIT.ok;
      case "status":
        return await status(server, deps, io, json);
      case "agent": {
        const catalog = (await io.store.session(server)) ? await loadCatalog(server, deps, flag(first, "refresh")).catch(() => null) : null;
        io.out(agentGuide(server, catalog));
        return EXIT.ok;
      }
      case "tools": {
        const catalog = await loadCatalog(server, deps, flag(first, "refresh"));
        io.out(json ? JSON.stringify(catalog.tools) : toolList(catalog));
        return EXIT.ok;
      }
      default:
        return await runTool(command, argv, server, deps, io);
    }
  } catch (err) {
    return report(err, io, json);
  }
}

function report(err: unknown, io: Io, json: boolean): number {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof UsageError ? EXIT.usage : err instanceof AuthRequired || err instanceof Refused ? EXIT.auth : EXIT.refused;
  if (json) io.out(JSON.stringify({ error: message }));
  io.err(message);
  return code;
}

async function findTool(name: string, server: string, deps: AuthDeps, refresh: boolean): Promise<{ tool: Tool | null; catalog: Catalog }> {
  const wanted = normalize(name);
  let catalog = await loadCatalog(server, deps, refresh);
  let tool = catalog.tools.find((t) => t.name === wanted) ?? null;
  // A tool added since the cache was filled.
  if (!tool && !refresh) {
    catalog = await loadCatalog(server, deps, true);
    tool = catalog.tools.find((t) => t.name === wanted) ?? null;
  }
  return { tool, catalog };
}

function unknownCommand(name: string, catalog: Catalog): UsageError {
  const wanted = normalize(name);
  const near = catalog.tools
    .map((t) => t.name)
    .filter((n) => n.includes(wanted) || wanted.split("_").some((part) => part.length > 3 && n.includes(part)))
    .slice(0, 5);
  return new UsageError(
    `tats has no command "${name}".${near.length ? ` Did you mean: ${near.map((n) => n.replace(/_/g, "-")).join(", ")}?` : ""} See: tats tools`,
  );
}

async function help(name: string, server: string, deps: AuthDeps, io: Io): Promise<number> {
  if (["login", "logout", "status", "agent", "tools", "help", "version"].includes(name)) {
    io.out(mainHelp(server, (await io.store.session(server)) !== null));
    return EXIT.ok;
  }
  const { tool, catalog } = await findTool(name, server, deps, false);
  if (!tool) throw unknownCommand(name, catalog);
  io.out(toolHelp(tool, describeFlags));
  return EXIT.ok;
}

async function doLogin(server: string, deps: AuthDeps, io: Io): Promise<number> {
  const port = Number(io.env.TATS_CALLBACK_PORT ?? 33418);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError("TATS_CALLBACK_PORT is not a port number.");
  await login(server, { ...deps, openBrowser: io.openBrowser, log: io.err, port });
  const catalog = await loadCatalog(server, deps, true);
  const who = await callTool(server, "whoami", {}, deps);
  const line = who.content?.find((c) => c.type === "text")?.text?.split("\n\n")[0];
  io.out(`Signed in. ${line ?? ""}`.trim());
  io.out(`${catalog.tools.length} tools available. Try: tats list-jobs   (AI agents: tats agent)`);
  return EXIT.ok;
}

async function status(server: string, deps: AuthDeps, io: Io, json: boolean): Promise<number> {
  const session = await io.store.session(server);
  const expiresAt = session?.tokens.expires_at;
  const state = {
    server,
    signed_in: session !== null,
    token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    can_refresh: Boolean(session?.tokens.refresh_token),
  };
  if (json) io.out(JSON.stringify(state));
  else if (!session) io.out(`Server: ${server}\nNot signed in. Run: tats login`);
  else {
    const expired = expiresAt !== undefined && expiresAt <= deps.now();
    io.out(
      `Server: ${server}\nSigned in` +
        (expiresAt ? `; the access token ${expired ? "expired" : "expires"} ${state.token_expires_at}` : "") +
        (state.can_refresh ? ", and renews itself." : expired ? ". Run tats login to sign in again." : ", and cannot renew itself: run tats login when it expires."),
    );
  }
  return session ? EXIT.ok : EXIT.auth;
}

async function runTool(name: string, argv: string[], server: string, deps: AuthDeps, io: Io): Promise<number> {
  const pre = parseArgv(argv, booleanFlags(null));
  const { tool, catalog } = await findTool(name, server, deps, flag(pre, "refresh"));
  if (!tool) throw unknownCommand(name, catalog);

  // Again, now that the tool's own switches are known.
  const parsed = parseArgv(argv, booleanFlags(tool));
  if (parsed.positionals.length > 1) {
    throw new UsageError(`Unexpected "${parsed.positionals[1]}". Every argument is a flag: see tats help ${tool.name.replace(/_/g, "-")}`);
  }
  const json = flag(parsed, "json");
  const args = await toolArguments(tool, parsed, io.args);

  if (needsConfirm(tool) && !flag(parsed, "yes")) {
    const command = `tats ${tool.name.replace(/_/g, "-")}`;
    if (!io.interactive || json) {
      const message =
        `${command} changes data in Tacit, so it needs --yes. ` +
        "Tell the user exactly what will change, and re-run with --yes only after they say yes.";
      if (json) io.out(JSON.stringify({ error: message, needs_confirmation: true }));
      io.err(message);
      return EXIT.confirm;
    }
    io.err(`${command} will change data in Tacit with:\n${JSON.stringify(args, null, 2)}`);
    const answer = (await io.ask("Go ahead? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      io.err("Nothing changed.");
      return EXIT.confirm;
    }
  }

  const result = await callTool(server, tool.name, args, deps);
  const text = result.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
  if (result.isError) {
    if (json) io.out(JSON.stringify({ error: text }));
    io.err(text);
    return EXIT.refused;
  }
  if (json) {
    io.out(JSON.stringify(result.structuredContent ?? { text }));
    return EXIT.ok;
  }
  io.out(human(text, result.structuredContent));
  return EXIT.ok;
}

/** The connector's sentence, then its data indented: the same answer Claude reads, made legible. */
function human(text: string, data: Record<string, unknown> | undefined): string {
  const cut = text.indexOf("\n\n");
  const summary = cut === -1 ? text : text.slice(0, cut);
  if (!data) return text;
  return `${summary}\n\n${JSON.stringify(data, null, 2)}`;
}
