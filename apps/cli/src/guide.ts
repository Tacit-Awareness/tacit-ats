import { flagName } from "./flags.js";
import type { Catalog, Tool } from "./store.js";

/**
 * The words tats says: `tats help`, `tats agent`, `tats tools`, `tats help
 * <tool>`. The agent guide carries the connector's own instructions as the
 * server gives them, so the rules a model follows in Claude and in a
 * terminal are the same text.
 */

/**
 * Asked for --yes on top of every destructiveHint tool: the rest of the
 * server instructions' confirm-first list, which are writes but not marked
 * destructive.
 */
export const CONFIRM_ALSO = new Set(["invite_member", "create_offer", "convert_prospect"]);

export const needsConfirm = (tool: Tool) => tool.annotations?.destructiveHint === true || CONFIRM_ALSO.has(tool.name);

const COMMON = [
  ["whoami", "who you are signed in as, and your access"],
  ["list-jobs", "the jobs you can see"],
  ["get-pipeline", "a job's candidates by stage"],
  ["search-candidates", "find people by name, email, tag or pool"],
  ["get-candidate", "one candidate's record"],
  ["list-my-interviews", "your upcoming and past interviews"],
  ["update-stage", "move a candidate (asks for --yes)"],
];

export function mainHelp(server: string, signedIn: boolean): string {
  return `tats: your company's hiring workspace in Tacit, from the terminal.

  Are you an AI agent? Run \`tats agent\` first. It explains how to use this
  CLI on your user's behalf, and what to confirm with them before you act.

Usage: tats <tool> [--flags] [--json] [--yes]

Common tools:
${COMMON.map(([n, d]) => `  ${n!.padEnd(22)} ${d}`).join("\n")}
  ...and the rest: tats tools

Commands:
  tats login             sign in with your company's Tacit account (opens your browser)
  tats logout            sign out on this machine
  tats setup             teach this machine's coding agents (Claude Code, Codex) to use tats;
                         again to refresh, --remove to undo, --print for any other agent
  tats status            which server and account, and whether the sign-in is current
  tats tools             every tool, read-only ones first
  tats help <tool>       one tool's flags
  tats agent             the guide for AI agents

Flags on every tool:
  --json                 print only the result as JSON (for scripts and agents)
  --yes                  confirm a change that asks for it
  --input <json|@file|->  the whole argument object as JSON; flags override it
  --refresh              fetch the tool list again first

Server: ${server}${signedIn ? "" : "\nNot signed in yet: run tats login."}
`;
}

export function agentGuide(server: string, catalog: Catalog | null): string {
  const confirm = catalog ? catalog.tools.filter(needsConfirm).map((t) => t.name).sort() : null;
  return `# Using tats as an agent

tats is the command line for a company's hiring workspace in Tacit (jobs,
candidates, pipeline, interviews, offers, email). Every tool you would get
from the Tacit connector in Claude is a command here, under the same name:
\`tats search_candidates\` and \`tats search-candidates\` are the same thing.

## How to call it
- Always pass --json. stdout is then the result as one JSON object; on a
  refusal it is {"error": "..."} and the exit code is 1.
- \`tats help <tool>\` lists a tool's flags. Ids come from earlier results:
  never invent one. When you only have a name, run search-candidates first.
- Lists repeat their flag (--interviewer-user-ids ID1 --interviewer-user-ids
  ID2) or take a JSON array; nested arguments take JSON. --input '{"...": ...}' gives the
  whole argument object at once.
- --<name>-file <path> reads a local file into <name>_base64 (e.g.
  \`tats add-file --candidate-id ID --kind resume --content-file cv.pdf\`).
- Exit codes: 0 done, 1 the tool refused (read the error), 2 not signed in
  or not allowed (tell the user to run \`tats login\`), 3 needs --yes, 64 bad flags.

## Confirm before changing anything that matters
These commands refuse to run without --yes. Before you pass --yes, tell the
user exactly what will change and wait for their explicit yes to that
change. Never pass --yes on your own initiative.
${confirm ? wrap(confirm.join(", ")) : "(Sign in to see the list: tats login, then tats agent.)"}

## Rules from the Tacit connector
${catalog?.instructions ?? "(Not signed in: the connector's rules appear here after tats login.)"}

Server: ${server}
`;
}

function wrap(text: string, width = 76): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const firstSentence = (text = "") => {
  const m = /^(.+?[.!?])(\s|$)/s.exec(text.trim());
  return (m ? m[1]! : text.trim()).replace(/\s+/g, " ");
};

export function toolList(catalog: Catalog): string {
  const tools = [...catalog.tools].sort((a, b) => a.name.localeCompare(b.name));
  const line = (t: Tool) => {
    const summary = firstSentence(t.description);
    return `  ${t.name.replace(/_/g, "-").padEnd(26)} ${summary.length > 90 ? summary.slice(0, 87) + "..." : summary}`;
  };
  const reads = tools.filter((t) => t.annotations?.readOnlyHint);
  const writes = tools.filter((t) => !t.annotations?.readOnlyHint);
  return [
    `Reads (${reads.length}):`,
    ...reads.map(line),
    "",
    `Changes (${writes.length}; * asks for --yes):`,
    ...writes.map((t) => (needsConfirm(t) ? line(t).replace(/^ /, "*") : line(t))),
    "",
    "tats help <tool> for one tool's flags.",
  ].join("\n");
}

export function toolHelp(tool: Tool, describeFlags: (t: Tool) => string[]): string {
  const flags = describeFlags(tool);
  const kind = tool.annotations?.readOnlyHint ? "Reads only." : needsConfirm(tool) ? "Changes data; asks for --yes." : "Changes data.";
  return [
    `tats ${tool.name.replace(/_/g, "-")}  (${kind})`,
    "",
    tool.description?.trim() ?? "",
    "",
    flags.length ? "Flags:" : "No flags.",
    ...flags,
    "",
    `Also: --json, --input <json>${needsConfirm(tool) ? ", --yes" : ""}. Flags are kebab or snake case (${flagName("job_id")} or --job_id).`,
  ].join("\n");
}
