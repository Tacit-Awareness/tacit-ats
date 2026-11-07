#!/usr/bin/env node
// The org-scoped data copy (docs/client-project-split.md, stage 3): every row
// of the client orgs from tacit into tacit-ats, and their files.
//
//   node scripts/client-track/copy-orgs.mjs <out dir> [--load] [--storage] [--orgs=<id,id>]
//
//   SOURCE_DB_URL, TARGET_DB_URL     direct Postgres URLs (session mode, as postgres)
//   SOURCE_SUPABASE_URL, SOURCE_SECRET_KEY, TARGET_SUPABASE_URL, TARGET_SECRET_KEY
//                                    for --storage only
//
// Without --load it only exports: one consistent snapshot (repeatable read)
// of each table's rows for those orgs into <out dir> as CSV, plus the load
// script, and prints the counts. --load then runs that script on the target
// in one transaction: it deletes whatever those orgs already have there (so a
// second run, the final copy at cutover, replaces the first), loads every
// table with triggers off (session_replication_role = replica: the rows are
// history, so no tenant_set_org_id, set_current_actor, validator or seed
// trigger may touch them), then, with triggers back on, checks every foreign
// key on the copied tables for orphans and that no client person names an
// auth user, and commits only if all of that holds. Last it compares counts.
//
// --storage copies each org's objects in the org-files bucket (<org>/...) and
// the org-brand bucket, and points orgs.brand_logo_url at the target.
//
// Never deletes or changes anything on the source.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const TACIT_ORG = "7ac17000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--"));
const load = args.includes("--load");
const storage = args.includes("--storage");
const orgArg = args.find((a) => a.startsWith("--orgs="))?.slice("--orgs=".length);
const { SOURCE_DB_URL, TARGET_DB_URL } = process.env;
if (!outDir || !SOURCE_DB_URL || !TARGET_DB_URL) {
  console.error("usage: SOURCE_DB_URL=... TARGET_DB_URL=... copy-orgs.mjs <out dir> [--load] [--storage] [--orgs=<id,id>]");
  process.exit(1);
}
const dir = resolve(outDir);
mkdirSync(dir, { recursive: true });

