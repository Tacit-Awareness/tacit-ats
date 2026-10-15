import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { getActivity } from "./activity.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * The activity feed's own logic with the database scripted: how the six
 * reads are merged, ordered, cut to the limit and named. What each read
 * returns is the policies' call, pinned against real Postgres in apps/mcp's
 * client.integration.test.ts.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const INTERVIEW = {
  id: "iv-1", application_id: "app-1", status: "cancelled", step: "Onsite", starts_at: "2026-10-12T17:00:00Z",
  interviewer_actor_ids: ["actor-2"], created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

describe("getActivity", () => {
  test("someone the member cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(getActivity(fake.asDb(), ctx(), { candidateId: "p-x" }))).code).toBe("not_found");
  });

  test("the pipeline, notes, interviews, offers and tags as one timeline, newest first, each named", async () => {
    const fake = new FakeSupabase([
      { data: { id: "p-1" } },
      { data: [{ id: "app-1", source_detail: "Jane Doe", roles: { title: "Founding Engineer" } }] },
      // application_events
      {
        data: [
          { id: "ev-2", application_id: "app-1", actor_id: "actor-1", kind: "stage_changed", from_stage: "screening", to_stage: "rejected", detail: "Skills", created_at: "2026-10-13T00:00:00Z" },
          { id: "ev-3", application_id: "app-1", actor_id: "actor-1", kind: "owner_changed", from_stage: null, to_stage: null, detail: "Ivan", created_at: "2026-10-03T00:00:00Z" },
          { id: "ev-1", application_id: "app-1", actor_id: "actor-1", kind: "added", from_stage: null, to_stage: "sourced", detail: "referral", created_at: "2026-10-01T00:00:00Z" },
        ],
      },
      { data: [INTERVIEW] },
      // offers: status only reaches the feed
      { data: [{ id: "of-1", application_id: "app-1", status: "withdrawn", created_by_actor_id: "actor-1", created_at: "2026-10-08T00:00:00Z", extended_at: "2026-10-09T00:00:00Z", resolved_at: "2026-10-12T12:00:00Z" }] },
      { data: [{ id: "pt-1", added_by_actor_id: "actor-2", created_at: "2026-10-02T00:00:00Z", tags: { name: "Strong" } }] },
      { data: [{ id: "n-1", text: "Great call", actor_id: "actor-2", created_at: "2026-10-06T00:00:00Z" }] },
      // candidate_emails: sent ones only, the subject as text
      { data: [{ id: "em-1", application_id: "app-1", author_actor_id: "actor-1", subject: "Next steps", sent_at: "2026-10-07T00:00:00Z" }] },
      // the offers' approval requests: none
      { data: [] },
      { data: [{ id: "actor-1", display_name: "Ada Admin" }, { id: "actor-2", display_name: "Ivan Interviewer" }] },
    ]);
    const a = await getActivity(fake.asDb(), ctx(), { candidateId: "p-1" });
    expect(a.full).toBe(true);
    expect(a.entries.map((e) => [e.kind, e.actor])).toEqual([
      ["application.stage_changed", "Ada Admin"],
      ["offer.withdrawn", null],
      ["interview.cancelled", null],
      ["offer.extended", null],
      ["offer.drafted", "Ada Admin"],
      ["email", "Ada Admin"],
      ["note", "Ivan Interviewer"],
      ["interview.scheduled", null],
      ["application.owner_changed", "Ada Admin"],
      ["tag.added", "Ivan Interviewer"],
      ["application.added", "Ada Admin"],
    ]);
    const [moved] = a.entries;
    expect(moved).toMatchObject({ fromStage: "screening", toStage: "rejected", text: "Skills", jobTitle: "Founding Engineer" });
    expect(a.entries.find((e) => e.kind === "application.added")).toMatchObject({ source: "referral", text: "Jane Doe", toStage: "sourced" });
    expect(a.entries.find((e) => e.kind === "application.owner_changed")).toMatchObject({ people: ["Ivan"], text: null });
    expect(a.entries.find((e) => e.kind === "interview.scheduled")).toMatchObject({ people: ["Ivan Interviewer"], text: "Onsite", startsAt: INTERVIEW.starts_at });
    expect(a.entries.find((e) => e.kind === "tag.added")).toMatchObject({ text: "Strong", refId: "pt-1" });
    expect(a.entries.find((e) => e.kind === "email")).toMatchObject({ text: "Next steps", refId: "em-1", jobTitle: "Founding Engineer" });
    expect(fake.calls[7]).toMatchObject({ table: "candidate_emails", filters: expect.arrayContaining([{ method: "eq", column: "status", value: "sent" }]) });
    // Each source asks for at most the limit, newest first.
    for (const call of fake.calls.slice(2, 8)) expect(call.modifiers).toContainEqual({ method: "limit", value: 30 });
  });

  test("an offer's approval: who asked, each decision with its reason, and a reset", async () => {
    const fake = new FakeSupabase([
      { data: { id: "p-1" } },
      { data: [{ id: "app-1", source_detail: null, roles: { title: "Founding Engineer" } }] },
      { data: [] },
      { data: [] },
      { data: [{ id: "of-1", application_id: "app-1", status: "draft", created_by_actor_id: "actor-1", created_at: "2026-10-08T00:00:00Z", extended_at: null, resolved_at: null }] },
      // person_tags, person_notes, candidate_emails: none
      { data: [] },
      { data: [] },
      { data: [] },
      // the offers' approval requests, read after the six above
      { data: [
        {
          id: "req-2", offer_id: "of-1", status: "rejected", requested_by_actor_id: "actor-1", created_at: "2026-10-11T00:00:00Z", resolved_at: "2026-10-12T00:00:00Z",
          approval_decisions: [{ step: 1, decision: "rejected", actor_id: "actor-2", reason: "Over band", created_at: "2026-10-12T00:00:00Z" }],
        },
        {
          id: "req-1", offer_id: "of-1", status: "reset", requested_by_actor_id: "actor-1", created_at: "2026-10-09T00:00:00Z", resolved_at: "2026-10-10T00:00:00Z",
          approval_decisions: [],
        },
      ] },
      { data: [{ id: "actor-1", display_name: "Ada Admin" }, { id: "actor-2", display_name: "Fin Approver" }] },
    ]);
    const a = await getActivity(fake.asDb(), ctx(), { candidateId: "p-1" });
    expect(a.entries.map((e) => [e.kind, e.actor, e.refId])).toEqual([
      ["approval.rejected", "Fin Approver", "req-2"],
      ["approval.requested", "Ada Admin", "req-2"],
      ["approval.reset", null, "req-1"],
      ["approval.requested", "Ada Admin", "req-1"],
      ["offer.drafted", "Ada Admin", "of-1"],
    ]);
    expect(a.entries[0]).toMatchObject({ text: "Over band", jobTitle: "Founding Engineer", applicationId: "app-1" });
    expect(fake.calls[8]).toMatchObject({ table: "approval_requests", filters: [{ method: "in", column: "offer_id", value: ["of-1"] }] });
  });

  test("cut to the limit after merging; no applications means no pipeline reads", async () => {
    const fake = new FakeSupabase([
      { data: { id: "p-1" } },
      { data: [] },
      { data: [] },
      { data: [
        { id: "n-2", text: "second", actor_id: null, created_at: "2026-10-02T00:00:00Z" },
        { id: "n-1", text: "first", actor_id: null, created_at: "2026-10-01T00:00:00Z" },
      ] },
      { data: [] },
    ]);
    const a = await getActivity(fake.asDb(), ctx("elevated"), { candidateId: "p-1", limit: 1 });
    expect(a.entries.map((e) => e.refId)).toEqual(["n-2"]);
    expect(fake.calls.map((c) => c.table)).toEqual(["people", "applications", "person_tags", "person_notes", "candidate_emails"]);
  });

  test("an interviewer gets their own interviews with this candidate and their notes, through my_interviews", async () => {
    const elsewhere = new FakeSupabase([{ data: [{ person_id: "p-2", interview_id: "iv-9", application_id: "app-9", job_title: "Designer" }] }]);
    expect((await refusal(getActivity(elsewhere.asDb(), ctx("limited"), { candidateId: "p-1" }))).code).toBe("not_found");

    const fake = new FakeSupabase([
      { data: [{ person_id: "p-1", interview_id: "iv-1", application_id: "app-1", job_title: "Founding Engineer" }] },
      { data: [{ ...INTERVIEW, status: "scheduled", interviewer_actor_ids: ["actor-1"] }] },
      { data: [{ id: "n-1", text: "Sharp", actor_id: "actor-1", created_at: "2026-10-06T00:00:00Z" }] },
      { data: [{ id: "actor-1", display_name: "Ivan Interviewer" }] },
    ]);
    const a = await getActivity(fake.asDb(), ctx("limited"), { candidateId: "p-1" });
    expect(a.full).toBe(false);
    expect(a.entries.map((e) => [e.kind, e.jobTitle, e.people])).toEqual([
      ["note", null, []],
      ["interview.scheduled", "Founding Engineer", ["Ivan Interviewer"]],
    ]);
    expect(fake.calls[1]).toMatchObject({ table: "interviews", filters: [{ method: "in", column: "id", value: ["iv-1"] }] });
    expect(fake.calls.map((c) => c.table)).not.toContain("applications");
  });
});
