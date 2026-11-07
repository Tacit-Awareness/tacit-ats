#!/usr/bin/env node
// One-time extraction of the client schema from tacit-internal's migrations
// into this repo's track (supabase/migrations/20261106000000_client_baseline.sql).
//
// The input is a database with every tacit-internal migration applied (its
// local stack after `supabase db reset` in packages/db). The output is that
// schema minus the staff-only tables and functions listed in staff-only.json:
// tables come out with pg_dump --exclude-table (their indexes, constraints,
// policies, triggers and grants go with them); functions are cut from the
// dump by pg_dump's own "-- Name: ...; Type: ..." section headers.
//
//   node scripts/client-track/extract-baseline.mjs <pg_dump container> <source sha>
//
// <pg_dump container> is the Docker container of that stack's Postgres
// (supabase_db_<project_id>), so pg_dump matches the server's version.
// Kept for provenance: after the baseline, the track moves forward with its
// own migrations and this script is never run again.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const [container, sourceSha] = process.argv.slice(2);
if (!container || !sourceSha) {
  console.error("usage: extract-baseline.mjs <db container> <tacit-internal sha>");
  process.exit(1);
}

const { tables, views, functions } = JSON.parse(readFileSync(join(here, "staff-only.json"), "utf8"));

const args = ["exec", container, "pg_dump", "-U", "postgres", "--schema-only", "--no-owner"];
args.push("--schema=public", "--schema=private");
for (const t of [...tables, ...views]) args.push(`--exclude-table=public.${t}`);
args.push("postgres");
const dump = execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// pg_dump separates every object with a header block:
//   --
//   -- Name: <name>; Type: <TYPE>; Schema: <schema>; Owner: -
//   --
const header = /^--\n-- (?:Name|Data for Name): (.+?); Type: ([A-Z ]+); Schema: ([^;]+);.*\n--\n/gm;
const sections = [];
let last = 0;
let preamble = "";
for (const m of dump.matchAll(header)) {
  if (sections.length === 0) preamble = dump.slice(0, m.index);
  else sections[sections.length - 1].body = dump.slice(last, m.index);
  sections.push({ name: m[1], type: m[2], schema: m[3], body: "" });
  last = m.index;
}
sections[sections.length - 1].body = dump.slice(last);

