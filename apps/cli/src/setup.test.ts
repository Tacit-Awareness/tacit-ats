import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { run } from "./cli.js";
import { setup, SKILL } from "./setup.js";
import { fakeTacit, memoryStore, SERVER } from "./test-helpers/fake-tacit.js";

let home: string;
const env = () => ({ HOME: home, TATS_URL: SERVER });
const skillAt = (agent: string) => join(home, agent, "skills", "tats", "SKILL.md");

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tats-setup-"));
});

describe("tats setup", () => {
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

  it("runs from the command line, and --print prints the skill without writing it", async () => {
    const out: string[] = [];
    const tacit = fakeTacit({ now: () => 0 });
    const io = {
      env: env(), out: (t: string) => out.push(t), err: () => {}, fetch: tacit.fetch, now: () => 0, store: memoryStore(),
      openBrowser: tacit.browser, interactive: false, ask: async () => "", args: { readFile: async () => Buffer.from(""), readStdin: async () => "" },
    };
    expect(await run(["setup", "--print"], io)).toBe(0);
    expect(out[0]).toBe(SKILL);
    await expect(readFile(skillAt(".claude"))).rejects.toThrow();
    expect(await run(["setup"], io)).toBe(0);
    expect(out[1]).toContain("✓ Claude Code: skill installed at");
    expect(out[1]).toContain("Next: tats login");
  });
});
