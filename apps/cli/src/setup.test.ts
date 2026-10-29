import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { run, type Installer, type Io } from "./cli.js";
import { clientStatus, setup, SKILL } from "./setup.js";
import { fakeTacit, memoryStore, SERVER } from "./test-helpers/fake-tacit.js";

let home: string;
const env = () => ({ HOME: home, TATS_URL: SERVER });
const skillAt = (agent: string) => join(home, agent, "skills", "tats", "SKILL.md");

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tats-setup-"));
});

describe("tats agent setup", () => {
  it("writes the skill for every agent found, and only those", async () => {
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".codex"));
    expect((await setup(env())).map((r) => [r.agent, r.outcome])).toEqual([["Claude Code", "written"], ["Codex", "written"]]);
    expect(await readFile(skillAt(".claude"), "utf8")).toBe(SKILL);
    expect(await readFile(skillAt(".codex"), "utf8")).toBe(SKILL);
  });

  it("gives Claude Code the skill when no agent is found", async () => {
    expect((await setup(env())).map((r) => [r.agent, r.outcome])).toEqual([["Claude Code", "written"]]);
    expect(await readFile(skillAt(".claude"), "utf8")).toBe(SKILL);
  });

  it("refreshes its own skill, and leaves one it did not write alone unless forced", async () => {
    await setup(env());
    expect((await setup(env()))[0]!.outcome).toBe("updated");
    await writeFile(skillAt(".claude"), "---\nname: tats\n---\nmine");
    expect((await setup(env()))[0]!.outcome).toBe("kept");
    expect(await readFile(skillAt(".claude"), "utf8")).toContain("mine");
    expect((await setup(env(), { force: true }))[0]!.outcome).toBe("updated");
    expect(await readFile(skillAt(".claude"), "utf8")).toBe(SKILL);
  });

  it("removes only its own skill", async () => {
    await setup(env());
    expect((await setup(env(), { remove: true }))[0]!.outcome).toBe("removed");
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
    expect((await setup(env(), { remove: true }))[0]!.outcome).toBe("absent");
  });

  it("is a valid skill: a name and a description that names the hiring work, pointing at tats agent", () => {
    const front = /^---\nname: tats\ndescription: (.+)\n---\n/.exec(SKILL);
    expect(front?.[1]).toMatch(/candidates.*interviews/);
    expect(SKILL).toContain("Run `tats agent` first");
    expect(SKILL).toContain("pass `--yes` only after they say yes");
  });

  it("writes the named clients' skills into a project with the local scope", async () => {
    const results = await setup(env(), { scope: "local", dir: join(home, "repo"), clients: ["claude-code", "codex", "cursor"] });
    expect(results.map((r) => r.path)).toEqual([
      join(home, "repo", ".claude", "skills", "tats", "SKILL.md"),
      join(home, "repo", ".agents", "skills", "tats", "SKILL.md"),
      join(home, "repo", ".cursor", "skills", "tats", "SKILL.md"),
    ]);
    expect(await readFile(results[2]!.path, "utf8")).toBe(SKILL);
  });

  it("finds Cursor, and gives a named client the skill even when it is not found", async () => {
    await mkdir(join(home, ".cursor"));
    expect((await setup(env())).map((r) => r.client)).toEqual(["cursor"]);
    expect(await readFile(skillAt(".cursor"), "utf8")).toBe(SKILL);
    expect((await setup(env(), { clients: ["codex"] })).map((r) => [r.client, r.outcome])).toEqual([["codex", "written"]]);
  });

  it("reports each client's state, with the version that wrote the skill", async () => {
    await mkdir(join(home, ".codex"));
    await setup(env(), { clients: ["claude-code"] });
    await mkdir(join(home, ".cursor", "skills", "tats"), { recursive: true });
    await writeFile(skillAt(".cursor"), "mine");
    const status = await clientStatus(env());
    expect(status.map((c) => [c.client, c.detected, c.skill.state, c.skill.version])).toEqual([
      ["claude-code", true, "installed", "0.1.0"],
      ["codex", true, "missing", null],
      ["cursor", true, "not_tats", null],
    ]);
  });

  it("writes nothing on a dry run", async () => {
    expect((await setup(env(), { dryRun: true }))[0]!.outcome).toBe("written");
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("tells an agent what to do when tats is missing", () => {
    expect(SKILL).toContain("If `tats` is not found, ask the user to install it with\n`npm i -g @tacitawareness/tats`");
  });
});

