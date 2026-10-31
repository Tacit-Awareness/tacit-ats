import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readCandidate } from "./candidate";
import { dismissIssue, readDecisionLoop, readDone, readInbox, readIssueName } from "./inbox";
import { markRead, readDigest } from "./inbox-feed";
import { selectedRow, type ReadMark } from "./inbox-digest";
import { lastHeld } from "./interview-loop";

/**
 * The Inbox digest against the local stack, on members' own tokens: the
 * policies are the job scoping, a verdict shows only where feedback can be read,
 * a read mark is one member's, and Done is untouched by them.
 */

const db = () => getSupabaseServiceClient();

const ACME = "ea000000-0000-4000-8000-0000000000f1";
const GLOBEX = "ea100000-0000-4000-8000-0000000000f2";
const ADMIN = "eaa00000-0000-4000-8000-0000000000f1";
const LEAD = "eaa00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "eaa00000-0000-4000-8000-0000000000f3";
const GLOBEX_ADMIN = "eaa10000-0000-4000-8000-0000000000f1";
const ENGINEER = "eab00000-0000-4000-8000-0000000000f1";
const DESIGNER = "eab00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "eab10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `ead00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `eac00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const INTERVIEW = "eae00000-0000-4000-8000-0000000000f1";
const OTHER_INTERVIEW = "eae00000-0000-4000-8000-0000000000f2";
const FEEDBACK = "eaf00000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_digest_acme";
const GLOBEX_WORKOS = "org_itest_digest_globex";
const NOTES = "Private notes about the systems round";
const REJECTION = "Failed the reference check";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["inbox_dismissals", "interview_feedback", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const token = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const adaDb = () => token("user_dg_ada");
const leeDb = () => token("user_dg_lee");
const ginaDb = () => token("user_dg_gina", GLOBEX_WORKOS);

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const whats = (d: Awaited<ReturnType<typeof readDigest>>) => d.groups.flatMap((g) => g.rows.map((r) => r.what));

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-digest-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-digest-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-dg-admin", display_name: "Ada Admin", email: "ada@dg.test", access_level: "admin", auth_subject: "user_dg_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-dg-lead", display_name: "Lee Lead", email: "lee@dg.test", access_level: "elevated", auth_subject: "user_dg_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-dg-ivan", display_name: "Ivan Ng", email: "ivan@dg.test", access_level: "limited", auth_subject: "user_dg_ivan" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-dg-gina", display_name: "Gina Globex", email: "gina@dg.test", access_level: "admin", auth_subject: "user_dg_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", "open"], [DESIGNER, "Designer", "open"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", "open"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, status]) => ({ id, org_id: org, company_id: company!.id, title, status }))));
  }
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  // 1 and 2 on the engineer job, 3 on the designer job no one but an admin reads, 4 at another company.
  const apps = [
    [1, ACME, ENGINEER, "offer"],
    [2, ACME, ENGINEER, "rejected"],
    [3, ACME, DESIGNER, "interviewing"],
    [4, GLOBEX, GLOBEX_ROLE, "offer"],
  ] as const;
  must(await db().from("people").insert(apps.map(([n, org]) => ({ id: person(n), org_id: org, display_name: `Candidate ${n}`, email: `c${n}@dg.test` }))));
  for (const [n, org, role, stage] of apps) {
    must(await db().from("applications").insert({ id: app(n), org_id: org, person_id: person(n), role_id: role, stage, source: "sourced" }));
  }
  must(await db().from("application_events").delete().in("org_id", [ACME, GLOBEX]));
  must(await db().from("application_events").insert([
    { org_id: ACME, application_id: app(1), actor_id: ADMIN, kind: "stage_changed", from_stage: "interviewing", to_stage: "offer" },
    { org_id: ACME, application_id: app(2), actor_id: ADMIN, kind: "stage_changed", from_stage: "screening", to_stage: "rejected", detail: REJECTION },
    { org_id: ACME, application_id: app(3), actor_id: ADMIN, kind: "stage_changed", from_stage: "screening", to_stage: "interviewing" },
    { org_id: ACME, application_id: app(1), actor_id: ADMIN, kind: "note", detail: "Just a note" },
    { org_id: GLOBEX, application_id: app(4), actor_id: GLOBEX_ADMIN, kind: "stage_changed", from_stage: "screening", to_stage: "offer" },
  ]));
  must(await db().from("interviews").insert([
    { id: INTERVIEW, org_id: ACME, application_id: app(1), starts_at: at(-3), ends_at: at(-2), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER] },
    { id: OTHER_INTERVIEW, org_id: ACME, application_id: app(3), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Portfolio", interviewer_actor_ids: [ADMIN] },
  ]));
  must(await db().from("interview_feedback").insert({ id: FEEDBACK, org_id: ACME, interview_id: INTERVIEW, interviewer_actor_id: INTERVIEWER, recommendation: "strong_yes", rating: 4, notes: NOTES }));
});

