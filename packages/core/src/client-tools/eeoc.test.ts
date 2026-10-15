import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { eeocReport, recordEeoc, suppressColumn } from "./eeoc.js";

/**
 * EEO self-identification: who may record a paper form and what reaches the
 * audit row, and the report's small-cell suppression. That no one but an
 * admin reads a row is the policy's, pinned in the SQL suite (section 27).
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

describe("the table is read in one place", () => {
  test("nothing else in client-tools touches eeoc_responses, so get_candidate and the rest never show it", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const readers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /eeoc_responses|record_eeoc/.test(readFileSync(join(dir, f), "utf8")));
    expect(readers).toEqual(["eeoc.ts"]);
  });
});

describe("recordEeoc", () => {
  test("an empty form, or an answer outside the categories, is refused before any query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(recordEeoc(fake.asDb(), ctx(), { applicationId: "app-1" }))).message).toMatch(/at least one/);
    expect((await refusal(recordEeoc(fake.asDb(), ctx(), {
      applicationId: "app-1", gender: "robot" as never,
    }))).message).toMatch(/gender is one of/);
    expect(fake.calls).toEqual([]);
  });

  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(recordEeoc(fake.asDb(), ctx("limited"), { applicationId: "app-1", gender: "female" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("someone who cannot manage the job is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: { id: "app-1", role_id: "job-1" } }, { data: false }]);
    const err = await refusal(recordEeoc(fake.asDb(), ctx("elevated"), { applicationId: "app-1", gender: "female" }));
    expect(err.message).toMatch(/manage this job/);
    expect(fake.calls.filter((c) => c.op === "rpc").map((c) => c.table)).toEqual(["can_on_role"]);
  });

  test("a recorded form is audited without a single answer in the row", async () => {
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "job-1" } }, { data: true }, { data: "audit-1" }, { data: "recorded" }, { data: null },
    ]);
    const r = await recordEeoc(fake.asDb(), ctx(), {
      applicationId: "app-1", gender: "female", raceEthnicity: "asian", disabilityStatus: "decline_to_self_identify",
    });
    expect(r).toEqual({ outcome: "recorded", applicationId: "app-1" });
    const record = fake.calls.find((c) => c.table === "record_eeoc");
    expect(record?.args).toEqual({
      p_application: "app-1", p_gender: "female", p_race_ethnicity: "asian", p_veteran_status: undefined,
      p_disability_status: "decline_to_self_identify",
    });
    const claim = fake.calls.find((c) => c.table === "client_claim_write");
    expect(claim?.args).toMatchObject({ p_action: "eeoc.record", p_entity: "application" });
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(JSON.stringify(finish?.args)).not.toMatch(/female|asian|decline/);
  });

  test("the candidate's own answers are not overwritten, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "job-1" } }, { data: true }, { data: "audit-1" },
      { error: { code: "23505", message: "the candidate answered for themselves" } }, { data: null },
    ]);
    const err = await refusal(recordEeoc(fake.asDb(), ctx(), { applicationId: "app-1", gender: "male" }));
    expect(err.message).toMatch(/answered these questions themselves/);
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({ p_audit: "audit-1", p_keep: false });
  });
});

describe("suppressColumn", () => {
  test("cells under five become <5", () => {
    expect(suppressColumn([12, 3, 0, 7])).toEqual([12, "<5", "<5", 7]);
  });

  test("a lone small cell would be the total minus the rest, so the next smallest is hidden too", () => {
    expect(suppressColumn([12, 3, 7])).toEqual([12, "<5", "hidden"]);
    expect(suppressColumn([12, 9, 7])).toEqual([12, 9, 7]);
  });
});

describe("eeocReport", () => {
  const response = (gender: string | null, race: string | null, stage = "screening") => ({
    gender, race_ethnicity: race, veteran_status: null, disability_status: null, applications: { stage },
  });

  test("admins only, before any query", async () => {
    for (const level of ["elevated", "limited"] as const) {
      const fake = new FakeSupabase();
      expect((await refusal(eeocReport(fake.asDb(), ctx(level)))).code).toBe("forbidden");
      expect(fake.calls).toEqual([]);
    }
  });

  test("fewer than five responses: no breakdown at all", async () => {
    const fake = new FakeSupabase([{ count: 40 }, { data: [response("female", "asian"), response("male", "white")] }]);
    const r = await eeocReport(fake.asDb(), ctx());
    expect(r).toMatchObject({ applications: 40, responses: "<5", hired: "<5", questions: [] });
  });

  test("per answer, applicants and hires, with every small cell suppressed", async () => {
    const rows = [
      ...Array.from({ length: 6 }, () => response("female", "asian", "hired")),
      ...Array.from({ length: 5 }, () => response("male", "white")),
      response("decline_to_self_identify", null),
    ];
    const fake = new FakeSupabase([{ count: 20 }, { data: rows }]);
    const r = await eeocReport(fake.asDb(), ctx());
    expect(r).toMatchObject({ applications: 20, responses: 12, hired: 6, minCell: 5 });
    const gender = r.questions.find((q) => q.question === "gender")!;
    expect(gender.rows).toEqual([
      { answer: "male", applicants: 5, hired: "<5" },
      { answer: "female", applicants: 6, hired: 6 },
      { answer: "decline_to_self_identify", applicants: "<5", hired: "<5" },
      { answer: "not_answered", applicants: "<5", hired: "<5" },
    ]);
    const veteran = r.questions.find((q) => q.question === "veteran_status")!;
    expect(veteran.rows.find((x) => x.answer === "not_answered")).toEqual({ answer: "not_answered", applicants: 12, hired: 6 });
    // No row in the output is one person's: only counts and the answer names.
    expect(JSON.stringify(r)).not.toMatch(/application_id|candidate/);
  });
});
