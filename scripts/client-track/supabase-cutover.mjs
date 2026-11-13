#!/usr/bin/env node
// Cutover from WorkOS to Supabase Auth on the client project (the plan:
// https://claude.ai/artifact/DTK4YUVXtJhbCJRq52EEmb, "Data migration").
//
//   node scripts/client-track/supabase-cutover.mjs                  dry run: prints the plan, writes nothing
//   node scripts/client-track/supabase-cutover.mjs --apply          creates the accounts and relinks the actors
//   node scripts/client-track/supabase-cutover.mjs --apply --send-emails
//                                                                   ... and emails each one a set-password link
//   node scripts/client-track/supabase-cutover.mjs --rollback <file>  puts back the WorkOS subjects a run recorded
//
//   SUPABASE_URL, SUPABASE_SECRET_KEY    the project (tacit-ats, or its staging twin, or the local stack)
//
// What --apply does, for every unarchived actor bound to a WorkOS user
// (auth_subject `user_...`):
//   1. finds or creates the Supabase Auth user for that actor's email
//      (email_confirm: true, since WorkOS verified it; no password: they set
//      one from the email);
//   2. rewrites actors.auth_subject from the WorkOS id to the Supabase user id,
//      conditional on it still being that WorkOS id. Never null: null means a
//      pending invitation.
// It writes a record of every change to cutover-<time>.json in the current
// directory before the first write, and again after each, so --rollback can
// undo exactly what ran, even a partial run.
//
// Left alone: pending invitations (null subject: each binds on first sign-in,
// by verified email), actors already on Supabase, archived actors, and an
// actor with no email (reported). Two WorkOS subjects on one address are
// reported and skipped: someone has to decide which is right.
//
// --send-emails sends Supabase's reset email (supabase/templates/recovery.html,
// its link to /client/auth/confirm then /client/set-password) to each address
// relinked in this run, after every relink has gone through.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sendEmails = args.includes("--send-emails");
const rollbackFile = args.includes("--rollback") ? args[args.indexOf("--rollback") + 1] : null;

const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const key = process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(2);
}
if (sendEmails && !apply) {
  console.error("--send-emails goes with --apply.");
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };

async function call(path, init = {}) {
  const response = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]}: ${response.status} ${text.slice(0, 200)}`);
  return body;
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const body = await call(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    users.push(...(body.users ?? []));
    if ((body.users ?? []).length < 1000) return users;
  }
}

const isWorkos = (subject) => typeof subject === "string" && subject.startsWith("user_");
const norm = (email) => email?.trim().toLowerCase() || null;

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------
if (rollbackFile) {
  const record = JSON.parse(readFileSync(rollbackFile, "utf8"));
  let restored = 0;
  for (const change of record.relinked ?? []) {
    const rows = await call(
      `/rest/v1/actors?id=eq.${change.actorId}&auth_subject=eq.${change.to}`,
      { method: "PATCH", body: JSON.stringify({ auth_subject: change.from }), headers: { prefer: "return=representation" } },
    );
    if (rows.length) restored++;
    else console.log(`  left as is: ${change.org} / ${change.email} no longer has ${change.to}`);
  }
  console.log(`Rolled back ${restored} of ${(record.relinked ?? []).length} actors to their WorkOS subjects.`);
  console.log("Accounts created in Supabase Auth are left in place (harmless without a binding); delete them by hand if wanted.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
const actors = await call(
  "/rest/v1/actors?select=id,display_name,email,auth_subject,archived_at,orgs!actors_org_id_fkey(name)&auth_subject=not.is.null&order=email",
);
const workos = actors.filter((a) => isWorkos(a.auth_subject));
const live = workos.filter((a) => !a.archived_at);
const noEmail = live.filter((a) => !norm(a.email));

const byEmail = new Map();
for (const actor of live.filter((a) => norm(a.email))) {
  const email = norm(actor.email);
  if (!byEmail.has(email)) byEmail.set(email, []);
  byEmail.get(email).push(actor);
}

const users = await allUsers();
const userByEmail = new Map(users.filter((u) => u.email).map((u) => [norm(u.email), u]));

const plan = [];
const conflicts = [];
for (const [email, list] of byEmail) {
  const subjects = [...new Set(list.map((a) => a.auth_subject))];
  if (subjects.length > 1) {
    conflicts.push({ email, subjects, orgs: list.map((a) => a.orgs?.name) });
    continue;
  }
  plan.push({ email, existing: userByEmail.get(email) ?? null, actors: list });
}

console.log(`${apply ? "APPLYING" : "DRY RUN"} on ${url}`);
console.log(`${workos.length} actors bound to WorkOS (${live.length} unarchived), ${plan.length} addresses to move.\n`);
for (const p of plan) {
  console.log(`${p.email}: ${p.existing ? "uses its existing Supabase account" : "gets a new Supabase account"}`);
  for (const a of p.actors) console.log(`    ${a.orgs?.name ?? "?"} (${a.display_name ?? "?"})`);
}
for (const c of conflicts) console.log(`SKIPPED ${c.email}: more than one WorkOS subject (${c.subjects.join(", ")}) across ${c.orgs.join(", ")}`);
for (const a of noEmail) console.log(`SKIPPED ${a.orgs?.name} / ${a.display_name}: no email on the actor`);
const archived = workos.length - live.length;
if (archived) console.log(`Left alone: ${archived} archived actor(s) still naming WorkOS.`);

if (!apply) {
  console.log(`\nNothing written. Run again with --apply${plan.length ? " (and --send-emails to email each address)" : ""}.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
