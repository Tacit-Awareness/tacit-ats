#!/usr/bin/env node
// Fills Tacit Test Co (docs/client-sandbox.md) with a mock hiring team, jobs
// and applicants spread across every stage, so the client pages have
// something real to show. Production, service role, and only ever this one
// org: it refuses to run against any other.
//
//   pnpm seed:test-co --env-file=<env with SUPABASE_URL, SUPABASE_SECRET_KEY> [--remove | --reset]
//
// Every row's id is derived from a fixed key, so a second run adds only what
// is missing, --remove deletes exactly what the seed made (and whatever was
// since hung on its applications: events, interviews, feedback), and --reset
// is the two in a row, which also brings every time back to "now".
//
// Rows go in as the job board, the pipeline and the interview tools write
// them (an `added` event, then one `stage_changed` per move), with the times
// set back. No upcoming interview is made: the company's bot is real, and it
// would be reminded of each one.

import { createHash } from "node:crypto";
import { APPLICANTS, DEPARTMENTS, JOBS, QUESTIONS, TEAM } from "./data.mjs";

const ORG_ID = "ddc79886-c318-4e07-89a5-d26d147763a5";
const ORG_NAME = "Tacit Test Co";
/** Ryan, the org's real admin: owns a few applications. */
const RYAN = "990a35ba-3234-4278-9b70-77858ae1ffd1";

const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length);
if (envFile) process.loadEnvFile(envFile);
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required (--env-file=<path>).");
  process.exit(1);
}
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--reset") ? "reset" : "seed";

// ---------------------------------------------------------------------------
// PostgREST, on the service role
// ---------------------------------------------------------------------------

const HEADERS = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Content-Type": "application/json" };

async function rest(method, path, body, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...HEADERS, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const select = (path) => rest("GET", path);
/** Inserts the rows that are not there yet; existing ids are left as they are. */
const insert = (table, rows) => (rows.length ? rest("POST", `${table}?on_conflict=id`, rows, "resolution=ignore-duplicates,return=minimal") : null);
const inList = (ids) => `in.(${ids.join(",")})`;
async function remove(table, column, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    await rest("DELETE", `${table}?org_id=eq.${ORG_ID}&${column}=${inList(ids.slice(i, i + 100))}`, undefined, "return=minimal");
  }
}

// ---------------------------------------------------------------------------
// Ids and times
// ---------------------------------------------------------------------------

