import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { cleanFocusAreas, cleanProfile, setInterviewerProfile, type InterviewerProfileInput } from "./interviewer-profiles.js";

/**
 * What the profile write adds on top of the table (pinned on real tokens in
 * apps/web's interviewer-profiles.integration.test.ts): tidying what a person
 * pastes, a sentence and a field for what the trigger would refuse, a save made
 * since the page read being reported, and an audit row naming only fields.
 */

const ME = "6c1f0b4e-0000-4000-8000-000000000001";
const THEM = "6c1f0b4e-0000-4000-8000-000000000002";
const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "limited"): ClientToolCtx => ({ actorId: ME, orgId: "org-1", accessLevel, source: "dashboard" });

const EMPTY: InterviewerProfileInput = { preference: null, weeklyCap: null, focusAreas: [], channel: null, awayUntil: null };
const WRITE: InterviewerProfileInput = { preference: "avoids", weeklyCap: 2, focusAreas: ["Go"], channel: "slack", awayUntil: "2026-11-14" };
const ROW = {
  actor_id: ME,
  interview_preference: "loves",
  weekly_interview_cap: 3,
  focus_areas: ["Go", "Rust"],
  preferred_channel: "email",
  away_until: null,
  updated_at: "2026-10-30T12:00:00.123456+00:00",
};
const SAME: InterviewerProfileInput = { preference: "loves", weeklyCap: 3, focusAreas: ["Go", "Rust"], channel: "email", awayUntil: null };

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}
const thrown = (fn: () => unknown): ClientToolError => {
  try {
    fn();
  } catch (e) {
    return e as ClientToolError;
  }
  throw new Error("did not throw");
};
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);
const CLAIM = { data: "audit-1" };
const FINISH = { data: null };

describe("cleanFocusAreas", () => {
  test("trims, drops blanks and repeats, and keeps the first as written, in order", () => {
    expect(cleanFocusAreas(["  Go ", "", "   ", "go", "GO", "Distributed systems", "Go, Rust"])).toEqual(["Go", "Distributed systems", "Go, Rust"]);
  });

  test("strips what cannot show from both ends, as the table's trigger reads it", () => {
    expect(cleanFocusAreas(["​Go﻿", " Rust　", "‮C⁩", "\u0000Zig\u001f"])).toEqual(["Go", "Rust", "C", "Zig"]);
  });

  test("a joiner inside an area stays: joined emoji need one", () => {
    expect(cleanFocusAreas(["\u{1F468}‍\u{1F4BB} pairing"])).toEqual(["\u{1F468}‍\u{1F4BB} pairing"]);
  });

  test("a repeat composed differently is the same area", () => {
    expect(cleanFocusAreas(["café", "café"])).toEqual(["café"]);
  });

  test("twenty areas of sixty characters pass, and one more of either does not", () => {
    expect(cleanFocusAreas(Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(60, "x")))).toHaveLength(20);
    expect(thrown(() => cleanFocusAreas(Array.from({ length: 21 }, (_, i) => `area ${i}`)))).toMatchObject({ code: "invalid", field: "focusAreas" });
    expect(thrown(() => cleanFocusAreas(["x".repeat(61)]))).toMatchObject({ code: "invalid", field: "focusAreas" });
  });

  test("sixty counts characters, not UTF-16 units, as the table does", () => {
    expect(cleanFocusAreas(["\u{1F600}".repeat(60)])).toHaveLength(1);
  });

  test("repeats and blanks do not count towards twenty", () => {
    expect(cleanFocusAreas([...Array.from({ length: 200 }, () => "Go"), ...Array.from({ length: 200 }, () => " ")])).toEqual(["Go"]);
  });

  test.each([
    ["a tab", "Go\tRust"],
    ["a newline", "Go\nRust"],
    ["a NUL", "Go\u0000Rust"],
    ["a line separator", "Go Rust"],
    ["a right-to-left override", "Go‮Rust"],
    ["a bidi isolate", "Go⁦Rust"],
  ])("%s inside an area is refused", (_name, area) => {
    expect(thrown(() => cleanFocusAreas([area]))).toMatchObject({ code: "invalid", field: "focusAreas" });
  });
});

