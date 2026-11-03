import { describe, expect, test } from "vitest";

import { fakeGoogle, fakeSigner } from "../test-helpers/fake-google.js";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { CALENDAR_EVENTS_SCOPE, CALENDAR_FREEBUSY_SCOPE, findInterviewTimes, readCalendarConnections } from "./calendar.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { scheduleInterview } from "./interviews.js";

/** A company's Google Workspace booking for its members, as Ashby: calendar.ts's readCalendarConnections and calendarAccess. */

const ctx: ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "claude" };
const NOW = new Date("2026-10-19T12:00:00Z");

describe("readCalendarConnections", () => {
  const OWN = [
    { actor_id: "actor-1", account_email: "me@gmail.test", refresh_token: "rt-me" },
    { actor_id: "actor-3", account_email: "ivy@co.test", refresh_token: "rt-ivy" },
  ];
  const ACTORS = [
    { id: "actor-1", email: "Me@Co.test", access_level: "admin", auth_subject: "user_me" },
    { id: "actor-2", email: "lee@co.test", access_level: "elevated", auth_subject: "user_lee" },
    // An interviewer is covered too; someone invited and not signed in, and someone at another domain, are not.
    { id: "actor-3", email: "ivy@co.test", access_level: "limited", auth_subject: "user_ivy" },
    { id: "actor-4", email: "new@co.test", access_level: "admin", auth_subject: null },
    { id: "actor-5", email: "sam@elsewhere.test", access_level: "admin", auth_subject: "user_sam" },
  ];

  // The fake answers in the order queries finish: the Workspace's maybeSingle first, then the two lists.
  test("covers every signed-in member at the verified domain, interviewers too, keeping their own connection as the fallback", async () => {
    const fake = new FakeSupabase([{ data: { domain: "co.test" } }, { data: OWN }, { data: ACTORS }]);
    const found = await readCalendarConnections(fake.asDb(), "org-1", ["actor-1", "actor-2", "actor-3", "actor-4", "actor-5", "actor-1"], { workspace: true });
    expect(found).toEqual(new Map([
      ["actor-1", { accountEmail: "me@co.test", workspace: true, own: { accountEmail: "me@gmail.test", refreshToken: "rt-me" } }],
      ["actor-2", { accountEmail: "lee@co.test", workspace: true, own: null }],
      ["actor-3", { accountEmail: "ivy@co.test", workspace: true, own: { accountEmail: "ivy@co.test", refreshToken: "rt-ivy" } }],
    ]));
    // Every read is the org's own, for the members asked about, once each.
    for (const call of fake.calls) expect(call.filters).toContainEqual(expect.objectContaining({ column: "org_id", value: "org-1" }));
    expect(fake.calls.find((c) => c.table === "actors")?.filters).toContainEqual(expect.objectContaining({ column: "id", value: ["actor-1", "actor-2", "actor-3", "actor-4", "actor-5"] }));
  });

  test("no verified Workspace: own connections only", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: OWN }, { data: ACTORS }]);
    const found = await readCalendarConnections(fake.asDb(), "org-1", ["actor-1", "actor-2"], { workspace: true });
    expect([...found.keys()]).toEqual(["actor-1", "actor-3"]);
    expect(found.get("actor-1")).toEqual({ accountEmail: "me@gmail.test", refreshToken: "rt-me" });
  });

  test("a deployment that cannot sign delegated tokens reads neither the Workspace nor anyone's sign-in", async () => {
    const fake = new FakeSupabase([{ data: OWN }]);
    await readCalendarConnections(fake.asDb(), "org-1", ["actor-1"], { workspace: false });
    expect(fake.calls.map((c) => c.table)).toEqual(["calendar_connections"]);
  });

  test("nobody asked about: no read", async () => {
    const fake = new FakeSupabase([]);
    expect(await readCalendarConnections(fake.asDb(), "org-1", [], { workspace: true })).toEqual(new Map());
    expect(fake.calls).toEqual([]);
  });

  test("a failed read throws, rather than reading as nobody covered", async () => {
    const fake = new FakeSupabase([{ error: { message: "boom" } }, { data: OWN }, { data: ACTORS }]);
    await expect(readCalendarConnections(fake.asDb(), "org-1", ["actor-1"], { workspace: true })).rejects.toThrow("google_workspace_connections: boom");
  });
});

const TEAM = [
  { id: "actor-2", display_name: "Lee", email: "lee@co.test" },
  { id: "actor-3", display_name: "Ivy", email: "ivy@co.test" },
];
const find = {
  interviewerIds: ["actor-2", "actor-3"], windowStart: "2026-10-19T00:00:00-04:00", windowEnd: "2026-10-20T00:00:00-04:00",
  timezone: "America/New_York", maxResults: 2,
};
const members = () => new FakeSupabase([{ data: TEAM.map(({ id }) => ({ id })) }, { data: TEAM }, { data: [] }, { data: [] }]);
const ME_WS = { accountEmail: "me@co.test", workspace: true as const, own: null };
const LEE_WS = { accountEmail: "lee@co.test", workspace: true as const, own: null };

