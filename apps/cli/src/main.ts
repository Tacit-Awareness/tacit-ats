#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { run } from "./cli.js";
import { realArgsDeps } from "./flags.js";
import { fileStore } from "./store.js";

/** The real world for cli.ts: files, the network, the browser, the terminal. */

function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

// Coding agents run commands without a terminal, but some hand them one: never prompt them.
const agent = Boolean(process.env.CLAUDECODE || process.env.CI || process.env.TATS_NO_PROMPT);

const code = await run(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n"),
  err: (text) => process.stderr.write(text.endsWith("\n") ? text : text + "\n"),
  fetch: globalThis.fetch,
  now: Date.now,
  store: fileStore(process.env),
  openBrowser,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !agent,
  ask: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
  args: realArgsDeps,
});
process.exitCode = code;