describe("cleanProfile", () => {
  test("nothing said stays nothing said, and a limit of 0 is a limit", () => {
    expect(cleanProfile(EMPTY)).toEqual(EMPTY);
    expect(cleanProfile({ ...EMPTY, weeklyCap: 0 }).weeklyCap).toBe(0);
    expect(cleanProfile({ ...EMPTY, weeklyCap: 40 }).weeklyCap).toBe(40);
  });

  test.each([[-1], [41], [2.5], [Number.NaN], [Number.POSITIVE_INFINITY]])("a limit of %s is refused", (weeklyCap) => {
    expect(thrown(() => cleanProfile({ ...EMPTY, weeklyCap }))).toMatchObject({ code: "invalid", field: "weeklyCap" });
  });

  test.each(["fine", "LOVES", "", "<b>loves</b>"])("a preference of %j is refused", (preference) => {
    expect(thrown(() => cleanProfile({ ...EMPTY, preference }))).toMatchObject({ code: "invalid", field: "preference" });
  });

  test.each(["gmail", "Slack", ""])("a channel of %j is refused", (channel) => {
    expect(thrown(() => cleanProfile({ ...EMPTY, channel }))).toMatchObject({ code: "invalid", field: "channel" });
  });

  test.each(["2026-02-30", "2026-13-01", "0000-01-01", "20261114", "2026-11-14T00:00:00Z", "infinity", "10000-01-01", "tomorrow", ""])("an away date of %j is refused", (awayUntil) => {
    expect(thrown(() => cleanProfile({ ...EMPTY, awayUntil }))).toMatchObject({ code: "invalid", field: "awayUntil" });
  });

  test.each(["2028-02-29", "0001-01-01", "9999-12-31", "2020-01-01"])("%s is a date the table holds, past or not", (awayUntil) => {
    expect(cleanProfile({ ...EMPTY, awayUntil }).awayUntil).toBe(awayUntil);
  });
});