/** A stable uuid (v4-shaped) for a key, the same on every run. */
function id(key) {
  const h = createHash("sha256").update(`tacit-test-co-seed:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const NOW = Date.now();
const HOUR = 3_600_000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const dayFromNow = (days) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);
const actor = (k) => (k === "ryan" ? RYAN : id(`actor:${k}`));
const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").trim().replace(/ +/g, "-");

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

function build() {
  const departments = Object.entries(DEPARTMENTS).map(([k, name]) => ({ id: id(`dept:${k}`), org_id: ORG_ID, name, created_at: ago(2400) }));

  const actors = Object.entries(TEAM).map(([k, p]) => ({
    id: actor(k), org_id: ORG_ID, slug: `c-tacit-test-co-seed-${k}`, display_name: p.name,
    email: `${slug(p.name).replace("-", ".")}@example.com`, access_level: p.access, created_at: ago(2400),
  }));

  const roles = [];
  const hiringTeam = [];
  const posts = [];
  for (const [k, j] of Object.entries(JOBS)) {
    roles.push({
      id: id(`role:${k}`), org_id: ORG_ID, title: j.title, status: j.status, location: j.location, seniority: j.seniority,
      department_id: id(`dept:${j.dept}`), description: j.description, pay_min: j.payMin, pay_max: j.payMax,
      interview_steps: j.steps, owner_actor_ids: j.team.hiring_manager.map(actor), created_at: ago(2200),
    });
    for (const [teamRole, who] of Object.entries(j.team)) {
      for (const w of who) hiringTeam.push({ id: id(`team:${k}:${w}`), org_id: ORG_ID, role_id: id(`role:${k}`), actor_id: actor(w), team_role: teamRole });
    }
    posts.push({
      id: id(`post:${k}`), org_id: ORG_ID, role_id: id(`role:${k}`), status: "draft", target: j.post,
      slug: id(`post-slug:${k}`).replace(/-/g, ""), title: j.title, location: j.location, description: j.description,
      questions: QUESTIONS, created_by_actor_id: actor("priya"), created_at: ago(2100),
    });
  }

  const people = [];
  const applications = [];
  const answers = [];
  const events = [];
  const interviews = [];
  const feedback = [];
  for (const a of APPLICANTS) {
    const job = JOBS[a.job];
    const personId = id(`person:${a.k}`);
    const appId = id(`app:${a.k}`);
    const board = a.source === "job_board";
    const linkedin = `https://www.linkedin.com/in/example-${a.k}`;
    const email = `${a.k.replace("-", ".")}@example.com`;
    const touch = a.touch ?? a.at;

    // The job board knows only what the form asked; the team fills in the rest later.
    const enriched = !board || (a.path ?? []).length > 0;
    people.push({
      id: personId, org_id: ORG_ID, display_name: a.name, email, phone: a.phone ?? null, linkedin_url: linkedin,
      current_title: enriched ? a.title : null, current_company: enriched ? a.company : null,
      location: enriched ? a.loc : null, summary: enriched ? (a.summary ?? null) : null, created_at: ago(a.at),
    });

    // Times for each move: spread from applying to the last touch, kept before
    // the recruiter screen (screening) or the first round after it
    // (interviewing), and after the last interview (any outcome).
    const path = a.path ?? [];
    const ivs = a.interviews ?? [];
    const earliest = (list) => (list.length ? Math.max(...list.map((iv) => iv.ago)) : null);
    const screen = earliest(ivs.filter((iv) => iv.step === "Recruiter screen"));
    const firstRound = earliest(ivs.filter((iv) => iv.step !== "Recruiter screen"));
    const lastIv = ivs.length ? Math.min(...ivs.map((iv) => iv.ago)) : null;
    let prev = a.at;
    const moves = path.map((stage, i) => {
      let at = a.at - ((a.at - touch) * (i + 1)) / path.length;
      if (stage === "screening" && screen !== null) at = Math.min(prev - 1, screen + 24);
      if (stage === "interviewing" && firstRound !== null) at = Math.min(prev - 1, firstRound + 24);
      if (["offer", "hired", "rejected", "withdrawn"].includes(stage) && lastIv !== null) at = Math.min(Math.max(at, 0.2), lastIv - 6);
      at = Math.min(at, prev - 0.5);
      prev = at;
      return { stage, at };
    });
    const stage = path.at(-1) ?? "sourced";
    const reason = a.reason ? { name: a.reason, kind: stage === "withdrawn" ? "withdrew" : "rejected" } : null;
    const lastTouch = Math.min(touch, moves.at(-1)?.at ?? a.at);

    applications.push({
      id: appId, org_id: ORG_ID, person_id: personId, role_id: id(`role:${a.job}`), stage, source: a.source,
      source_detail: board ? job.title : (a.detail ?? null), created_at: ago(a.at), updated_at: ago(lastTouch), last_touch_at: ago(lastTouch),
      owner_actor_id: a.owner ? actor(a.owner) : null, reason,
      next_action: a.next?.action ?? null, next_action_due: a.next ? dayFromNow(a.next.due) : null,
      next_action_owner_actor_id: a.next ? actor(a.next.owner) : null,
    });

    events.push({ id: id(`event:${a.k}:added`), org_id: ORG_ID, application_id: appId, kind: "added", from_stage: null, to_stage: "sourced", detail: a.source, created_at: ago(a.at),
      actor_id: board ? null : actor(a.owner ?? "priya") });
    let from = "sourced";
    for (const m of moves) {
      events.push({ id: id(`event:${a.k}:${m.stage}`), org_id: ORG_ID, application_id: appId, kind: "stage_changed", from_stage: from, to_stage: m.stage,
        detail: ["rejected", "withdrawn"].includes(m.stage) ? a.reason : null, created_at: ago(m.at), actor_id: actor(a.owner ?? "priya") });
      from = m.stage;
    }

    if (board) {
      const given = {
        name: a.name, email, phone: a.phone, linkedin, resume: `https://example.com/resumes/${a.k}.pdf`,
        q_location: a.loc, q_current: `${a.title}, ${a.company}`, q_whyus: a.cover,
        q_usauth: a.usAuth === undefined ? undefined : a.usAuth ? "yes" : "no", q_start: a.start,
      };
      answers.push({
        id: id(`answers:${a.k}`), org_id: ORG_ID, application_id: appId, job_post_id: id(`post:${a.job}`), submitted_at: ago(a.at),
        answers: QUESTIONS.filter((q) => given[q.id]).map((q) => ({ id: q.id, type: q.type, label: q.label, value: given[q.id] })),
      });
    }

    for (const iv of ivs) {
      const ivId = id(`interview:${a.k}:${iv.step}`);
      const minutes = /Founders|Onsite|Product build|Design exercise/.test(iv.step) ? 60 : 45;
      interviews.push({
        id: ivId, org_id: ORG_ID, application_id: appId, step: iv.step, status: "done", interviewer_actor_ids: [actor(iv.by)],
        starts_at: ago(iv.ago), ends_at: ago(iv.ago - minutes / 60), location_or_link: "https://meet.google.com/example",
        created_at: ago(Math.min(a.at - 0.1, iv.ago + 48)),
      });
      if (iv.fb) {
        feedback.push({ id: id(`feedback:${a.k}:${iv.step}`), org_id: ORG_ID, interview_id: ivId, interviewer_actor_id: actor(iv.by),
          recommendation: iv.fb.rec, rating: iv.fb.rating, notes: iv.fb.notes, submitted_at: ago(iv.ago - 3) });
      }
    }
  }
  return { departments, actors, roles, hiringTeam, posts, people, applications, answers, events, interviews, feedback };
}

