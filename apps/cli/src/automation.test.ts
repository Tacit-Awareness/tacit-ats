import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run, type Io } from "./cli.js";
import { realArgsDeps } from "./flags.js";
import { fileStore } from "./store.js";

let home: string;
let io: Io;
let out: string[];
let err: string[];
let calls: { path: string; method: string; token: string | null; body: any }[];
let status: number;
let response: unknown;
const create = ["create", "--name", "weekly", "--prompt", "Review", "--schedule", "FREQ=WEEKLY;BYDAY=MO"];
const tats = (...args: string[]) => run(["automation", ...args], io);
const result = () => JSON.parse(out.at(-1)!);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tats-automation-"));
  out = []; err = []; calls = []; status = 200;
  response = { automation_id: "auto-1" };
  io = {
    env: { HOME: home, DEVIN_API_KEY: "cog_env", DEVIN_ORG_ID: "org-env", DEVIN_API_URL: "https://devin.test" },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: (async (url, init) => {
      const path = new URL(String(url)).pathname;
      expect(path).toMatch(/^\/v3\/organizations\/org-[\w-]+\/automations(?:\/(?:auto-[\w-]+|schemas))?$/);
      calls.push({ path, method: init?.method ?? "GET", token: new Headers(init?.headers).get("Authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(response), { status });
    }) as typeof fetch,
    now: Date.now, store: fileStore({ HOME: home }), openBrowser: async () => false,
    interactive: false, ask: async () => "n", args: realArgsDeps, cwd: home,
    jq: async () => ({ status: "missing", out: "", err: "" }),
    install: { fromNpx: false, installGlobal: async () => false, onPath: async () => null },
  };
});

afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("experimental automation group", () => {
  it("creates schedule and webhook bodies with documented recurrence and repo tokens", async () => {
    expect(await tats(...create, "--webhook", "--repo", "owner/repo", "--max-acu", "8", "--max-concurrent", "2", "--disabled", "--yes", "--json")).toBe(0);
    expect(calls[0]).toMatchObject({ method: "POST", token: "Bearer cog_env", body: {
      name: "weekly", enabled: false, run_as: { type: "creator" },
      actions: [{ type: "start_session", prompt: "Review\n@owner/repo" }],
      triggers: [
        { event_type: "schedule:recurring", conditions: { any: [{ all: [{ field: "rrule", operator: "recurrence", value: "FREQ=WEEKLY;BYDAY=MO" }] }] } },
        { event_type: "webhook:incoming", conditions: null },
      ], limits: { max_acu_limit: 8 }, concurrency: { max_concurrent_runs: 2 },
    } });
    expect(result()).toEqual(response);
    expect(await tats("create", "--name", "hook", "--prompt", "hi", "--webhook", "--run-as", "organization", "--yes")).toBe(0);
    expect(calls[1]!.body).toMatchObject({ run_as: { type: "organization" }, enabled: true, triggers: [{ event_type: "webhook:incoming", conditions: null }] });
  });

  it("dry-runs without credentials, confirmation or any fetch", async () => {
    io.env = {};
    expect(await tats(...create, "--dry-run")).toBe(0);
    expect(result().name).toBe("weekly");
    expect(calls).toEqual([]);
  });

  it("gates every write and accepts only explicit terminal consent", async () => {
    for (const args of [create, ["update", "auto-1", "--enable"], ["delete", "auto-1"]]) {
      expect(await tats(...args, "--json")).toBe(3);
      expect(result().error).toContain("--yes");
    }
    io.interactive = true;
    expect(await tats(...create)).toBe(3);
    expect(calls).toHaveLength(0);
    io.ask = async () => "yes";
    expect(await tats(...create)).toBe(0);
  });

  it("prints one-time secrets or saves them privately and omits them from stdout", async () => {
    response = { triggers: [{ event_type: "webhook:incoming", webhook: { url: "https://hook.test/x", secret: "once-only" } }] };
    expect(await tats(...create, "--yes")).toBe(0);
    expect(result().triggers[0].webhook.secret).toBe("once-only");
    expect(err.join("\n")).toContain("cannot be retrieved again");
    out = [];
    const path = join(home, "webhook.json");
    expect(await tats(...create, "--yes", "--secret-out", path, "--json")).toBe(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual((response as any).triggers[0].webhook);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(out.join("\n")).not.toContain("once-only");
    expect(result().triggers[0].webhook.url).toBe("https://hook.test/x");
  });

  it("keeps the top-level webhook fallback and strips both locations after saving", async () => {
    const webhook = { url: "https://hook.test/x", secret: "fallback-secret" };
    response = { webhook };
    expect(await tats(...create, "--yes")).toBe(0);
    expect(result().webhook).toEqual(webhook);
    response = { webhook, triggers: [{ event_type: "webhook:incoming", webhook }] };
    expect(await tats(...create, "--yes", "--secret-out", join(home, "fallback.json"))).toBe(0);
    expect(out.at(-1)).not.toContain("fallback-secret");
  });

  it("rejects existing paths, missing directories and unwritable directories before any request", async () => {
    const existing = join(home, "existing.json");
    await writeFile(existing, "keep");
    const locked = join(home, "locked");
    await mkdir(locked, { mode: 0o500 });
    try {
      for (const path of [existing, join(home, "missing", "secret.json"), join(locked, "secret.json")]) {
        expect(await tats(...create, "--yes", "--secret-out", path, "--json")).toBe(64);
        expect(result().error).toContain("Cannot use --secret-out");
      }
      expect(calls).toEqual([]);
      expect(await readFile(existing, "utf8")).toBe("keep");
    } finally { await chmod(locked, 0o700); }
  });

  it.each([false, true])("retains the secret on stdout if saving fails after create (json=%s)", async (json) => {
    const path = join(home, "raced.json");
    response = { triggers: [{ event_type: "webhook:incoming", webhook: { url: "https://hook.test/x", secret: "save-me" } }] };
    const fetch = io.fetch;
    io.fetch = async (url, init) => {
      await mkdir(path);
      return fetch(url, init);
    };
    expect(await tats(...create, "--yes", "--secret-out", path, ...(json ? ["--json"] : []))).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result().triggers[0].webhook).toEqual({ url: "https://hook.test/x", secret: "save-me" });
    expect(err.join("\n")).toContain("Could not save webhook secret");
    if (json) expect(result().error).toContain("save it now");
  });

  it("stores separate credentials, prefers env and leaves ATS registration alone on logout", async () => {
    await io.store.saveSession("https://ats.test", { issuer: "ats", resource: "ats", token_endpoint: "ats", client_id: "ats", redirect_uri: "ats", tokens: { access_token: "ats-token" } });
    expect(await tats("login", "--api-key", "cog_stored", "--org-id", "org-stored")).toBe(0);
    expect((await stat(join(home, ".config/tats/credentials.json"))).mode & 0o777).toBe(0o600);
    expect(await tats("list")).toBe(0);
    expect(calls.at(-1)).toMatchObject({ token: "Bearer cog_env", path: "/v3/organizations/org-env/automations" });
    delete io.env.DEVIN_API_KEY; delete io.env.DEVIN_ORG_ID;
    expect(await tats("list")).toBe(0);
    expect(calls.at(-1)).toMatchObject({ token: "Bearer cog_stored", path: "/v3/organizations/org-stored/automations" });
    expect(await tats("logout")).toBe(0);
    expect((await io.store.session("https://ats.test"))?.tokens.access_token).toBe("ats-token");
    expect(await tats("list", "--json")).toBe(2);
    expect(result().error).toContain("tats automation login");
  });

  it("accepts stdin login and interactive login without printing the key", async () => {
    io.args = { ...realArgsDeps, readStdin: async () => "cog_stdin\n" };
    expect(await tats("login", "--org-id", "org-stdin")).toBe(0);
    expect(await io.store.automationCredentials!()).toEqual({ apiKey: "cog_stdin", orgId: "org-stdin" });
    io.interactive = true;
    io.ask = async (q) => q.includes("key") ? "cog_prompt" : "org-prompt";
    expect(await tats("login")).toBe(0);
    expect(out.join("\n")).not.toContain("cog_");
  });

  it("lists, gets, patches, deletes and fetches schemas only from automation paths", async () => {
    for (const args of [["list"], ["get", "auto-1"], ["update", "auto-1", "--disable", "--name", "new", "--prompt", "new prompt", "--yes"], ["delete", "auto-1", "--yes"], ["schemas"]]) expect(await tats(...args)).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PATCH", "DELETE", "GET"]);
    expect(calls[2]!.body).toEqual({ enabled: false, name: "new", actions: [{ type: "start_session", prompt: "new prompt" }] });
    expect(calls.at(-1)!.path).toContain("/automations/schemas");
  });

  it("merges raw body and flags, reads prompt files, and rejects empty or bad input", async () => {
    io.args = { readFile: async () => Buffer.from("file prompt"), readStdin: async () => JSON.stringify({ name: "raw", actions: [{ type: "start_session", prompt: "raw" }], triggers: [{ event_type: "webhook:incoming" }], limits: { invocations: { max_per_window: 1, window_seconds: 60 } } }) };
    expect(await tats("create", "--from-file", "-", "--name", "override", "--prompt", "@prompt.txt", "--max-acu", "5", "--dry-run")).toBe(0);
    expect(result()).toMatchObject({ name: "override", actions: [{ prompt: "file prompt" }], limits: { max_acu_limit: 5, invocations: { max_per_window: 1 } } });
    for (const args of [["create"], ["create", "--from-file", "[]"], ["get"], [...create, "--max-acu", "NaN"], [...create, "--run-as", "bad"], [...create, "--wat"], ["update", "auto-1", "--enable", "--disable"]]) expect(await tats(...args, "--json")).toBe(64);
    expect(calls).toEqual([]);
  });

  it("reports ProblemDetail and authentication failures as JSON, and network errors", async () => {
    response = { title: "Invalid automation", detail: "Bad recurrence" };
    status = 422;
    expect(await tats("list", "--json")).toBe(1);
    expect(result()).toEqual({ error: "Invalid automation: Bad recurrence" });
    for (const code of [401, 403]) { status = code; expect(await tats("get", "auto-1")).toBe(2); }
    io.fetch = async () => { throw new Error("offline"); };
    expect(await tats("list", "--json")).toBe(1);
    expect(result()).toEqual({ error: "offline" });
  });

  it.each([
    ["Service users cannot create personal (run-as-creator) automations", false],
    ["SERVICE-USER keys cannot use RUN_AS_CREATOR", true],
  ])("adds a run-as hint for create/update errors: %s", async (detail, json) => {
    status = 400;
    response = { title: "Invalid identity", detail };
    const hint = "Use a personal access token (needs UsePersonalAutomations) to create a personal (run-as-creator) automation, or pass --run-as organization.";
    for (const args of [create, ["update", "auto-1", "--enable"]]) {
      expect(await tats(...args, "--yes", ...(json ? ["--json"] : []))).toBe(1);
      if (json) expect(result()).toEqual({ error: `Invalid identity: ${detail} ${hint}` });
      else expect(err.at(-1)).toBe(`Invalid identity: ${detail} ${hint}`);
    }
    expect(await tats("list", "--json")).toBe(1);
    expect(result()).toEqual({ error: `Invalid identity: ${detail}` });
  });

  it.each(["Service users lack permission", "Personal automations are unavailable", ""])("does not hint for unrelated or empty error text: %s", async (detail) => {
    status = 400;
    response = { detail };
    expect(await tats(...create, "--yes", "--json")).toBe(1);
    expect(result()).toEqual({ error: detail || "Devin API returned 400" });
  });

  it("shows experimental help without any API calls", async () => {
    for (const args of [["automation", "--help"], ["help", "automation"], ["help"]]) {
      expect(await run(args, io)).toBe(0);
      expect(out.at(-1)).toContain("experimental");
    }
    expect(calls).toEqual([]);
  });
});
