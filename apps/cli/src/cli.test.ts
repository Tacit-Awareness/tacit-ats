import { beforeEach, describe, expect, it } from "vitest";

import { run, type Io } from "./cli.js";
import { fakeTacit, INSTRUCTIONS, memoryStore, SERVER } from "./test-helpers/fake-tacit.js";

const ID = "3f6c2a1e-8b4d-4c2a-9e1f-0a1b2c3d4e5f";

let clock: number;
let tacit: ReturnType<typeof fakeTacit>;
let store: ReturnType<typeof memoryStore>;
let out: string[];
let err: string[];
let answers: string[];

function io(over: Partial<Io> = {}): Io {
  return {
    env: { TATS_URL: SERVER, TATS_CALLBACK_PORT: String(40000 + Math.floor(Math.random() * 20000)) },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    fetch: tacit.fetch,
    now: () => clock,
    store,
    openBrowser: tacit.browser,
    interactive: false,
    ask: async () => answers.shift() ?? "",
    args: { readFile: async () => Buffer.from(""), readStdin: async () => "{}" },
    cwd: "/nowhere",
    install: { fromNpx: false, installGlobal: async () => true, onPath: async () => "tats 0.1.0" },
    ...over,
  };
}

const tats = (argv: string[], over: Partial<Io> = {}) => run(argv, io(over));
const signIn = () => store.saveSession(SERVER, tacit.session());
const lastJson = () => JSON.parse(out.at(-1)!);

beforeEach(() => {
  clock = Date.parse("2026-10-29T12:00:00Z");
  tacit = fakeTacit({ now: () => clock });
  store = memoryStore();
  out = [];
  err = [];
  answers = [];
});

describe("help", () => {
  it("points agents at tats agent, and says when nobody is signed in", async () => {
    expect(await tats([])).toBe(0);
    expect(out[0]).toContain("Are you an AI agent? Run `tats agent` first.");
    expect(out[0]).toContain("Not signed in yet: run tats login.");
    expect(await tats(["--help"])).toBe(0);
    expect(out[1]).toBe(out[0]);
  });

  it("explains one tool from its schema", async () => {
    await signIn();
    expect(await tats(["help", "update-stage"])).toBe(0);
    expect(out[0]).toContain("tats update-stage  (Changes data; asks for --yes.)");
    expect(out[0]).toContain("--stage <sourced|contacted|screening|interviewing|offer|hired|rejected|withdrawn>  [required]");
    expect(await tats(["whoami", "--help"])).toBe(0);
    expect(out[1]).toContain("(Reads only.)");
  });

  it("suggests close names for an unknown command", async () => {
    await signIn();
    expect(await tats(["search-candidate"])).toBe(64);
    expect(err[0]).toContain("Did you mean: search-candidates?");
  });
});

describe("tats agent", () => {
  it("carries the connector's own instructions and the --yes list", async () => {
    await signIn();
    expect(await tats(["agent"])).toBe(0);
    expect(out[0]).toContain(INSTRUCTIONS);
    expect(out[0]).toMatch(/invite_member, set_interview_plan, update_job, update_stage/);
    expect(out[0]).not.toMatch(/\bwhoami\b.*--yes/);
  });

  it("still explains the CLI before sign-in", async () => {
    expect(await tats(["agent"])).toBe(0);
    expect(out[0]).toContain("Always pass --json");
    expect(out[0]).toContain("Sign in to see the list");
  });
});

describe("calling a tool", () => {
  it("sends one tools/call with the member's token and prints the result as JSON", async () => {
    await signIn();
    tacit.state.results.set("search_candidates", {
      content: [{ type: "text", text: 'Found 1 candidate.\n\n{"candidates":[]}' }],
      structuredContent: { candidates: [{ candidate_id: ID }] },
    });
    expect(await tats(["search-candidates", "--query", "Priya Shah", "--json"])).toBe(0);
    expect(tacit.state.calls).toEqual([{ name: "search_candidates", arguments: { query: "Priya Shah" }, token: "access-1" }]);
    expect(lastJson()).toEqual({ candidates: [{ candidate_id: ID }] });
  });

  it("prints the sentence and the data for a person", async () => {
    await signIn();
    expect(await tats(["whoami"])).toBe(0);
    expect(out.at(-1)).toBe('Done: whoami.\n\n{\n  "ok": true\n}');
  });

  it("caches the tool list between commands", async () => {
    await signIn();
    await tats(["whoami"]);
    await tats(["whoami"]);
    const lists = tacit.state.requests.filter((r) => r.body.includes('"tools/list"'));
    expect(lists).toHaveLength(1);
    clock += 7 * 60 * 60_000;
    await store.saveSession(SERVER, tacit.session({ access_token: "access-1", expires_at: clock + 300_000 }));
    await tats(["whoami"]);
    expect(tacit.state.requests.filter((r) => r.body.includes('"tools/list"'))).toHaveLength(2);
  });

  it("answers a tool's refusal with exit 1 and the sentence", async () => {
    await signIn();
    tacit.state.results.set("whoami", { content: [{ type: "text", text: "You cannot do that." }], isError: true });
    expect(await tats(["whoami", "--json"])).toBe(1);
    expect(lastJson()).toEqual({ error: "You cannot do that." });
    expect(err).toEqual(["You cannot do that."]);
  });
});

