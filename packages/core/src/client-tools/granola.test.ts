import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { getInterviewNotes, type ClientGranola } from "./granola.js";

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

type Note = Record<string, unknown> & { id: string };
const note = (id: string, over: Record<string, unknown> = {}): Note => ({
  id, title: `Note ${id}`, created_at: "2026-10-15T17:01:00Z", web_url: `https://notes.granola.ai/d/${id}`,
  calendar_event: null, attendees: [], summary_text: "plain", summary_markdown: `## Summary of ${id}`,
  private_notes_markdown: "- strong on systems", ...over,
});

/** Granola's API as fetch: GET /v1/notes lists `notes`; GET /v1/notes/:id answers from `notes`, or `status`. */
function granola(notes: Note[], opts: { key?: string | null; status?: Record<string, number> } = {}) {
  const calls: string[] = [];
  const keyAsks: Array<[string, string]> = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer grn_key");
    const status = opts.status?.[url.pathname + (url.searchParams.get("include") ? "?transcript" : "")] ?? opts.status?.[url.pathname];
    if (status) return new Response("{}", { status });
    if (url.pathname === "/v1/notes") return Response.json({ notes, hasMore: false, cursor: null });
    const found = notes.find((n) => url.pathname === `/v1/notes/${n.id}`);
    return found ? Response.json(found) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  const deps: ClientGranola = {
    key: async (orgId, actorId) => { keyAsks.push([orgId, actorId]); return opts.key === undefined ? "grn_key" : opts.key; },
    connectUrl: "https://ats.test/client/integrations",
    fetch: fetchImpl,
  };
  return { deps, calls, keyAsks };
}

const NOTE_ID = "not_aaaaaaaaaaaaaa";
const OTHER_ID = "not_bbbbbbbbbbbbbb";