afterAll(clear);

describe("job scoping, on the member's own token", () => {
  test("an admin reads every job at their company", async () => {
    const d = await readDigest(adaDb(), 1, NOW, 0);
    expect(whats(d).sort()).toEqual([
      "Candidate 1 is booked with Ivan.",
      "Candidate 1 moves to an offer.",
      "Candidate 2 is a no.",
      "Candidate 3 is booked with Ada.",
      "Candidate 3 moves to interviews.",
      "Ivan sent a read on Candidate 1: a strong yes.",
    ]);
  });

  test("a hiring manager reads their own job and nothing of the one they aren't on", async () => {
    const text = JSON.stringify(await readDigest(leeDb(), 1, NOW, 0));
    expect(text).toContain("Candidate 1");
    expect(text).toContain("Candidate 2");
    expect(text).not.toContain("Candidate 3");
    expect(text).not.toContain("Designer");
  });

  test("another company's member reads only their own", async () => {
    expect(whats(await readDigest(ginaDb(), 1, NOW, 0))).toEqual(["Candidate 4 moves to an offer."]);
  });

  test("every row opens over the Inbox by its own id, a closed application's too", async () => {
    const rows = (await readDigest(adaDb(), 1, NOW, 0)).groups.flatMap((g) => g.rows);
    const closed = rows.find((r) => r.what === "Candidate 2 is a no.")!;
    expect(closed.href).toBe(`/client/inbox?open=${closed.id}`);
    expect(closed).toMatchObject({ candidate: { id: person(2), name: "Candidate 2" }, applicationId: app(2), page: `/client/candidates/${person(2)}` });
  });

  test("a merged application and a cancelled interview drop out", async () => {
    must(await db().from("interviews").update({ status: "cancelled" }).eq("id", OTHER_INTERVIEW));
    must(await db().from("applications").update({ merged_into_id: app(2) }).eq("id", app(1)));
    const text = whats(await readDigest(adaDb(), 1, NOW, 0));
    expect(text.join()).not.toContain("Candidate 1");
    expect(text).not.toContain("Candidate 3 is booked with Ada.");
  });
});

describe("what stays private", () => {
  test("no notes, rating or rejection reason, in anything the read returns", async () => {
    const text = JSON.stringify(await readDigest(adaDb(), 7, NOW, 0));
    expect(text).not.toContain(NOTES);
    expect(text).not.toContain(REJECTION);
    expect(text).not.toContain('"rating"');
  });

  test("feedback hidden from a member isn't there at all, and an admin keeps the verdict", async () => {
    must(await db().from("orgs").update({ feedback_visibility: "never" }).eq("id", ACME));
    const lead = JSON.stringify(await readDigest(leeDb(), 1, NOW, 0));
    expect(lead).toContain("Candidate 1 moves to an offer.");
    expect(lead).not.toContain("sent a read");
    expect(lead).not.toContain("strong yes");
    expect(whats(await readDigest(adaDb(), 1, NOW, 0))).toContain("Ivan sent a read on Candidate 1: a strong yes.");
  });
});

