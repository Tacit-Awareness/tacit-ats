import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { getInterviewNotes, granolaGrantAccess, granolaMcp, meetingsIn, type ClientGranola, type GranolaAccess } from "./granola.js";

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "elevated"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const interview = (over: Record<string, unknown> = {}) => ({
  id: "iv-1", application_id: "app-1", starts_at: "2026-10-15T17:00:00Z", ends_at: "2026-10-15T18:00:00Z", status: "done",
  interviewer_actor_ids: ["actor-1", "actor-2"], google_event_id: "iv1event", ...over,
});

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const meeting = (id: string, title: string, extra = "") => `<meeting id="${id}" title="${title}" date="Oct 15, 2026">\n${extra}\n</meeting>`;

type Tools = {
  /** list_meetings' text: by custom_start, or the same for every window. */
  list?: string | ((start: string) => string);
  get?: (ids: string[]) => string;
  transcript?: string | { error: string };
};

/** Granola's MCP server as fetch: initialize, then tools/call, answered as an event stream like the real one. */
function granola(tools: Tools, opts: { access?: GranolaAccess; status?: number } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const asks: Array<[string, string]> = [];
  const fetchImpl = (async (_url: URL | string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer at_1");
    if (opts.status) return new Response("{}", { status: opts.status });
    const msg = JSON.parse(init!.body as string) as { id?: number; method: string; params: { name: string; arguments: Record<string, unknown> } };
    if (msg.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": "s1" } });
    }
    expect(headers.get("mcp-session-id")).toBe("s1");
    if (msg.method !== "tools/call") return new Response(null, { status: 202 });
    const { name, arguments: args } = msg.params;
    calls.push({ name, args });
    let result: object;
    if (name === "list_meetings") {
      const text = typeof tools.list === "function" ? tools.list(String(args.custom_start)) : (tools.list ?? "");
      result = { content: [{ type: "text", text }] };
    } else if (name === "get_meetings") {
      result = { content: [{ type: "text", text: tools.get?.(args.meeting_ids as string[]) ?? "" }] };
    } else if (typeof tools.transcript === "object") {
      result = { content: [{ type: "text", text: tools.transcript.error }], isError: true };
    } else {
      result = { content: [{ type: "text", text: tools.transcript ?? "" }] };
    }
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  const deps: ClientGranola = {
    accessToken: async (orgId, actorId) => {
      asks.push([orgId, actorId]);
      return opts.access === undefined ? { token: "at_1" } : opts.access;
    },
    connectUrl: "https://ats.test/client/integrations",
    fetch: fetchImpl,
  };
  return { deps, calls, asks, fetchImpl };
}

const reads = (email: string | null = "pat@x.test") => new FakeSupabase([
  { data: interview() }, { data: { person_id: "p-1" } }, { data: email ? { email } : null },
]);

describe("meetingsIn", () => {
  test("one chunk per meeting id, starting at its line", () => {
    const text = `Meetings:\n${meeting(A, "Pat / Ada", "Attendees: pat@x.test")}\n${meeting(B, "Standup")}`;
    expect(meetingsIn(text)).toEqual([
      { id: A, text: meeting(A, "Pat / Ada", "Attendees: pat@x.test") },
      { id: B, text: meeting(B, "Standup") },
    ]);
    expect(meetingsIn("No meetings found.")).toEqual([]);
    const withFolder = meeting(A, "Pat / Ada", `<folders><folder id="${B}">Hiring</folder></folders>`);
    expect(meetingsIn(withFolder).map((m) => m.id)).toEqual([A]);
  });
});

describe("granolaMcp", () => {
  test("initializes once, then calls tools in the same session; a plain JSON answer works too", async () => {
    const g = granola({ list: "x" });
    const mcp = granolaMcp("at_1", g.fetchImpl);
    expect(await mcp.call("list_meetings", {})).toBe("x");
    expect(await mcp.call("list_meetings", {})).toBe("x");
    expect(g.calls.length).toBe(2);
  });
});

describe("getInterviewNotes", () => {
  test("not set up on the deployment is a sentence, before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(getInterviewNotes(fake.asDb(), ctx(), null, { interviewId: "iv-1" }))).message).toMatch(/not set up/);
    expect(fake.calls).toEqual([]);
  });

  test("someone who was not an interviewer on it is refused, and Granola is never asked", async () => {
    const g = granola({});
    const fake = new FakeSupabase([{ data: interview({ interviewer_actor_ids: ["actor-2"] }) }]);
    expect((await refusal(getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).code).toBe("forbidden");
    expect(g.asks).toEqual([]);
    expect(g.calls).toEqual([]);
  });

  test("not connected says where to connect; a grant Granola dropped says to connect again", async () => {
    const off = granola({}, { access: null });
    expect((await refusal(getInterviewNotes(reads().asDb(), ctx(), off.deps, { interviewId: "iv-1" }))).message).toBe(
      "Your Granola is not connected. Connect it at https://ats.test/client/integrations.",
    );
    expect(off.asks).toEqual([["org-1", "actor-1"]]);
    const dropped = granola({}, { access: { reconnect: true } });
    expect((await refusal(getInterviewNotes(reads().asDb(), ctx(), dropped.deps, { interviewId: "iv-1" }))).message).toMatch(
      /no longer accepts Tacit's access/,
    );
  });

  test("the meeting on the event Tacit booked wins over one with the candidate's email", async () => {
    const g = granola({
      list: `${meeting(A, "Pat / Ada", "pat@x.test")}\n${meeting(B, "Interview", "event: iv1event")}`,
      get: (ids) => `notes for ${ids.join(",")}`,
    });
    const r = await getInterviewNotes(reads().asDb(), ctx(), g.deps, { interviewId: "iv-1" });
    expect(r).toMatchObject({ found: true, matchedBy: "event", noteId: B, notes: `notes for ${B}`, transcriptStatus: "not_requested" });
    expect(g.calls).toEqual([
      {
        name: "list_meetings",
        args: {
          time_range: "custom", custom_start: "2026-10-15T14:00:00.000Z", custom_end: "2026-10-15T21:00:00.000Z",
          involvement: { captured_by_me: true },
        },
      },
      { name: "get_meetings", args: { meeting_ids: [B] } },
    ]);
  });

  test("the candidate's email matches when the caller may read it", async () => {
    const g = granola({ list: `${meeting(A, "Pat / Ada", "PAT@x.test")}\n${meeting(B, "Standup")}`, get: () => "n" });
    expect(await getInterviewNotes(reads().asDb(), ctx(), g.deps, { interviewId: "iv-1" })).toMatchObject({ found: true, matchedBy: "email", noteId: A });
  });

  test("an interviewer finds the candidate through my_interviews and matches the one meeting during the interview", async () => {
    const g = granola({
      list: (start) => (start === "2026-10-15T16:50:00.000Z" ? meeting(A, "Chat") : `${meeting(A, "Chat")}\n${meeting(B, "Lunch")}`),
      get: () => "n",
    });
    const fake = new FakeSupabase([
      { data: interview({ google_event_id: null }) },
      { data: null },
      { data: [{ interview_id: "iv-1", person_id: "p-9" }] },
      { data: null },
    ]);
    const r = await getInterviewNotes(fake.asDb(), ctx("limited"), g.deps, { interviewId: "iv-1" });
    expect(r).toMatchObject({ found: true, matchedBy: "time", candidateId: "p-9", noteId: A });
  });

  test("no match lists the meetings nearby, so one can be picked by note_id", async () => {
    const g = granola({ list: (start) => (start === "2026-10-15T16:50:00.000Z" ? "" : `${meeting(A, "Lunch")}\n${meeting(B, "1:1")}`) });
    const r = await getInterviewNotes(reads().asDb(), ctx(), g.deps, { interviewId: "iv-1" });
    expect(r).toEqual({
      found: false, interviewId: "iv-1", candidateId: "p-1",
      nearby: [{ noteId: A, excerpt: meeting(A, "Lunch") }, { noteId: B, excerpt: meeting(B, "1:1") }],
    });
  });

  test("a chosen meeting with its transcript; a plan without transcripts still gets the notes", async () => {
    const g = granola({ get: () => "notes", transcript: "Me: Tell me about a hard bug.\nThem: A race in our queue." });
    const r = await getInterviewNotes(reads().asDb(), ctx(), g.deps, { interviewId: "iv-1", noteId: A, includeTranscript: true });
    expect(r).toMatchObject({
      found: true, matchedBy: "chosen", notes: "notes", transcriptStatus: "included",
      transcript: "Me: Tell me about a hard bug.\nThem: A race in our queue.",
    });
    expect(g.calls.map((c) => c.name)).toEqual(["get_meetings", "get_meeting_transcript"]);
    expect(g.calls[1]!.args).toEqual({ meeting_id: A, max_chars: 60_000 });

    const free = granola({ get: () => "notes", transcript: { error: "Transcripts need a paid plan." } });
    const r2 = await getInterviewNotes(reads().asDb(), ctx(), free.deps, { interviewId: "iv-1", noteId: A, includeTranscript: true });
    expect(r2).toMatchObject({ found: true, notes: "notes", transcript: null, transcriptStatus: "unavailable" });
  });

  test("a token Granola refuses says to connect again; a malformed note_id is refused before any read", async () => {
    const g = granola({}, { status: 401 });
    expect((await refusal(getInterviewNotes(reads().asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/no longer accepts/);

    const none = new FakeSupabase();
    expect((await refusal(getInterviewNotes(none.asDb(), ctx(), g.deps, { interviewId: "iv-1", noteId: "../x" }))).code).toBe("invalid");
    expect(none.calls).toEqual([]);
  });

  test("an interview that has not happened yet or was cancelled is refused before Granola", async () => {
    const g = granola({});
    const future = new FakeSupabase([{ data: interview({ starts_at: "2999-01-01T00:00:00Z", ends_at: "2999-01-01T01:00:00Z" }) }]);
    expect((await refusal(getInterviewNotes(future.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/not happened/);
    const cancelled = new FakeSupabase([{ data: interview({ status: "cancelled" }) }]);
    expect((await refusal(getInterviewNotes(cancelled.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/cancelled/);
    expect(g.asks).toEqual([]);
  });
});

describe("granolaGrantAccess", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const row = (over: Record<string, unknown> = {}) => ({
    oauth_client_id: "client-1", refresh_token: "rt_old", access_token: "at_old", access_token_expires_at: "2026-10-20T13:00:00Z", ...over,
  });
  const expired = row({ access_token_expires_at: "2026-10-20T11:00:00Z" });
  const access = (fake: FakeSupabase, fetchImpl: typeof fetch) => granolaGrantAccess(fake.asDb(), "org-1", "actor-1", fetchImpl, () => NOW);
  const never = (async () => {
    throw new Error("Granola should not be asked");
  }) as unknown as typeof fetch;
  const answers = (body: object, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

  test("no grant is null, and Granola is not asked", async () => {
    expect(await access(new FakeSupabase([{ data: null }]), never)).toBeNull();
  });

  test("a cached token is used, scoped to the caller's org and actor", async () => {
    const fake = new FakeSupabase([{ data: row() }]);
    expect(await access(fake, never)).toEqual({ token: "at_old" });
    expect(fake.calls[0]!.filters.map((f) => [f.column, f.value])).toEqual([["org_id", "org-1"], ["actor_id", "actor-1"]]);
  });

  test("a token within a minute of expiring is refreshed, and the rotated refresh token is written back on the one read", async () => {
    const fake = new FakeSupabase([{ data: row({ access_token_expires_at: "2026-10-20T12:00:30Z" }) }, { data: null }]);
    const seen: string[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      seen.push(String(init?.body));
      return Response.json({ access_token: "at_new", refresh_token: "rt_new", expires_in: 3600 });
    }) as unknown as typeof fetch;
    expect(await access(fake, fetchImpl)).toEqual({ token: "at_new" });
    expect(seen[0]).toContain("refresh_token=rt_old");
    const save = fake.calls[1]!;
    expect(save).toMatchObject({ table: "granola_connections", op: "update" });
    expect(save.args).toEqual({ access_token: "at_new", access_token_expires_at: "2026-10-20T13:00:00.000Z", refresh_token: "rt_new" });
    expect(save.filters.map((f) => [f.column, f.value])).toEqual([["org_id", "org-1"], ["actor_id", "actor-1"], ["refresh_token", "rt_old"]]);
  });

  test("a refresh Granola refuses is reconnect, and the row stays", async () => {
    const fake = new FakeSupabase([{ data: expired }, { data: expired }]);
    expect(await access(fake, answers({ error: "invalid_grant" }, 400))).toEqual({ reconnect: true });
    expect(fake.calls.map((c) => c.op)).toEqual(["select", "select"]);
  });

  test("losing a refresh race to another call uses the winner's token, not reconnect", async () => {
    const won = row({ refresh_token: "rt_rotated", access_token: "at_theirs", access_token_expires_at: "2026-10-20T18:00:00Z" });
    const fake = new FakeSupabase([{ data: expired }, { data: won }]);
    expect(await access(fake, answers({ error: "invalid_grant" }, 400))).toEqual({ token: "at_theirs" });
  });

  test("a refused grant whose row changed but holds no live token is still reconnect", async () => {
    const fake = new FakeSupabase([{ data: expired }, { data: { ...expired, refresh_token: "rt_rotated" } }]);
    expect(await access(fake, answers({ error: "invalid_grant" }, 400))).toEqual({ reconnect: true });
  });

  test("any other failure throws with the status alone", async () => {
    const fake = new FakeSupabase([{ data: expired }]);
    await expect(access(fake, answers({ error: "server_error" }, 503))).rejects.toThrow("granola refresh: 503");
  });
});