describe("tats agent setup, from the command line", () => {
  let out: string[];
  let err: string[];
  let installs: string[];
  let tacit: ReturnType<typeof fakeTacit>;
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    out = [];
    err = [];
    installs = [];
    tacit = fakeTacit({ now: () => 0 });
    store = memoryStore();
  });

  const io = (over: Partial<Io> = {}, install: Partial<Installer> = {}): Io => ({
    env: { ...env(), TATS_CALLBACK_PORT: String(40000 + Math.floor(Math.random() * 20000)) },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    fetch: tacit.fetch,
    now: () => 0,
    store,
    openBrowser: tacit.browser,
    interactive: false,
    ask: async () => "",
    args: { readFile: async () => Buffer.from(""), readStdin: async () => "" },
    cwd: join(home, "repo"),
    jq: async () => ({ status: "missing", out: "", err: "" }),
    install: {
      fromNpx: false,
      installGlobal: async (spec) => (installs.push(spec), true),
      onPath: async () => "tats 0.1.0",
      ...install,
    },
    ...over,
  });

  it("--print prints the skill and writes nothing", async () => {
    expect(await run(["agent", "setup", "--print"], io())).toBe(0);
    expect(out).toEqual([SKILL]);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("tats setup alone points at tats agent setup and changes nothing", async () => {
    expect(await run(["setup"], io())).toBe(64);
    expect(err).toEqual(["It is tats agent setup."]);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("under npx, installs tats globally at its own version before the skill", async () => {
    expect(await run(["agent", "setup"], io({}, { fromNpx: true }))).toBe(0);
    expect(installs).toEqual(["@tacitawareness/tats@0.1.0"]);
    expect(out.join("\n")).toContain("✓ tats installed");
    expect(await readFile(skillAt(".claude"), "utf8")).toBe(SKILL);
    expect(out.at(-1)).toBe("Next: tats login");
  });

  it("under npx, stops before the skill when the install fails or tats is still not on the PATH", async () => {
    expect(await run(["agent", "setup"], io({}, { fromNpx: true, installGlobal: async () => false }))).toBe(1);
    expect(err[0]).toContain("npm i -g @tacitawareness/tats\n  tats agent setup");
    expect(await run(["agent", "setup"], io({}, { fromNpx: true, onPath: async () => null }))).toBe(1);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("warns, outside npx, when tats is not on the PATH", async () => {
    expect(await run(["agent", "setup"], io({}, { onPath: async () => null }))).toBe(0);
    expect(out[0]).toContain("tats is not on your PATH");
    expect(installs).toEqual([]);
  });

  it("signs in after the skill when a person is at the terminal", async () => {
    expect(await run(["agent", "setup"], io({ interactive: true }))).toBe(0);
    expect(await store.session(SERVER)).not.toBeNull();
    expect(out.join("\n")).toContain("Signed in. Done: whoami.");
    expect(out.join("\n")).not.toContain("use tats on their own: tats agent setup");
  });

  it("keeps the skill when the sign-in fails", async () => {
    expect(await run(["agent", "setup"], io({ interactive: true, openBrowser: async () => true, env: { ...env(), TATS_CALLBACK_PORT: "0" } }))).toBe(2);
    expect(err.at(-1)).toContain("The skill is installed; finish with: tats login");
    expect(await readFile(skillAt(".claude"), "utf8")).toBe(SKILL);
  });

  it("does not sign in, or install, for a project's skill (--workspace or --skills-scope local)", async () => {
    expect(await run(["agent", "setup", "--skills-scope", "local"], io({}, { fromNpx: true }))).toBe(0);
    expect(await run(["agent", "setup", "--workspace"], io({}, { fromNpx: true }))).toBe(0);
    expect(installs).toEqual([]);
    expect(await readFile(join(home, "repo", ".claude", "skills", "tats", "SKILL.md"), "utf8")).toBe(SKILL);
    expect(out.at(-1)).toContain("Commit these");
  });

  it("previews with --dry-run", async () => {
    expect(await run(["agent", "setup", "--dry-run"], io({}, { fromNpx: true }))).toBe(0);
    expect(installs).toEqual([]);
    expect(out.join("\n")).toContain("· would install tats for good: npm i -g @tacitawareness/tats@0.1.0");
    expect(out.join("\n")).toContain("would install the skill at");
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("answers to tats agent setup, as stripe agent setup does", async () => {
    expect(await run(["agent", "setup", "--client", "cursor"], io())).toBe(0);
    expect(await readFile(skillAt(".cursor"), "utf8")).toBe(SKILL);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("refuses a client or scope it does not know", async () => {
    expect(await run(["agent", "setup", "--client", "vim"], io())).toBe(64);
    expect(err[0]).toBe('--client is one of claude-code, codex, cursor; not "vim".');
    expect(await run(["agent", "setup", "--skills-scope", "team"], io())).toBe(64);
  });

  it("--json prints the plan and changes nothing", async () => {
    expect(await run(["agent", "setup", "--json"], io({ interactive: true }, { fromNpx: true }))).toBe(0);
    const plan = JSON.parse(out.at(-1)!);
    expect(plan).toMatchObject({ install: "npm i -g @tacitawareness/tats@0.1.0", login: "browser" });
    expect(plan.skills).toEqual([expect.objectContaining({ client: "claude-code", outcome: "written" })]);
    expect(installs).toEqual([]);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
  });

  it("asks once at a terminal, and -y skips the question", async () => {
    await mkdir(join(home, ".codex"));
    const asked: string[] = [];
    const ask = (answer: string) => async (q: string) => (asked.push(q), answer);
    expect(await run(["agent", "setup"], io({ interactive: true, ask: ask("n") }))).toBe(0);
    expect(asked).toEqual(["Set up tats for Codex in your home folder? [Y/n] "]);
    expect(out.at(-1)).toBe("Nothing changed.");
    await expect(readFile(skillAt(".codex"))).rejects.toThrow();
    await store.saveSession(SERVER, tacit.session());
    expect(await run(["agent", "setup", "-y"], io({ interactive: true, ask: ask("n") }))).toBe(0);
    expect(asked).toHaveLength(1);
    expect(await readFile(skillAt(".codex"), "utf8")).toBe(SKILL);
  });

  it("--status shows tats, the sign-in and each client", async () => {
    await mkdir(join(home, ".claude"));
    await run(["agent", "setup"], io());
    expect(await run(["agent", "setup", "--status"], io())).toBe(0);
    expect(out.at(-1)).toContain("tats:      tats 0.1.0, on your PATH");
    expect(out.at(-1)).toContain("not signed in (tats login)");
    expect(out.at(-1)).toMatch(/Claude Code\s+detected\s+skill installed \(tats 0\.1\.0\)/);
    expect(out.at(-1)).toMatch(/Cursor\s+not found\s+no skill/);
    expect(await run(["agent", "setup", "--status", "--json"], io())).toBe(0);
    expect(JSON.parse(out.at(-1)!).clients).toHaveLength(3);
  });
});