// ---------------------------------------------------------------------------
// Seed and remove
// ---------------------------------------------------------------------------

async function seed() {
  const rows = build();
  const [company] = await select(`companies?org_id=eq.${ORG_ID}&select=id&order=created_at&limit=1`);
  if (!company) throw new Error("Tacit Test Co has no companies row");
  const reasons = await select(`rejection_reasons?org_id=eq.${ORG_ID}&select=id,kind,name&archived_at=is.null`);
  const reasonId = (r) => {
    const found = reasons.find((x) => x.kind === r.kind && x.name === r.name);
    if (!found) throw new Error(`no ${r.kind} reason named "${r.name}"`);
    return found.id;
  };

  await insert("departments", rows.departments);
  await insert("actors", rows.actors);
  await insert("roles", rows.roles.map((r) => ({ ...r, company_id: company.id })));
  await insert("hiring_team", rows.hiringTeam);

  // A post starts as a draft and moves forward one status at a time.
  await insert("job_posts", rows.posts.map(({ target, ...p }) => p));
  for (const p of rows.posts) {
    const order = ["draft", "live", "closed"];
    for (const status of order.slice(1, order.indexOf(p.target) + 1)) {
      const before = order[order.indexOf(status) - 1];
      await rest("PATCH", `job_posts?id=eq.${p.id}&status=eq.${before}`,
        { status, ...(status === "live" ? { published_at: ago(2000) } : { closed_at: ago(900) }) }, "return=minimal");
    }
  }

  await insert("people", rows.people);
  await insert("applications", rows.applications.map(({ reason, ...a }) => ({
    ...a, rejection_reason_id: reason ? reasonId(reason) : null,
  })));
  await insert("application_answers", rows.answers);
  await insert("application_events", rows.events);
  await insert("interviews", rows.interviews);
  await insert("interview_feedback", rows.feedback);

  const count = (stage) => rows.applications.filter((a) => a.stage === stage).length;
  const tickets = rows.applications.filter((a) => a.source === "job_board" && a.stage === "sourced").length;
  console.log(`Seeded ${ORG_NAME}: ${rows.actors.length} teammates, ${rows.roles.length} jobs, ${rows.people.length} candidates`);
  console.log(`  ${tickets} applicant tickets; by stage: ${["sourced", "contacted", "screening", "interviewing", "offer", "hired", "rejected", "withdrawn"].map((s) => `${s} ${count(s)}`).join(", ")}`);
  console.log(`  ${rows.interviews.length} past interviews, ${rows.feedback.length} with feedback`);
}

async function unseed() {
  const rows = build();
  const appIds = rows.applications.map((a) => a.id);
  // Whatever has been hung on the seeded applications since, too.
  const ivs = await select(`interviews?org_id=eq.${ORG_ID}&application_id=${inList(appIds)}&select=id`);
  const ivIds = [...new Set([...ivs.map((i) => i.id), ...rows.interviews.map((i) => i.id)])];
  if (ivIds.length) await remove("interview_feedback", "interview_id", ivIds);
  await remove("interviews", "id", ivIds);
  await remove("application_events", "application_id", appIds);
  await remove("application_answers", "application_id", appIds);
  await remove("applications", "id", appIds);
  await remove("people", "id", rows.people.map((p) => p.id));
  await remove("job_posts", "id", rows.posts.map((p) => p.id));
  await remove("hiring_team", "id", rows.hiringTeam.map((t) => t.id));
  await remove("roles", "id", rows.roles.map((r) => r.id));
  await remove("actors", "id", rows.actors.map((a) => a.id));
  await remove("departments", "id", rows.departments.map((d) => d.id));
  console.log(`Removed the seed from ${ORG_NAME}.`);
}

const [org] = await select(`orgs?id=eq.${ORG_ID}&select=id,name`);
if (org?.name !== ORG_NAME) {
  console.error(`Refusing: org ${ORG_ID} is ${org ? `"${org.name}"` : "missing"}, not ${ORG_NAME}.`);
  process.exit(1);
}
if (mode !== "seed") await unseed();
if (mode !== "remove") await seed();