const dropFn = new Set(functions);
const fnName = (name) => name.replace(/^FUNCTION /, "").replace(/\(.*$/, "");
const dropped = [];
const kept = sections.filter((s) => {
  // The project already has the public schema.
  if (s.name === "public" && s.type === "SCHEMA") return false;
  if (s.name === "SCHEMA public" && s.type === "COMMENT") return false;
  // supabase_admin's default privileges are the platform's to set.
  if (s.type === "DEFAULT ACL" && s.body.includes("FOR ROLE supabase_admin")) return false;
  const isFn = s.type === "FUNCTION" || ((s.type === "COMMENT" || s.type === "ACL") && s.name.startsWith("FUNCTION "));
  if (isFn && s.schema === "public" && dropFn.has(fnName(s.name))) {
    dropped.push(`${s.type} ${s.name}`);
    return false;
  }
  return true;
});

// Indexes in the source's creation order. When one insert breaks two unique
// indexes, Postgres reports the one with the lowest oid, and code matches on
// that name (interviews_pkey before interviews_one_active_per_step, say).
// pg_dump sorts constraints and indexes by name, so put them back in the
// order of the source's index oids.
const indexOids = new Map(
  execFileSync("docker", [
    "exec", container, "psql", "-U", "postgres", "-At", "-F", "\t", "-c",
    "select c.relname, c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
      "where c.relkind = 'i' and n.nspname in ('public', 'private')",
  ], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => { const [name, oid] = l.split("\t"); return [name, Number(oid)]; }),
);
const isIndexish = (s) => s.type === "CONSTRAINT" || s.type === "INDEX" || (s.type === "COMMENT" && s.name.startsWith("CONSTRAINT "));
const indexKey = (s) => {
  const name = s.type === "INDEX" ? s.name : s.type === "CONSTRAINT" ? s.name.split(" ")[1] : s.name.split(" ")[1];
  // A CHECK constraint has no index: first. A comment sorts just after its constraint.
  return (indexOids.get(name) ?? 0) + (s.type === "COMMENT" ? 0.5 : 0);
};
const slots = kept.map((s, i) => (isIndexish(s) ? i : -1)).filter((i) => i >= 0);
const ordered = slots.map((i) => kept[i]).sort((a, b) => indexKey(a) - indexKey(b));
slots.forEach((slot, j) => { kept[slot] = ordered[j]; });
if (slots.length && slots[slots.length - 1] - slots[0] + 1 !== slots.length) {
  console.error("constraints and indexes are not one block in the dump: check the reorder");
  process.exit(1);
}

const missing = [...dropFn].filter((f) => !dropped.some((d) => d.startsWith(`FUNCTION ${f}(`)));
if (missing.length) {
  console.error(`staff-only functions not found in the dump: ${missing.join(", ")}`);
  process.exit(1);
}

// Drop pg_dump's session settings that the CLI's migration runner sets itself,
// and the restrict/unrestrict guards newer pg_dump versions print.
const cleanPreamble = preamble
  .split("\n")
  .filter((l) => !/^\\(un)?restrict /.test(l))
  .join("\n");
const body = kept.map((s) => s.body).join("").replace(/^\\(un)?restrict .*\n/gm, "");

// Exact privileges, from the source (see acl.sql), minus the dropped objects.
const aclSql = readFileSync(join(here, "acl.sql"), "utf8");
const acl = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
  input: aclSql,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const droppedRel = new Set([...tables, ...views].map((t) => `public.${t}`));
const aclLines = acl.split("\n").filter((line) => {
  const rel = line.match(/ ON (?:TABLE|SEQUENCE) ([a-z_.]+)/);
  if (rel && droppedRel.has(rel[1])) return false;
  const fn = line.match(/ ON FUNCTION public\.([a-z_0-9]+)\(/);
  if (fn && dropFn.has(fn[1])) return false;
  return line.trim() !== "" && line !== "SET";
});

const out = `-- The client ATS's schema at its split from tacit-internal (Tacit-Awareness/tacit-internal@${sourceSha}).
--
-- Generated by scripts/client-track/extract-baseline.mjs from that commit's
-- 163 migrations, minus the staff-only tables and functions in
-- scripts/client-track/staff-only.json. From here on this track is the source
-- of truth for the client project (tacit-ats); tacit-internal's packages/db no
-- longer changes it.
--
-- Roles are per cluster: tacit_internal is created first, idempotently, as in
-- tacit-internal's 20261012240000_tacit_internal_role.

do $$
begin
  create role tacit_internal nologin noinherit;
exception when duplicate_object then null;
end $$;
grant tacit_internal to authenticator;


${cleanPreamble}${body}
--
-- Privileges, exactly as on the source (scripts/client-track/acl.sql).
--

${aclLines.join("\n")}

--
-- Tacit's own org. tacit_org_id() names it and tenant_set_org_id defaults to
-- it, as in tacit-internal's 20261012200000_add_org_tenancy; its access roles
-- and rejection reasons come from the orgs insert triggers.
--

INSERT INTO public.orgs (id, name, slug, kind)
VALUES ('7ac17000-0000-4000-8000-000000000001', 'Tacit', 'tacit', 'agency');

-- pg_dump's session settings (search_path '', row_security off) end here.
RESET ALL;
`;

const target = join(root, "supabase/migrations/20261106000000_client_baseline.sql");
writeFileSync(target, out);
console.log(`wrote ${target}: ${kept.length} sections kept, ${dropped.length} function sections dropped`);