describe("confirming a change", () => {
  const move = ["update-stage", "--application-id", ID, "--stage", "hired"];

  it("refuses without --yes when nobody can answer, and changes nothing", async () => {
    await signIn();
    expect(await tats([...move, "--json"])).toBe(3);
    expect(lastJson()).toMatchObject({ needs_confirmation: true });
    expect(err[0]).toContain("re-run with --yes only after they say yes");
    expect(tacit.state.calls).toEqual([]);
  });

  it("runs with --yes", async () => {
    await signIn();
    expect(await tats([...move, "--yes", "--json"])).toBe(0);
    expect(tacit.state.calls.map((c) => c.name)).toEqual(["update_stage"]);
  });

  it("asks a person at a terminal, and stops on anything but yes", async () => {
    await signIn();
    answers = ["n", "y"];
    expect(await tats(move, { interactive: true })).toBe(3);
    expect(tacit.state.calls).toEqual([]);
    expect(await tats(move, { interactive: true })).toBe(0);
    expect(tacit.state.calls.map((c) => c.name)).toEqual(["update_stage"]);
  });

  it("asks for the writes the instructions list that are not marked destructive", async () => {
    await signIn();
    expect(await tats(["invite-member", "--email", "a@b.co", "--name", "Sam Lee", "--access", "admin"])).toBe(3);
  });

  it("does not ask for an ordinary write", async () => {
    await signIn();
    expect(await tats(["schedule-interview", "--help"])).toBe(0);
    expect(out[0]).toContain("(Changes data.)");
  });
});

describe("sign-in", () => {
  it("is required, with exit 2", async () => {
    expect(await tats(["whoami"])).toBe(2);
    expect(err[0]).toBe("Not signed in. Run: tats login");
  });

  it("refreshes an expired token before calling, and saves the rotated one", async () => {
    await store.saveSession(SERVER, tacit.session({ expires_at: clock - 1 }));
    expect(await tats(["whoami", "--json"])).toBe(0);
    expect(tacit.state.calls[0]!.token).toBe("access-2");
    expect((await store.session(SERVER))!.tokens).toMatchObject({ access_token: "access-2", refresh_token: "refresh-access-2" });
  });

  it("refreshes once when the server refuses a token it thought was good", async () => {
    await signIn();
    tacit.state.valid.delete("access-1");
    expect(await tats(["whoami", "--json"])).toBe(0);
    expect(tacit.state.calls[0]!.token).toBe("access-2");
  });

  it("asks for a new login when the refresh is refused", async () => {
    await store.saveSession(SERVER, tacit.session({ expires_at: clock - 1, refresh_token: "revoked" }));
    expect(await tats(["whoami"])).toBe(2);
    expect(err[0]).toBe("Your Tacit sign-in has expired. Run: tats login");
  });

  it("passes on Tacit's refusal of an account", async () => {
    await signIn();
    await tats(["tools"]);
    tacit.state.forbidden = true;
    expect(await tats(["whoami"])).toBe(2);
    expect(err[0]).toBe("This account is not a member of a company on Tacit.");
  });

  it("logs in through the browser: registration, PKCE, the resource, then whoami", async () => {
    expect(await tats(["login"])).toBe(0);
    expect(tacit.state.clients).toHaveLength(1);
    const session = (await store.session(SERVER))!;
    expect(session).toMatchObject({ issuer: "https://auth.test", resource: SERVER, client_id: "client-1" });
    expect(session.tokens).toMatchObject({ access_token: "access-login-1", refresh_token: "refresh-access-login-1", expires_at: clock + 300_000 });
    expect(out.join("\n")).toContain("Signed in. Done: whoami.");
    const authorize = new URL(err.find((l) => l.startsWith("https://auth.test/oauth2/authorize"))!);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      code_challenge_method: "S256",
      resource: SERVER,
      scope: "openid profile email offline_access",
    });
  });

  it("reuses the registered client on the next login, after a logout", async () => {
    const port = "47123";
    expect(await tats(["login"], { env: { TATS_URL: SERVER, TATS_CALLBACK_PORT: port } })).toBe(0);
    expect(await tats(["logout"])).toBe(0);
    expect(await store.session(SERVER)).toBeNull();
    expect(await tats(["whoami"])).toBe(2);
    expect(await tats(["login"], { env: { TATS_URL: SERVER, TATS_CALLBACK_PORT: port } })).toBe(0);
    expect(tacit.state.clients).toHaveLength(1);
  });

  it("reports the sign-in in tats status", async () => {
    expect(await tats(["status", "--json"])).toBe(2);
    expect(lastJson()).toMatchObject({ signed_in: false });
    await signIn();
    expect(await tats(["status"])).toBe(0);
    expect(out.at(-1)).toContain("and renews itself.");
  });
});