describe("getInterviewNotes", () => {
  test("not set up on the deployment is a sentence, before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(getInterviewNotes(fake.asDb(), ctx(), null, { interviewId: "iv-1" }))).message).toMatch(/not set up/);
    expect(fake.calls).toEqual([]);
  });

  test("someone who was not an interviewer on it is refused, and Granola is never asked", async () => {
    const g = granola([]);
    const fake = new FakeSupabase([{ data: interview({ interviewer_actor_ids: ["actor-2"] }) }]);
    expect((await refusal(getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).code).toBe("forbidden");
    expect(g.keyAsks).toEqual([]);
    expect(g.calls).toEqual([]);
  });

  test("not connected says where to connect", async () => {
    const g = granola([], { key: null });
    const fake = new FakeSupabase([{ data: interview() }, { data: { person_id: "p-1" } }, { data: { email: "pat@x.test" } }]);
    const err = await refusal(getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" }));
    expect(err.message).toBe("Your Granola is not connected. Connect it at https://ats.test/client/integrations.");
    expect(g.keyAsks).toEqual([["org-1", "actor-1"]]);
  });

  test("the note on the event Tacit booked wins over one that only matches the time", async () => {
    const g = granola([
      note(OTHER_ID, { calendar_event: { scheduled_start_time: "2026-10-15T17:00:00Z", calendar_event_id: "someone-else" } }),
      note(NOTE_ID, { created_at: "2026-10-15T17:05:00Z", calendar_event: { calendar_event_id: "iv1event", scheduled_start_time: "2026-10-15T17:00:00Z" } }),
    ]);
    const fake = new FakeSupabase([{ data: interview() }, { data: { person_id: "p-1" } }, { data: { email: "pat@x.test" } }]);
    const r = await getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" });
    expect(r).toMatchObject({
      found: true, matchedBy: "event", noteId: NOTE_ID, candidateId: "p-1", title: `Note ${NOTE_ID}`,
      summary: `## Summary of ${NOTE_ID}`, myNotes: "- strong on systems", transcript: null, transcriptStatus: "not_requested",
    });
    expect(g.calls[0]).toBe(
      "/v1/notes?created_after=2026-10-15T14%3A00%3A00.000Z&created_before=2026-10-15T21%3A00%3A00.000Z&page_size=30",
    );
  });

  test("the candidate's email among the attendees matches when the caller may read it", async () => {
    const g = granola([note(NOTE_ID, { created_at: "2026-10-15T19:30:00Z", attendees: [{ name: "Pat", email: "PAT@x.test" }] })]);
    const fake = new FakeSupabase([{ data: interview({ google_event_id: null }) }, { data: { person_id: "p-1" } }, { data: { email: "pat@x.test" } }]);
    expect(await getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" })).toMatchObject({ found: true, matchedBy: "email" });
  });

  test("an interviewer finds the candidate through my_interviews and matches on time", async () => {
    const g = granola([note(NOTE_ID, { created_at: "2026-10-15T17:02:00Z" })]);
    const fake = new FakeSupabase([
      { data: interview({ google_event_id: null }) },
      { data: null },
      { data: [{ interview_id: "iv-1", person_id: "p-9" }] },
      { data: null },
    ]);
    const r = await getInterviewNotes(fake.asDb(), ctx("limited"), g.deps, { interviewId: "iv-1" });
    expect(r).toMatchObject({ found: true, matchedBy: "time", candidateId: "p-9" });
  });

  test("no match lists the notes nearby, nearest first, so one can be picked by note_id", async () => {
    const g = granola([
      note(OTHER_ID, { created_at: "2026-10-15T20:00:00Z" }),
      note(NOTE_ID, { created_at: "2026-10-15T15:00:00Z", calendar_event: { scheduled_start_time: "2026-10-15T15:00:00Z" } }),
    ]);
    const fake = new FakeSupabase([{ data: interview() }, { data: { person_id: "p-1" } }, { data: { email: "pat@x.test" } }]);
    const r = await getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" });
    expect(r).toEqual({
      found: false, interviewId: "iv-1", candidateId: "p-1",
      nearby: [
        { noteId: NOTE_ID, title: `Note ${NOTE_ID}`, createdAt: "2026-10-15T15:00:00Z" },
        { noteId: OTHER_ID, title: `Note ${OTHER_ID}`, createdAt: "2026-10-15T20:00:00Z" },
      ],
    });
  });

  test("a chosen note with its transcript; one too large to send inline is said, not thrown", async () => {
    const transcript = [
      { speaker: { source: "microphone", attribution: "me" }, text: "Tell me about a hard bug." },
      { speaker: { source: "speaker", attribution: "them" }, text: "A race in our queue." },
    ];
    const g = granola([note(NOTE_ID, { transcript })]);
    const fake = () => new FakeSupabase([{ data: interview() }, { data: { person_id: "p-1" } }, { data: null }]);
    const r = await getInterviewNotes(fake().asDb(), ctx(), g.deps, { interviewId: "iv-1", noteId: NOTE_ID, includeTranscript: true });
    expect(r).toMatchObject({
      found: true, matchedBy: "chosen", transcriptStatus: "included",
      transcript: "Me: Tell me about a hard bug.\nThem: A race in our queue.",
    });
    expect(g.calls).toEqual([`/v1/notes/${NOTE_ID}?include=transcript`]);

    const big = granola([note(NOTE_ID)], { status: { [`/v1/notes/${NOTE_ID}?transcript`]: 413 } });
    const r2 = await getInterviewNotes(fake().asDb(), ctx(), big.deps, { interviewId: "iv-1", noteId: NOTE_ID, includeTranscript: true });
    expect(r2).toMatchObject({ found: true, transcriptStatus: "too_large", transcript: null, summary: `## Summary of ${NOTE_ID}` });
  });

  test("a key Granola refuses says to connect again; a malformed note_id is refused before any read", async () => {
    const g = granola([], { status: { "/v1/notes": 401 } });
    const fake = new FakeSupabase([{ data: interview() }, { data: { person_id: "p-1" } }, { data: null }]);
    expect((await refusal(getInterviewNotes(fake.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/no longer accepts/);

    const none = new FakeSupabase();
    expect((await refusal(getInterviewNotes(none.asDb(), ctx(), g.deps, { interviewId: "iv-1", noteId: "../x" }))).code).toBe("invalid");
    expect(none.calls).toEqual([]);
  });

  test("an interview that has not happened yet or was cancelled is refused before Granola", async () => {
    const g = granola([]);
    const future = new FakeSupabase([{ data: interview({ starts_at: "2999-01-01T00:00:00Z", ends_at: "2999-01-01T01:00:00Z" }) }]);
    expect((await refusal(getInterviewNotes(future.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/not happened/);
    const cancelled = new FakeSupabase([{ data: interview({ status: "cancelled" }) }]);
    expect((await refusal(getInterviewNotes(cancelled.asDb(), ctx(), g.deps, { interviewId: "iv-1" }))).message).toMatch(/cancelled/);
    expect(g.keyAsks).toEqual([]);
  });
});