describe("setInterviewerProfile", () => {
  test("someone else's is refused below admin before any query", async () => {
    for (const level of ["limited", "elevated"] as const) {
      const fake = new FakeSupabase();
      expect((await refusal(setInterviewerProfile(fake.asDb(), ctx(level), { memberId: THEM, expectedUpdatedAt: null, profile: WRITE }))).code).toBe("forbidden");
      expect(fake.calls).toEqual([]);
    }
  });

  test("a bad profile is refused before any query", async () => {
    const fake = new FakeSupabase();
    const err = await refusal(setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: { ...EMPTY, weeklyCap: 99 } }));
    expect(err).toMatchObject({ code: "invalid", field: "weeklyCap" });
    expect(fake.calls).toEqual([]);
  });

  test("an admin writing someone outside their company gets not_found and no claim", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(setInterviewerProfile(fake.asDb(), ctx("admin"), { memberId: THEM, expectedUpdatedAt: null, profile: WRITE }))).code).toBe("not_found");
    expect(rpcs(fake)).toEqual([]);
  });

  test("the first save inserts their row and audits the fields, never the values", async () => {
    const fake = new FakeSupabase([{ data: null }, CLAIM, { data: [{ actor_id: ME }] }, FINISH]);
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE })).toEqual({ outcome: "changed" });
    const insert = fake.calls.find((c) => c.op === "insert")!;
    expect(insert.args).toEqual({ actor_id: ME, interview_preference: "avoids", weekly_interview_cap: 2, focus_areas: ["Go"], preferred_channel: "slack", away_until: "2026-11-14" });
    expect(rpcs(fake)).toEqual(["client_claim_write", "client_finish_write"]);
    const finish = fake.calls.find((c) => c.table === "client_finish_write")!.args as Record<string, unknown>;
    expect(finish).toMatchObject({
      p_entity_id: ME,
      p_keep: true,
      p_after: { fields: ["interview_preference", "weekly_interview_cap", "focus_areas", "preferred_channel", "away_until"] },
    });
    expect(JSON.stringify(finish)).not.toMatch(/avoids|2026-11-14|slack/);
  });

  test("a later save updates only the version it read, and names only what changed", async () => {
    const fake = new FakeSupabase([{ data: ROW }, CLAIM, { data: [{ actor_id: ME }] }, FINISH]);
    await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: ROW.updated_at, profile: { ...SAME, weeklyCap: 1 } });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.filters).toEqual([
      { method: "eq", column: "actor_id", value: ME },
      { method: "eq", column: "updated_at", value: ROW.updated_at },
    ]);
    expect((fake.calls.find((c) => c.table === "client_finish_write")!.args as Record<string, unknown>).p_after).toEqual({ fields: ["weekly_interview_cap"] });
  });

  test("the same values change nothing and claim nothing, even from a stale page", async () => {
    const fake = new FakeSupabase([{ data: ROW }, { data: ROW }]);
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: ROW.updated_at, profile: SAME })).toEqual({ outcome: "unchanged" });
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: SAME })).toEqual({ outcome: "unchanged" });
    expect(rpcs(fake)).toEqual([]);
  });

  test("an empty form on no row changes nothing, so no empty row is made", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: EMPTY })).toEqual({ outcome: "unchanged" });
    expect(fake.calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  test("the same areas in another order are a change: the order is theirs", async () => {
    const fake = new FakeSupabase([{ data: ROW }, CLAIM, { data: [{ actor_id: ME }] }, FINISH]);
    const r = await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: ROW.updated_at, profile: { ...SAME, focusAreas: ["Rust", "Go"] } });
    expect(r).toEqual({ outcome: "changed" });
  });

  test("a page older than the row is reported before any claim", async () => {
    const fake = new FakeSupabase([{ data: ROW }, { data: ROW }]);
    const older = await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: "2026-10-01T00:00:00+00:00", profile: WRITE });
    // the page showed no profile, and someone has made one since
    const none = await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE });
    expect([older, none]).toEqual([{ outcome: "stale" }, { outcome: "stale" }]);
    expect(rpcs(fake)).toEqual([]);
  });

  test("losing the race on an update gives the claim back", async () => {
    const fake = new FakeSupabase([{ data: ROW }, CLAIM, { data: [] }, FINISH]);
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: ROW.updated_at, profile: WRITE })).toEqual({ outcome: "stale" });
    expect((fake.calls.find((c) => c.table === "client_finish_write")!.args as Record<string, unknown>).p_keep).toBe(false);
  });

  test("losing the race on the first row gives the claim back", async () => {
    const fake = new FakeSupabase([{ data: null }, CLAIM, { error: { code: "23505", message: "duplicate key" } }, FINISH]);
    expect(await setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE })).toEqual({ outcome: "stale" });
    expect((fake.calls.find((c) => c.table === "client_finish_write")!.args as Record<string, unknown>).p_keep).toBe(false);
  });

  test.each([
    ["42501", "forbidden"],
    ["23503", "not_found"],
    ["22023", "invalid"],
    ["23514", "invalid"],
  ])("the table's %s comes back as %s and the claim is given back", async (code, want) => {
    const fake = new FakeSupabase([{ data: null }, CLAIM, { error: { code, message: "refused" } }, FINISH]);
    expect((await refusal(setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE }))).code).toBe(want);
    expect((fake.calls.find((c) => c.table === "client_finish_write")!.args as Record<string, unknown>).p_keep).toBe(false);
  });

  test("a database failure is not dressed up as a refusal, and the claim stays open", async () => {
    const fake = new FakeSupabase([{ data: null }, CLAIM, { error: { code: "57014", message: "canceling statement" } }]);
    await expect(setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE })).rejects.toThrow("canceling statement");
    expect(rpcs(fake)).toEqual(["client_claim_write"]);
  });

  test("past the hourly limit nothing is written", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: null }]);
    expect((await refusal(setInterviewerProfile(fake.asDb(), ctx(), { memberId: ME, expectedUpdatedAt: null, profile: WRITE }))).code).toBe("rate_limited");
    expect(fake.calls.filter((c) => c.op === "insert")).toEqual([]);
  });
});