describe("free/busy through the Workspace", () => {
  test("each covered member's calendar is read AS them, with the two calendar scopes and nothing else", async () => {
    const google = fakeGoogle({
      busy: {
        "at-ws-lee@co.test": { "lee@co.test": [["2026-10-19T13:00:00Z", "2026-10-19T15:00:00Z"]] },
        "at-ws-me@co.test": { "ivy@co.test": [] },
      },
    });
    const calendar = google.calendarWith({ "actor-1": ME_WS, "actor-2": LEE_WS }, fakeSigner());
    const found = await findInterviewTimes(members().asDb(), ctx, calendar, find, NOW);
    expect(found.slots.map((s) => s.startsAt)).toEqual(["2026-10-19T15:00:00.000Z", "2026-10-19T15:30:00.000Z"]);
    expect(found.checked).toEqual(expect.arrayContaining([
      { userId: "actor-2", name: "Lee", via: "their_calendar" },
      { userId: "actor-3", name: "Ivy", via: "your_calendar" },
    ]));
    expect(google.delegatedScopes()).toEqual([
      { iss: "tacit-sa@tacit.test", sub: "me@co.test", scope: `${CALENDAR_EVENTS_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}`, aud: "https://oauth2.googleapis.com/token", iat: expect.any(Number), exp: expect.any(Number) },
      expect.objectContaining({ sub: "lee@co.test", scope: `${CALENDAR_EVENTS_SCOPE} ${CALENDAR_FREEBUSY_SCOPE}` }),
    ]);
    // No refresh token was used.
    expect(google.calls.filter((c) => (c.body as { refresh_token?: string } | undefined)?.refresh_token)).toEqual([]);
  });

  test("Google refusing the Workspace's grant falls back to the member's own connection, at its own address", async () => {
    const google = fakeGoogle({
      workspaceRefused: ["lee@co.test"],
      busy: { "at-ws-me@co.test": { "ivy@co.test": [] }, "at-lee": { "lee@gmail.test": [] } },
    });
    const calendar = google.calendarWith({
      "actor-1": ME_WS, "actor-2": { accountEmail: "lee@co.test", workspace: true, own: { accountEmail: "lee@gmail.test", refreshToken: "rt-lee" } },
    }, fakeSigner());
    const found = await findInterviewTimes(members().asDb(), ctx, calendar, find, NOW);
    expect(found.checked).toContainEqual({ userId: "actor-2", name: "Lee", via: "their_calendar" });
    expect(found.unknown).toEqual([]);
  });

  test("refused with no connection of their own: read through the caller's, and said why when that fails too", async () => {
    const google = fakeGoogle({ workspaceRefused: ["lee@co.test"], busy: { "at-ws-me@co.test": { "ivy@co.test": [] } } });
    const calendar = google.calendarWith({ "actor-1": ME_WS, "actor-2": LEE_WS }, fakeSigner());
    const found = await findInterviewTimes(members().asDb(), ctx, calendar, find, NOW);
    expect(found.unknown).toEqual([{ userId: "actor-2", name: "Lee", reason: "workspace_refused" }]);
  });

  test("the caller refused with nothing to fall back on: a sentence about the Workspace, not a reconnect", async () => {
    const google = fakeGoogle({ workspaceRefused: ["me@co.test"] });
    const calendar = google.calendarWith({ "actor-1": ME_WS }, fakeSigner());
    const err = await findInterviewTimes(members().asDb(), ctx, calendar, find, NOW).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ClientToolError);
    expect((err as Error).message).toMatch(/Google refused Tacit's access to your calendar through your company's Google Workspace/);
  });

  test("a deployment with no signer reads no Workspace calendar", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "lee@co.test": [], "ivy@co.test": [] } } });
    const calendar = google.calendarWith({ "actor-1": { ...ME_WS, own: { accountEmail: "me@co.test", refreshToken: "rt-me" } } }, null);
    const found = await findInterviewTimes(members().asDb(), ctx, calendar, find, NOW);
    expect(found.checked).toHaveLength(2);
    expect(google.delegatedScopes()).toEqual([]);
  });
});

describe("booking through the Workspace", () => {
  test("the event goes on the covered interviewer's own calendar, created with their delegated token", async () => {
    const people = [{ id: "actor-1", display_name: "Me", email: "me@co.test" }, { id: "actor-2", display_name: "Lee", email: "lee@co.test" }];
    const google = fakeGoogle({ busy: { "at-ws-me@co.test": { "me@co.test": [] }, "at-ws-lee@co.test": { "lee@co.test": [] } } });
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }, { data: people },
      { data: { person_id: "p-1", people: { display_name: "Pat Lee", email: "pat@example.com" }, roles: { title: "Engineer" } } },
      { data: "audit-1" }, { data: null }, { data: null }, { data: null },
    ]);
    const r = await scheduleInterview(fake.asDb(), ctx, {
      applicationId: "app-1", startsAt: "2026-10-21T15:00:00-04:00", endsAt: "2026-10-21T16:00:00-04:00",
      interviewerIds: ["actor-2", "actor-1"], timezone: "America/New_York",
    }, { calendar: google.calendarWith({ "actor-1": ME_WS, "actor-2": LEE_WS }, fakeSigner()), mailer: null, now: () => NOW });
    if (r.outcome !== "scheduled") throw new Error("expected scheduled");
    expect(r.calendar).toMatchObject({ status: "invited", organizer: { userId: "actor-1" }, invited: [{ userId: "actor-2" }] });
    expect(fake.calls.find((c) => c.op === "insert")?.args).toMatchObject({ calendar_actor_id: "actor-1" });
    const [created] = google.eventCalls();
    expect(created).toMatchObject({ method: "POST", token: "at-ws-me@co.test" });
    expect(created.body).toMatchObject({ attendees: [{ email: "me@co.test" }, { email: "lee@co.test" }, { email: "pat@example.com" }] });
  });
});
