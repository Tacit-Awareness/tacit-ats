import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getSupabaseServiceClient } from "@tacit/db";

import { storeApplicantResume } from "../applicant-resume/store";
import { recordJobPostView, submitApplication } from "./jobs";

/**
 * The public pages' two captures against the local stack, as anon: the same
 * calls the routes make, on the publishable key with no token. What lands in
 * `job_post_views` and `applications.channel`, and that nothing about the
 * reader lands anywhere.
 */

const db = () => getSupabaseServiceClient();

const ORG = "e7000000-0000-4000-8000-0000000000f1";
const ROLE = "e7b00000-0000-4000-8000-0000000000f1";
const CLOSED_ROLE = "e7b00000-0000-4000-8000-0000000000f2";
const LIVE_POST = "e7f00000-0000-4000-8000-0000000000f1";
const DRAFT_POST = "e7f00000-0000-4000-8000-0000000000f2";
const CLOSED_JOB_POST = "e7f00000-0000-4000-8000-0000000000f3";
const LIVE = "itestcapturelivepost0000";
const DRAFT = "itestcapturedraftpost000";
const ON_CLOSED_JOB = "itestcaptureclosedjob000";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  for (const table of ["person_files", "application_answers", "application_events", "applications", "job_post_attempts", "people", "job_post_views", "job_posts", "roles", "companies"] as const) {
    must(await db().from(table).delete().eq("org_id", ORG));
  }
  await db().from("orgs").delete().eq("id", ORG);
}

const viewsOf = async (post: string) => (await db().from("job_post_views").select("views").eq("job_post_id", post)).data?.reduce((s, r) => s + r.views, 0) ?? 0;
const channels = async () => (await db().from("applications").select("channel, source, people!inner(email)").eq("org_id", ORG)).data ?? [];
const apply = (email: string, channel: Parameters<typeof submitApplication>[4], slug = LIVE) => submitApplication(slug, { name: "Nia", email }, "", {}, channel);

beforeAll(() => {
  process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY;
});

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert({ id: ORG, name: "Capture Co", slug: "itest-capture", kind: "client", workos_org_id: "org_itest_capture" }));
  const { data: company } = must(await db().from("companies").insert({ org_id: ORG, name: "Capture Co" }).select("id").single());
  must(await db().from("roles").insert([
    { id: ROLE, org_id: ORG, company_id: company!.id, title: "Engineer", status: "open" },
    { id: CLOSED_ROLE, org_id: ORG, company_id: company!.id, title: "Old job", status: "closed" },
  ]));
  const questions = [
    { id: "name", type: "name", label: "Name", required: true },
    { id: "email", type: "email", label: "Email", required: true },
    { id: "resume", type: "resume", label: "Resume", required: false },
  ];
  must(await db().from("job_posts").insert([
    { id: LIVE_POST, org_id: ORG, role_id: ROLE, title: "Engineer", slug: LIVE, questions },
    { id: DRAFT_POST, org_id: ORG, role_id: ROLE, title: "Engineer", slug: DRAFT, questions },
    { id: CLOSED_JOB_POST, org_id: ORG, role_id: CLOSED_ROLE, title: "Old job", slug: ON_CLOSED_JOB, questions },
  ]));
  must(await db().from("job_posts").update({ status: "live" }).in("id", [LIVE_POST, CLOSED_JOB_POST]));
});

afterAll(clear);

describe("a page view", () => {
  test("counts a live post, on today's UTC row", async () => {
    await recordJobPostView(LIVE);
    await recordJobPostView(LIVE);
    const { data } = await db().from("job_post_views").select("day, views, org_id").eq("job_post_id", LIVE_POST);
    expect(data).toEqual([{ day: new Date().toISOString().slice(0, 10), views: 2, org_id: ORG }]);
  });

  test("twenty at once all land, on one row", async () => {
    await Promise.all(Array.from({ length: 20 }, () => recordJobPostView(LIVE)));
    expect(await viewsOf(LIVE_POST)).toBe(20);
    expect((await db().from("job_post_views").select("day").eq("job_post_id", LIVE_POST)).data).toHaveLength(1);
  });

  test("a draft, a post on a closed job and a wrong slug count nothing and fail nothing", async () => {
    for (const slug of [DRAFT, ON_CLOSED_JOB, "z".repeat(24), "../nope"]) await expect(recordJobPostView(slug)).resolves.toBeUndefined();
    expect(await viewsOf(DRAFT_POST)).toBe(0);
    expect(await viewsOf(CLOSED_JOB_POST)).toBe(0);
  });
});

