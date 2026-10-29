#!/usr/bin/env node
import { spawn } from "node:child_process";
import { sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { run, type JqResult } from "./cli.js";
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

/** Runs a command to its end; its output goes to stderr, so --json's stdout stays clean. */
function runCommand(cmd: string, args: string[], capture = false): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    // npm is npm.cmd on Windows, which only a shell runs.
    const child = spawn(cmd, args, { stdio: ["ignore", capture ? "pipe" : process.stderr, process.stderr], shell: process.platform === "win32" });
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.once("error", () => resolve({ ok: false, stdout }));
    child.once("close", (code) => resolve({ ok: code === 0, stdout }));
  });
}

/** jq -r over stdin; "missing" when there is no jq to run. */
function runJq(expr: string, input: string): Promise<JqResult> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    const child = spawn("jq", ["-r", expr], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.once("error", () => resolve({ status: "missing", out: "", err: "" }));
    child.once("close", (code) => resolve({ status: code === 0 ? "ok" : "failed", out, err }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
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
  jq: runJq,
  cwd: process.cwd(),
  install: {
    fromNpx: fileURLToPath(import.meta.url).includes(`${sep}_npx${sep}`),
    installGlobal: async (spec) => (await runCommand("npm", ["install", "--global", spec])).ok,
    onPath: async () => {
      const r = await runCommand("tats", ["--version"], true);
      return r.ok ? r.stdout.trim() : null;
    },
  },
});
process.exitCode = code;