// `?open=` is the row's id: it opens only what this member's own read listed.
describe("a row's pop-up param", () => {
  const rowsOf = async (client: ReturnType<typeof adaDb>) => (await readDigest(client, 1, NOW, 0)).groups;

  test("a row the member's read listed is found, and its candidate reads on their own token", async () => {
    const groups = await rowsOf(leeDb());
    const row = selectedRow(groups, groups[0]!.rows[0]!.id)!;
    expect(row).not.toBeNull();
    const view = await readCandidate(leeDb(), { actorId: LEAD, orgId: ACME, accessLevel: "elevated", source: "dashboard" }, row.candidate.id);
    expect(view?.candidate.candidateId).toBe(row.candidate.id);
  });

  test("the id of a row on a job they aren't on opens nothing", async () => {
    const designer = (await rowsOf(adaDb())).flatMap((g) => g.rows).find((r) => r.candidate.id === person(3))!;
    expect(selectedRow(await rowsOf(leeDb()), designer.id)).toBeNull();
  });

  test("another company's row opens nothing, and nor does a made-up or an application's id", async () => {
    const theirs = (await rowsOf(ginaDb()))[0]!.rows[0]!;
    const mine = await rowsOf(adaDb());
    expect(selectedRow(mine, theirs.id)).toBeNull();
    expect(selectedRow(mine, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(selectedRow(mine, app(1))).toBeNull();
  });

  test("a row marked read has left, so its old URL opens nothing", async () => {
    const row = (await rowsOf(adaDb()))[0]!.rows[0]!;
    await markRead(adaDb(), [row.mark]);
    expect(selectedRow(await rowsOf(adaDb()), row.id)).toBeNull();
  });
});

describe("a decision's whole ticket", () => {
  const lee = { actorId: LEAD, orgId: ACME, accessLevel: "elevated" as const };
  const gina = { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" as const };

  beforeEach(async () => {
    must(await db().from("roles").update({ interview_steps: ["Onsite", "Final"] }).eq("id", ENGINEER));
  });

  test("the loop and the read, on the member's own token", async () => {
    const read = await readDecisionLoop(leeDb(), lee, { jobId: ENGINEER, applicationId: app(1) });
    expect(read?.progress.steps.map((s) => s.step)).toEqual(["Onsite", "Final"]);
    expect(read?.feedback?.feedback.map((f) => f.recommendation)).toEqual(["strong_yes"]);
    expect(read?.stage).toBe("offer");
    expect(lastHeld(read!.progress, Date.now())).toBe(INTERVIEW);
  });

  test("a job they can't read is no ticket: an approver not on it keeps the reader", async () => {
    expect(await readDecisionLoop(leeDb(), lee, { jobId: DESIGNER, applicationId: app(3) })).toBeNull();
  });

  test("another company's job is none either", async () => {
    expect(await readDecisionLoop(ginaDb(), gina, { jobId: ENGINEER, applicationId: app(1) })).toBeNull();
  });

  test("feedback the company hides stays hidden, and the loop still draws", async () => {
    must(await db().from("orgs").update({ feedback_visibility: "never" }).eq("id", ACME));
    const read = await readDecisionLoop(leeDb(), lee, { jobId: ENGINEER, applicationId: app(1) });
    expect(read?.progress.steps).toHaveLength(2);
    expect(JSON.stringify(read)).not.toContain(NOTES);
    expect(read?.feedback?.feedback ?? []).toEqual([]);
  });

  test("the toast's name is whoever the member can read, and nobody else's", async () => {
    expect(await readIssueName(adaDb(), ADMIN, `app-${app(3)}`, [])).toBe("Candidate 3");
    expect(await readIssueName(leeDb(), LEAD, `app-${app(3)}`, [])).toBeNull();
    expect(await readIssueName(ginaDb(), GLOBEX_ADMIN, `app-${app(1)}`, [])).toBeNull();
  });
});

describe("read marks", () => {
  const unread = async (member: () => ReturnType<typeof adaDb>) => (await readDigest(member(), 1, NOW, 0)).unread;

  test("marking one is the member's alone, survives a reload, and a second press does nothing", async () => {
    const [mark] = await unread(adaDb);
    expect(await markRead(adaDb(), [mark!])).toEqual({ ok: true });
    expect(await markRead(adaDb(), [mark!])).toEqual({ ok: true });
    expect((await unread(adaDb)).map((m) => m.key)).not.toContain(mark!.key);
    const { data } = must(await db().from("inbox_dismissals").select("actor_id, issue_key, reason").eq("org_id", ACME));
    expect(data).toEqual([{ actor_id: ADMIN, issue_key: mark!.key, reason: mark!.reason }]);
  });

  test("a teammate's digest doesn't move", async () => {
    const lee = await unread(leeDb);
    await markRead(adaDb(), await unread(adaDb));
    expect(await unread(adaDb)).toEqual([]);
    expect((await unread(leeDb)).length).toBe(lee.length);
  });

  test("the microseconds survive the round trip", async () => {
    const marks = await unread(adaDb);
    expect(marks.some((m) => /\.\d{4,6}\+00:00$/.test(m.at))).toBe(true);
    await markRead(adaDb(), marks);
    expect((await readDigest(adaDb(), 1, NOW, 0)).groups).toEqual([]);
  });

  test("an interviewer can't write one", async () => {
    const [mark] = await unread(adaDb);
    expect(await markRead(token("user_dg_ivan"), [mark!])).toEqual({ ok: false, error: "refused" });
  });
});

describe("Done and Needs you ignore read marks", () => {
  const ada = { actorId: ADMIN, orgId: ACME, accessLevel: "admin" as const };
  const mark = (n: number): ReadMark => ({ key: `evt-eae10000-0000-4000-8000-${String(n).padStart(12, "0")}`, reason: "decided", at: at(-1) });

  test("a read mark isn't listed on Done", async () => {
    await markRead(adaDb(), await (await readDigest(adaDb(), 1, NOW, 0)).unread);
    const { standing } = await readInbox(adaDb(), ada, NOW);
    expect(await readDone(adaDb(), ADMIN, standing)).toEqual({ items: [], capped: false });
  });

  test("hundreds of them push no real dismissal off Done, and don't claim it was cut short", async () => {
    must(await db().from("applications").update({ last_touch_at: at(-9 * 24), stage: "screening" }).eq("id", app(1)));
    const { issues } = await readInbox(adaDb(), ada, NOW);
    const issue = issues.find((i) => i.key === `app-${app(1)}`)!;
    await dismissIssue(adaDb(), { key: issue.key, reason: issue.reason, at: issue.at });
    expect(await markRead(adaDb(), Array.from({ length: 250 }, (_, n) => mark(n)))).toEqual({ ok: true });

    const { standing } = await readInbox(adaDb(), ada, NOW);
    const done = await readDone(adaDb(), ADMIN, standing);
    expect(done.items.map((x) => x.what)).toEqual([issue.what]);
    expect(done.capped).toBe(false);
  });

  test("a read mark hides no issue", async () => {
    must(await db().from("applications").update({ last_touch_at: at(-9 * 24), stage: "screening" }).eq("id", app(1)));
    const before = (await readInbox(adaDb(), ada, NOW)).issues.map((i) => i.key);
    await markRead(adaDb(), (await readDigest(adaDb(), 1, NOW, 0)).unread);
    expect((await readInbox(adaDb(), ada, NOW)).issues.map((i) => i.key)).toEqual(before);
  });
});