describe("the channel on apply", () => {
  test("lands on the new application, as job_board like any other", async () => {
    expect(await apply("nia@capture.test", "linkedin")).toEqual({ status: "ok" });
    expect(await channels()).toEqual([expect.objectContaining({ channel: "linkedin", source: "job_board" })]);
  });

  test("every value the page can send is one the function takes", async () => {
    for (const c of ["linkedin", "hackernews", "direct", "other"] as const) expect(await apply(`${c}@capture.test`, c)).toEqual({ status: "ok" });
    expect((await channels()).map((a) => a.channel).sort()).toEqual(["direct", "hackernews", "linkedin", "other"]);
  });

  test("no channel is the old call and records none", async () => {
    expect(await apply("nia@capture.test", null)).toEqual({ status: "ok" });
    expect((await channels())[0].channel).toBeNull();
  });

  test("EEO answers still land beside a channel", async () => {
    expect(await submitApplication(LIVE, { name: "Nia", email: "eeo@capture.test" }, "", { gender: "female" }, "hackernews")).toEqual({ status: "ok" });
    const { data } = await db().from("applications").select("channel, eeoc_responses(gender)").eq("org_id", ORG).single();
    expect(data?.channel).toBe("hackernews");
    expect(JSON.stringify(data?.eeoc_responses)).toContain("female");
  });

  test("someone already in the job keeps the channel they came in on", async () => {
    await apply("nia@capture.test", "linkedin");
    await apply("nia@capture.test", "hackernews");
    expect((await channels()).map((a) => a.channel)).toEqual(["linkedin"]);
  });

  test("the honeypot still answers a quiet success and writes nothing", async () => {
    expect(await submitApplication(LIVE, { name: "Bot", email: "bot@capture.test" }, "filled", {}, "other")).toEqual({ status: "ok" });
    expect(await channels()).toEqual([]);
  });

  test("a post that is not live is still the same not found", async () => {
    expect(await apply("nia@capture.test", "linkedin", DRAFT)).toEqual({ status: "not_found" });
    expect(await apply("nia@capture.test", "linkedin", ON_CLOSED_JOB)).toEqual({ status: "not_found" });
  });
});

describe("an uploaded resume (20261108120000)", () => {
  const resume = { filename: "Nia CV.pdf", contentType: "application/pdf", sizeBytes: 1024 };
  const files = async () =>
    (await db().from("person_files").select("id, org_id, person_id, kind, filename, storage_path, uploaded_by_actor_id").eq("org_id", ORG)).data ?? [];

  test("lands its row on the new candidate, at the path the call answers", async () => {
    const outcome = await submitApplication(LIVE, { name: "Nia", email: "cv@capture.test" }, "", {}, "linkedin", resume);
    const [file] = await files();
    expect(outcome).toEqual({ status: "ok", resumePath: `${ORG}/${file.person_id}/${file.id}` });
    expect(file).toMatchObject({ kind: "resume", filename: "Nia CV.pdf", storage_path: outcome.status === "ok" ? outcome.resumePath : null, uploaded_by_actor_id: null });
    const { data: answers } = await db().from("application_answers").select("answers").eq("org_id", ORG).single();
    expect(JSON.stringify(answers?.answers)).toContain('"value":"Nia CV.pdf"');
    expect((await channels())[0].channel).toBe("linkedin");
  });

  test("someone already in the job gets no second file, and no path", async () => {
    await submitApplication(LIVE, { name: "Nia", email: "cv@capture.test" }, "", {}, null, resume);
    expect(await submitApplication(LIVE, { name: "Nia", email: "cv@capture.test" }, "", {}, null, resume)).toEqual({ status: "ok", resumePath: null });
    expect(await files()).toHaveLength(1);
  });

  test("a store that fails takes its row away again, and a path that is no row's is never tried", async () => {
    const outcome = await submitApplication(LIVE, { name: "Nia", email: "lost@capture.test" }, "", {}, null, resume);
    const path = outcome.status === "ok" ? outcome.resumePath! : "";
    // The local stack has no org-files bucket, so the upload fails as a real outage would.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await storeApplicantResume(path, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).toBe(false);
    errors.mockRestore();
    expect(await files()).toEqual([]);
    expect((await channels()).length).toBe(1);
    expect(await storeApplicantResume("../somewhere/else", new Uint8Array([1]), "application/pdf")).toBe(false);
  });
});

describe("the two captures are not joined", () => {
  test("a view row holds a count and no reader, and anon reads neither table", async () => {
    await recordJobPostView(LIVE);
    const { data } = await db().from("job_post_views").select("*").eq("job_post_id", LIVE_POST).single();
    expect(Object.keys(data!).sort()).toEqual(["day", "job_post_id", "minute_at", "minute_views", "org_id", "views"]);
    const { createUserClient } = await import("@tacit/db");
    const anon = createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => null);
    const views = await anon.from("job_post_views").select("views");
    expect(views.data ?? []).toEqual([]);
    const apps = await anon.from("applications").select("channel");
    expect(apps.data ?? []).toEqual([]);
  });
});
