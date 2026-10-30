import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";

const service = vi.hoisted(() => ({ asked: [] as Array<{ table: string; filters: Array<[string, unknown]> }>, row: null as unknown, saved: [] as unknown[] }));

// The service role, as far as this module can reach it: every read recorded.
vi.mock("@tacit/db", () => ({
  getSupabaseServiceClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      service.asked.push({ table, filters });
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return q;
        },
        abortSignal: () => q,
        maybeSingle: async () => ({ data: service.row, error: null }),
        update(patch: unknown) {
          service.saved.push(patch);
          return q;
        },
        then: (done: (r: { error: null }) => void) => done({ error: null }),
      };
      return q;
    },
  }),
}));

import { readGranolaNotes } from "./granola-notes";

const ME = "actor-me";
const ORG = "org-1";
const NOTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const interview = (over = {}) => ({
  id: "iv-1", application_id: "app-1", starts_at: "2026-10-15T17:00:00Z", ends_at: "2026-10-15T18:00:00Z", status: "done",
  interviewer_actor_ids: [ME], google_event_id: null, ...over,
});

/** The member's own client: what RLS would hand this token, table by table. */
function memberDb(tables: Record<string, { data: unknown; error?: { message: string } | null }>): Db {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ error: null, ...(tables[table] ?? { data: null }) }),
      };
      return q;
    },
    rpc: () => ({ eq: async () => ({ data: [], error: null }) }),
  } as unknown as Db;
}

const mine = (over = {}) =>
  memberDb({
    granola_connections: { data: { org_id: ORG, actor_id: ME } },
    interviews: { data: interview() },
    applications: { data: { person_id: "p-1" } },
    people: { data: { email: "pat@x.test" } },
    ...over,
  });

/** Granola's MCP server as fetch, answering each tool's text. */
function granola(tools: { get?: string; transcript?: string; status?: number } = {}) {
  const calls: string[] = [];
  const auth: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    auth.push(new Headers(init?.headers).get("authorization") ?? "");
    if (tools.status) return new Response("{}", { status: tools.status });
    const msg = JSON.parse(init!.body as string) as { id?: number; method: string; params: { name: string } };
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "initialize") return Response.json({ jsonrpc: "2.0", id: msg.id, result: {} });
    calls.push(msg.params.name);
    const text = msg.params.name === "get_meetings" ? tools.get : tools.transcript;
    return Response.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: text ?? "" }] } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, auth };
}

const read = (db: Db, fetchImpl: typeof fetch, input = {}) =>
  readGranolaNotes({ db, accessLevel: "elevated" }, { interviewId: "iv-1", noteId: NOTE, includeTranscript: false, ...input }, fetchImpl);

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  service.asked = [];
  service.saved = [];
  service.row = { oauth_client_id: "c", refresh_token: "rt_1", access_token: "at_mine", access_token_expires_at: "2999-01-01T00:00:00Z" };
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("only the member's own grant", () => {
  test("no row on the member's own token: the service role is never touched and Granola never asked", async () => {
    const g = granola();
    expect(await read(mine({ granola_connections: { data: null } }), g.fetchImpl)).toEqual({ status: "not_connected" });
    expect(service.asked).toEqual([]);
    expect(g.auth).toEqual([]);
  });

  test("the grant asked for is the one on the row the member's token reads, and no other", async () => {
    const g = granola({ get: "notes" });
    await read(mine(), g.fetchImpl);
    expect(service.asked).toEqual([{ table: "granola_connections", filters: [["org_id", ORG], ["actor_id", ME]] }]);
    expect(new Set(g.auth)).toEqual(new Set(["Bearer at_mine"]));
  });

  test("an interview the member did not sit on: refused before any grant is read", async () => {
    const g = granola();
    const r = await read(mine({ interviews: { data: interview({ interviewer_actor_ids: ["someone-else"] }) } }), g.fetchImpl);
    expect(r).toEqual({ status: "unavailable", message: "These notes aren't available to you." });
    expect(service.asked).toEqual([]);
    expect(g.auth).toEqual([]);
  });

  test("an interview the member's token cannot read: the same", async () => {
    const g = granola();
    expect((await read(mine({ interviews: { data: null } }), g.fetchImpl)).status).toBe("unavailable");
    expect(service.asked).toEqual([]);
  });
});

describe("what comes back", () => {
  test("the notes, and the transcript when asked", async () => {
    const g = granola({ get: "<summary>Strong.</summary>", transcript: "Ada: Hello" });
    expect(await read(mine(), g.fetchImpl)).toEqual({
      status: "found", matchedBy: "chosen", notes: "<summary>Strong.</summary>", transcript: null, transcriptStatus: "not_requested", truncated: false,
    });
    expect(await read(mine(), g.fetchImpl, { includeTranscript: true })).toMatchObject({ transcript: "Ada: Hello", transcriptStatus: "included" });
    expect(g.calls).toEqual(["get_meetings", "get_meetings", "get_meeting_transcript"]);
  });

  test("the result carries no token", async () => {
    const g = granola({ get: "n" });
    expect(JSON.stringify(await read(mine(), g.fetchImpl))).not.toMatch(/at_mine|rt_1/);
  });
});

describe("Granola's failures are sentences, never the page's error", () => {
  test("a grant Granola refused on refresh is reconnect", async () => {
    service.row = { oauth_client_id: "c", refresh_token: "rt_1", access_token: null, access_token_expires_at: null };
    const fetchImpl = (async () => Response.json({ error: "invalid_grant" }, { status: 400 })) as unknown as typeof fetch;
    expect(await read(mine(), fetchImpl)).toEqual({ status: "reconnect" });
  });

  test("a token Granola stopped accepting is reconnect", async () => {
    expect(await read(mine(), granola({ status: 401 }).fetchImpl)).toEqual({ status: "reconnect" });
  });

  test("a row gone between the two reads is not connected", async () => {
    service.row = null;
    expect(await read(mine(), granola().fetchImpl)).toEqual({ status: "not_connected" });
  });

  test("rate limited, and a server error, say so", async () => {
    expect(await read(mine(), granola({ status: 429 }).fetchImpl)).toEqual({ status: "unavailable", message: "Granola is rate limiting requests. Try again in a minute." });
    expect(await read(mine(), granola({ status: 500 }).fetchImpl)).toEqual({ status: "unavailable", message: "Granola didn't answer. Try again in a minute." });
  });

  test("a refresh that fails outright, or never answers, is a sentence", async () => {
    service.row = { oauth_client_id: "c", refresh_token: "rt_1", access_token: null, access_token_expires_at: null };
    const down = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const dead = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await read(mine(), down)).status).toBe("unavailable");
    expect((await read(mine(), dead)).status).toBe("unavailable");
  });

  test("a failing connection read is a sentence, and interview content never reaches a log", async () => {
    const g = granola({ get: "<summary>Secret read on Pat</summary>" });
    await read(mine(), g.fetchImpl);
    await read(mine({ granola_connections: { data: null, error: { message: "boom" } } }), g.fetchImpl);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Secret read");
  });
});