const psql = (url, sql) =>
  execFileSync("psql", [url, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-F", "\t", "-c", sql], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psqlFile = (url, file) =>
  execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const rows = (out) => out.split("\n").filter(Boolean).map((l) => l.split("\t"));
const lit = (ids) => `array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`;

// The orgs: every client org, or the ones named. Never Tacit's own.
const orgs = orgArg
  ? orgArg.split(",").map((s) => s.trim().toLowerCase())
  : rows(psql(SOURCE_DB_URL, "select id from public.orgs where kind = 'client' order by created_at")).map((r) => r[0]);
if (orgs.length === 0 || orgs.some((id) => !UUID.test(id) || id === TACIT_ORG)) {
  console.error(`refusing these orgs: ${orgs.join(", ") || "(none)"}`);
  process.exit(1);
}
const ORGS = lit(orgs);

// What to copy, from the target's catalog: every table with org_id, plus the
// client rows of the few keyed by an actor or an interview. The staff-only
// tables the track keeps (because client functions name them) hold Tacit's
// rows only and are not copied.
const ACTOR_KEYED = ["mcp_calls", "notify_subscriptions", "scheduling_cursors", "interview_agent_threads"];
const INTERVIEW_KEYED = ["interview_reminder_timers"];
const SKIP = new Set(["tacit_submissions"]);
const withOrg = rows(psql(TARGET_DB_URL, `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r[0]).filter((t) => !SKIP.has(t));
const filterOf = (table) => {
  if (table === "orgs") return `id = any (${ORGS})`;
  if (ACTOR_KEYED.includes(table)) return `actor_id in (select id from public.actors where org_id = any (${ORGS}))`;
  if (INTERVIEW_KEYED.includes(table)) return `interview_id in (select id from public.interviews where org_id = any (${ORGS}))`;
  return `org_id = any (${ORGS})`;
};
const tables = ["orgs", ...withOrg, ...ACTOR_KEYED, ...INTERVIEW_KEYED];

// Columns both sides have, minus generated ones (the target's own added
// columns, like people.staff_person_id, are left to their defaults).
const columnsOf = (url, table) =>
  rows(psql(url, `select column_name from information_schema.columns where table_schema = 'public' and table_name = '${table}' and is_generated = 'NEVER' order by ordinal_position`)).map((r) => r[0]);
const plan = tables.map((table) => {
  const source = new Set(columnsOf(SOURCE_DB_URL, table));
  const cols = columnsOf(TARGET_DB_URL, table).filter((c) => source.has(c));
  if (cols.length === 0) throw new Error(`${table}: no columns in common`);
  return { table, cols: cols.map((c) => `"${c}"`).join(", "), filter: filterOf(table), file: join(dir, `${table}.csv`) };
});

// 1. Export: one snapshot.
const exportSql = join(dir, "export.sql");
writeFileSync(exportSql, [
  "begin isolation level repeatable read read only;",
  ...plan.map((p) => `\\copy (select ${p.cols} from public.${p.table} where ${p.filter}) to '${p.file}' with (format csv)`),
  "commit;",
].join("\n") + "\n");
psqlFile(SOURCE_DB_URL, exportSql);
const sourceCounts = Object.fromEntries(plan.map((p) => [p.table, Number(psql(SOURCE_DB_URL, `select count(*) from public.${p.table} where ${p.filter}`).trim())]));

// 2. The load script.
const loadSql = join(dir, "load.sql");
writeFileSync(loadSql, `-- Generated by copy-orgs.mjs for ${orgs.length} org(s). One transaction.
begin;
set local session_replication_role = replica;
${[...plan].reverse().map((p) => `delete from public.${p.table} where ${p.filter};`).join("\n")}
${plan.map((p) => `\\copy public.${p.table} (${p.cols}) from '${p.file}' with (format csv)`).join("\n")}
set local session_replication_role = origin;

-- Every foreign key on a copied table must hold (MATCH SIMPLE: a key with a
-- null column is not checked, as Postgres does).
do $$
declare
  k record;
  q text;
  n bigint;
  bad text := '';
begin
  for k in
    select c.conrelid::regclass as child, c.confrelid::regclass as parent, c.conname,
           array(select format('c.%I', a.attname) from unnest(c.conkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.n order by u.i) as ccols,
           array(select format('p.%I', a.attname) from unnest(c.confkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = u.n order by u.i) as pcols
    from pg_constraint c
    where c.contype = 'f' and c.conrelid::regclass::text in (${plan.map((p) => `'${p.table}'`).join(", ")})
  loop
    q := format('select count(*) from %s c where %s and not exists (select 1 from %s p where (%s) = (%s))',
      k.child, array_to_string(array(select x || ' is not null' from unnest(k.ccols) x), ' and '),
      k.parent, array_to_string(k.pcols, ', '), array_to_string(k.ccols, ', '));
    execute q into n;
    if n > 0 then bad := bad || format(E'\\n  %s.%s: %s orphan row(s)', k.child, k.conname, n); end if;
  end loop;
  if bad <> '' then raise exception 'foreign keys broken by the copy:%', bad; end if;
  if exists (select 1 from public.people where org_id = any (${ORGS}) and auth_user_id is not null) then
    raise exception 'a client person names an auth user, which this project does not have';
  end if;
end $$;
commit;
`);

console.log(`orgs: ${orgs.join(", ")}`);
console.log(`exported to ${dir}`);

// 3. Load, then compare.
if (load) {
  psqlFile(TARGET_DB_URL, loadSql);
  // Counts and a checksum of every row's text over the columns copied, on
  // both sides. orgs is left out of the checksum when --storage will move
  // its logo URL.
  const digest = (url, p) =>
    psql(url, `select count(*) || ':' || coalesce(md5(string_agg(r::text, '|' order by r::text)), '') from (select ${p.cols} from public.${p.table} where ${p.filter}) r`).trim();
  let mismatched = 0;
  for (const p of plan) {
    const [source, target] = [digest(SOURCE_DB_URL, p), digest(TARGET_DB_URL, p)];
    const same = source === target;
    if (!same) mismatched++;
    const [n, m] = [source.split(":")[0], target.split(":")[0]];
    if (n !== "0" || m !== "0") console.log(`${p.table.padEnd(32)} ${n.padStart(7)} -> ${m.padStart(7)}${same ? "" : "  MISMATCH"}`);
  }
  if (mismatched) {
    console.error(`${mismatched} table(s) differ: the source changed during the copy, or a row did not load. Pause writes and run again.`);
    process.exit(1);
  }
  console.log("loaded: every row matches.");
} else {
  for (const p of plan) if (sourceCounts[p.table]) console.log(`${p.table.padEnd(32)} ${String(sourceCounts[p.table]).padStart(7)}`);
  console.log("not loaded (pass --load).");
}

// 4. Files.
if (storage) await copyStorage();

async function copyStorage() {
  const { SOURCE_SUPABASE_URL: srcUrl, SOURCE_SECRET_KEY: srcKey, TARGET_SUPABASE_URL: dstUrl, TARGET_SECRET_KEY: dstKey } = process.env;
  if (!srcUrl || !srcKey || !dstUrl || !dstKey) throw new Error("--storage needs SOURCE_/TARGET_SUPABASE_URL and SOURCE_/TARGET_SECRET_KEY");
  const auth = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

  const ensureBucket = async (id, isPublic) => {
    const res = await fetch(`${dstUrl}/storage/v1/bucket`, {
      method: "POST", headers: { ...auth(dstKey), "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: id, public: isPublic }),
    });
    if (!res.ok && res.status !== 409 && !(await res.text()).includes("already exists")) throw new Error(`bucket ${id}: ${res.status}`);
  };
  // Every object under a prefix: the list API is one folder at a time.
  const list = async (bucket, prefix) => {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${srcUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST", headers: { ...auth(srcKey), "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      });
      if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status}`);
      const page = await res.json();
      for (const item of page) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) out.push(...(await list(bucket, path)));
        else out.push(path);
      }
      if (page.length < 1000) return out;
    }
  };
  const copy = async (bucket, path) => {
    const got = await fetch(`${srcUrl}/storage/v1/object/${bucket}/${path}`, { headers: auth(srcKey) });
    if (!got.ok) throw new Error(`download ${bucket}/${path}: ${got.status}`);
    const put = await fetch(`${dstUrl}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { ...auth(dstKey), "Content-Type": got.headers.get("content-type") ?? "application/octet-stream", "x-upsert": "true" },
      body: Buffer.from(await got.arrayBuffer()),
    });
    if (!put.ok) throw new Error(`upload ${bucket}/${path}: ${put.status}`);
  };

  await ensureBucket("org-files", false);
  await ensureBucket("org-brand", true);
  let files = 0;
  for (const org of orgs) {
    for (const path of await list("org-files", org)) { await copy("org-files", path); files++; }
  }
  const logos = rows(psql(SOURCE_DB_URL, `select id, brand_logo_url from public.orgs where id = any (${ORGS}) and brand_logo_url is not null`));
  const brandPrefix = `${srcUrl}/storage/v1/object/public/org-brand/`;
  for (const [id, url] of logos) {
    if (!url.startsWith(brandPrefix)) continue; // a logo hosted elsewhere stays as it is
    const path = url.slice(brandPrefix.length).split("?")[0];
    await copy("org-brand", path);
    const moved = `${dstUrl}/storage/v1/object/public/org-brand/${path}`;
    psql(TARGET_DB_URL, `update public.orgs set brand_logo_url = '${moved.replace(/'/g, "''")}' where id = '${id}'`);
  }
  console.log(`storage: ${files} file(s) in org-files, ${logos.length} logo(s) in org-brand.`);
}