const recordFile = `cutover-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const record = { project: url, startedAt: new Date().toISOString(), relinked: [], created: [], emailed: [], failed: [] };
const save = () => writeFileSync(recordFile, JSON.stringify(record, null, 2));
save();
console.log(`\nRecording every change in ${recordFile}`);

const moved = [];
for (const p of plan) {
  let user = p.existing;
  try {
    if (!user) {
      user = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: p.email, email_confirm: true }) });
      record.created.push({ email: p.email, userId: user.id });
      save();
    }
    for (const a of p.actors) {
      const rows = await call(
        `/rest/v1/actors?id=eq.${a.id}&auth_subject=eq.${encodeURIComponent(a.auth_subject)}`,
        { method: "PATCH", body: JSON.stringify({ auth_subject: user.id }), headers: { prefer: "return=representation" } },
      );
      if (rows.length) {
        record.relinked.push({ actorId: a.id, org: a.orgs?.name ?? null, email: p.email, from: a.auth_subject, to: user.id });
        save();
      } else {
        console.log(`  ${a.orgs?.name} / ${p.email}: changed since the plan was read, left as is`);
      }
    }
    moved.push(p.email);
    console.log(`  moved ${p.email}`);
  } catch (error) {
    record.failed.push({ email: p.email, error: String(error.message ?? error) });
    save();
    console.log(`  FAILED ${p.email}: ${error.message ?? error}`);
  }
}

if (sendEmails) {
  for (const email of moved) {
    try {
      await call("/auth/v1/recover", { method: "POST", body: JSON.stringify({ email }) });
      record.emailed.push(email);
      save();
      console.log(`  emailed ${email}`);
    } catch (error) {
      record.failed.push({ email, error: `email: ${error.message ?? error}` });
      save();
      console.log(`  EMAIL FAILED ${email}: ${error.message ?? error}`);
    }
  }
}

record.finishedAt = new Date().toISOString();
save();
console.log(`\nRelinked ${record.relinked.length} actors, created ${record.created.length} accounts${sendEmails ? `, emailed ${record.emailed.length}` : ""}, ${record.failed.length} failed.`);
console.log(`Undo with: node scripts/client-track/supabase-cutover.mjs --rollback ${recordFile}`);
process.exit(record.failed.length ? 1 : 0);
