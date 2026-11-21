import { constants } from "node:fs";
import { access, lstat, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { Io } from "./cli.js";
import { parseArgv, UsageError } from "./flags.js";

export const AUTOMATION_HELP = `tats automation (experimental) — Devin v3 automations, separate from Tacit

  login [--api-key <key|->] [--org-id <org>]   save Devin credentials (key may come from stdin)
  logout                                    remove saved Devin credentials
  create --name <name> --prompt <text|@file> --schedule <RRULE> and/or --webhook
  list | get <id> | schemas
  update <id> [--enable|--disable] [--name <name>] [--prompt <text|@file>]
  delete <id>

Create options: --run-as creator|organization (default creator), --repo owner/name,
  --max-acu <1..1000>, --max-concurrent <n>, --disabled (create it off),
  --from-file <json|@file|-> (raw body; flags override fields, triggers append).
Common: --yes (confirm writes), --dry-run (print body, no requests), --json,
  --secret-out <file> (save webhook url/secret, 0600, omit secret from stdout).
Webhook secrets are shown only once and cannot be retrieved again.
Uses DEVIN_API_KEY + DEVIN_ORG_ID before saved credentials; DEVIN_API_URL overrides
https://api.devin.ai. Only automation endpoints are called; no session is started
by this command. Enabled automations can fire later; use --disabled to create off.`;

type Body = Record<string, any>;

export async function automation(argv: string[], io: Io): Promise<number> {
  const booleans = new Set(["help", "json", "yes", "webhook", "disabled", "enable", "disable", "dry_run"]);
  const p = parseArgv(argv, (n) => booleans.has(n));
  const has = (n: string) => p.flags.some((f) => f.name === n && f.value !== "false");
  const value = (n: string) => [...p.flags].reverse().find((f) => f.name === n)?.value;
  const output = (v: unknown) => io.out(JSON.stringify(v, null, 2));
  try {
    const [command, id, ...extra] = p.positionals;
    if (!command || command === "help" || has("help")) { io.out(AUTOMATION_HELP); return 0; }
    const commands = ["login", "logout", "create", "list", "get", "update", "delete", "schemas"];
    if (!commands.includes(command)) throw new UsageError(`Unknown automation command: ${command}`);
    const needsId = ["get", "update", "delete"].includes(command);
    if (extra.length || (needsId ? !id : id !== undefined)) throw new UsageError(`Usage: tats automation ${command}${needsId ? " <id>" : ""}`);
    if (id === "." || id === "..") throw new UsageError("Invalid automation ID.");
    const allowed = new Set(["help", "json", ...(command === "login" ? ["api_key", "org_id"] : []),
      ...(["create", "update"].includes(command) ? ["name", "prompt", "schedule", "webhook", "run_as", "repo", "max_acu", "max_concurrent", "disabled", "enable", "disable", "from_file", "dry_run", "secret_out"] : []),
      ...(["create", "update", "delete"].includes(command) ? ["yes"] : [])]);
    for (const f of p.flags) {
      if (!allowed.has(f.name)) throw new UsageError(`Unknown flag: --${f.name.replaceAll("_", "-")}`);
      if (!booleans.has(f.name) && !f.value) throw new UsageError(`--${f.name.replaceAll("_", "-")} needs a value.`);
    }
    const text = async (s: string) => s.startsWith("@") ? (await io.args.readFile(s.slice(1))).toString("utf8") : s;
    if (command === "login") {
      let apiKey = value("api_key");
      let orgId = value("org_id");
      if (apiKey === "-" || (!apiKey && !io.interactive)) apiKey = (await io.args.readStdin()).trim();
      if (!apiKey && io.interactive) apiKey = (await io.ask("Devin API key (input is visible): ")).trim();
      if (!orgId && io.interactive) orgId = (await io.ask("Devin organization ID: ")).trim();
      if (!apiKey || !orgId) throw new UsageError("Provide --api-key <key|-> and --org-id <org>.");
      if (!io.store.saveAutomationCredentials) throw new Error("Credential storage unavailable.");
      await io.store.saveAutomationCredentials({ apiKey, orgId });
      if (has("json")) output({ saved: true }); else io.out("Saved Devin automation credentials.");
      return 0;
    }
    if (command === "logout") {
      await io.store.saveAutomationCredentials?.(null);
      if (has("json")) output({ saved: false }); else io.out("Removed saved Devin automation credentials (environment variables are unchanged).");
      return 0;
    }
    let body: Body = {};
    if (value("from_file")) {
      const raw = value("from_file")!;
      body = JSON.parse(raw === "-" ? await io.args.readStdin() : await text(raw));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new UsageError("--from-file must contain a JSON object.");
    }
    if (has("enable") && (has("disable") || has("disabled"))) throw new UsageError("Choose --enable or --disable, not both.");
    if (value("name")) body.name = value("name");
    if (has("enable")) body.enabled = true;
    if (has("disable") || has("disabled")) body.enabled = false;
    if (value("run_as")) {
      if (!["creator", "organization"].includes(value("run_as")!)) throw new UsageError("--run-as must be creator or organization.");
      body.run_as = { type: value("run_as") };
    }
    const triggers: Body[] = [];
    if (value("schedule")) triggers.push({ event_type: "schedule:recurring", conditions: { any: [{ all: [{ field: "rrule", operator: "recurrence", value: value("schedule") }] }] } });
    if (has("webhook")) triggers.push({ event_type: "webhook:incoming", conditions: null });
    if (triggers.length) body.triggers = [...(body.triggers ?? []), ...triggers];
    const prompt = value("prompt");
    const repo = value("repo");
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new UsageError("--repo must be owner/name.");
    if (prompt || repo) {
      const actions: Body[] = body.actions ?? [{ type: "start_session", prompt: "" }];
      const action = actions.find((a) => a.type === "start_session" || (!a.type && "prompt" in a));
      if (!action) throw new UsageError("--prompt/--repo requires a start_session action.");
      if (prompt) action.prompt = await text(prompt);
      if (repo) action.prompt = `${action.prompt ?? ""}\n@${repo}`;
      body.actions = actions;
    }
    for (const [flag, group, field, max] of [["max_acu", "limits", "max_acu_limit", 1000], ["max_concurrent", "concurrency", "max_concurrent_runs", Infinity]] as const) {
      if (value(flag)) {
        const n = Number(value(flag));
        if (!Number.isInteger(n) || n < 1 || n > max) throw new UsageError(`--${flag.replaceAll("_", "-")} must be a positive integer${max < Infinity ? ` <= ${max}` : ""}.`);
        body[group] = { ...body[group], [field]: n };
      }
    }
    if (command === "create") {
      body = { run_as: { type: "creator" }, enabled: true, ...body };
      if (!body.name || !body.actions?.length || !body.triggers?.length) throw new UsageError("Create requires a name, prompt/actions, and at least one schedule or webhook trigger.");
    }
    if (has("dry_run")) { output(body); return 0; }
    const secretOut = value("secret_out");
    if (secretOut) {
      try {
        const existing = await lstat(secretOut).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (existing) throw new Error("path already exists");
        const directory = dirname(secretOut);
        if (!(await stat(directory)).isDirectory()) throw new Error("parent is not a directory");
        await access(directory, constants.W_OK | constants.X_OK);
      } catch (error) {
        throw new UsageError(`Cannot use --secret-out ${secretOut}: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }
    const stored = await io.store.automationCredentials?.();
    const apiKey = io.env.DEVIN_API_KEY || stored?.apiKey;
    const orgId = io.env.DEVIN_ORG_ID || stored?.orgId;
    if (!apiKey || !orgId) {
      const error = "Set DEVIN_API_KEY and DEVIN_ORG_ID, or run tats automation login.";
      if (has("json")) output({ error }); else io.err(error);
      return 2;
    }
    if (orgId === "." || orgId === "..") throw new UsageError("Invalid organization ID.");
    if (["create", "update", "delete"].includes(command) && !has("yes")) {
      if (!io.interactive || !/^y(es)?$/i.test((await io.ask(`${command} Devin automation${id ? ` ${id}` : ""}? [y/N] `)).trim())) {
        const error = "Needs confirmation: pass --yes after the user's approval.";
        if (has("json")) output({ error }); else io.err(error);
        return 3;
      }
    }
    const base = (io.env.DEVIN_API_URL || "https://api.devin.ai").replace(/\/+$/, "");
    const path = `/v3/organizations/${encodeURIComponent(orgId)}/automations` + (command === "schemas" ? "/schemas" : needsId ? `/${encodeURIComponent(id!)}` : "");
    const method = ({ create: "POST", update: "PATCH", delete: "DELETE" } as Record<string, string>)[command] ?? "GET";
    const response = await io.fetch(base + path, { method, redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, ...(["POST", "PATCH"].includes(method) ? { body: JSON.stringify(body) } : {}) });
    const raw = await response.text();
    let result: Body | null;
    try { result = raw ? JSON.parse(raw) : null; } catch { result = { detail: raw }; }
    if (!response.ok) {
      const error = [result?.title, result?.detail].filter(Boolean).join(": ") || `Devin API returned ${response.status}`;
      if (has("json")) output({ error }); else io.err(error);
      return [401, 403].includes(response.status) ? 2 : 1;
    }
    const webhooks: Body[] = (result?.triggers ?? []).filter((trigger: Body) => trigger.event_type === "webhook:incoming" && trigger.webhook).map((trigger: Body) => trigger.webhook);
    if (result?.webhook) webhooks.push(result.webhook);
    const webhook = webhooks.find((hook) => hook.secret);
    if (webhook) {
      io.err("Warning: this webhook secret is shown only once and cannot be retrieved again.");
      if (secretOut) {
        try {
          const file = await open(secretOut, "wx", 0o600);
          try { await file.writeFile(JSON.stringify({ url: webhook.url, secret: webhook.secret }, null, 2) + "\n"); } finally { await file.close(); }
        } catch (error) {
          const message = `Could not save webhook secret to ${secretOut}: ${error instanceof Error ? error.message : String(error)}. The secret is included in stdout; save it now.`;
          if (has("json")) output({ ...result, error: message }); else output(result);
          io.err(message);
          return 1;
        }
        for (const hook of webhooks) delete hook.secret;
      }
    }
    output(result);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (has("json")) output({ error: message }); else io.err(message);
    return error instanceof UsageError || error instanceof SyntaxError ? 64 : 1;
  }
}
