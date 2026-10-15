#!/usr/bin/env node
// Refreshes vendor/tacit-db-<sha>.tgz and vendor/tacit-core-<sha>.tgz from a
// checkout of the Tacit-Awareness repo, which owns the schema (packages/db) and
// the shared domain logic (packages/core: the pipeline, the connector's email
// helpers, staff org onboarding). This repo never edits either; it pins a build
// of them.
//
//   node scripts/sync-tacit.mjs [path to Tacit-Awareness]   (default ../Tacit-Awareness)
//   pnpm install
//
// The checkout's HEAD is recorded in vendor/SOURCE, and its short sha names the
// tarballs. The name has to change with the contents: Vercel restores a cached
// node_modules, and pnpm keeps a stale package when only the tarball at the same
// path changed. So the script also deletes the previous tarballs and rewrites
// every file: specifier for them (root pnpm.overrides and each workspace
// member's package.json). Sync after any change on that side this repo depends
// on: a migration, a pipeline/core change, or regenerated database types.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendor = join(root, "vendor");
const src = resolve(process.argv[2] ?? join(root, "..", "Tacit-Awareness"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

const dirty = run("git", ["status", "--porcelain", "--", "packages/db", "packages/core"], src);
if (dirty) throw new Error(`${src} has uncommitted changes under packages/db or packages/core; commit or stash them first.`);
const sha = run("git", ["rev-parse", "HEAD"], src);
const short = sha.slice(0, 7);

execFileSync("pnpm", ["--filter", "@tacit/db", "--filter", "@tacit/core", "build"], { cwd: src, stdio: "inherit" });

const tarball = (name) => `tacit-${name}-${short}.tgz`;
const stale = new RegExp(`^tacit-(db|core)(-[0-9a-f]+)?\\.tgz$`);
for (const file of readdirSync(vendor)) if (stale.test(file)) rmSync(join(vendor, file));

for (const name of ["db", "core"]) {
  const pkgDir = join(src, "packages", name);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const stage = mkdtempSync(join(tmpdir(), `tacit-${name}-`));
  cpSync(join(pkgDir, "dist"), join(stage, "dist"), { recursive: true });
  // workspace:^ means nothing outside that repo; root package.json's
  // pnpm.overrides points @tacit/db at its tarball.
  const dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {}).map(([dep, range]) => [dep, String(range).startsWith("workspace:") ? pkg.version : range]),
  );
  writeFileSync(
    join(stage, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type, main: pkg.main, types: pkg.types, files: ["dist", "!dist/**/*.map"], dependencies }, null, 2) + "\n",
  );
  const file = run("npm", ["pack", "--silent", "--pack-destination", stage], stage).split("\n").pop();
  cpSync(resolve(stage, file), join(vendor, tarball(name)));
  rmSync(stage, { recursive: true, force: true });
}

// Point every specifier at the new names, editing the text so formatting stays.
const manifests = ["package.json", ...["apps", "packages"].flatMap((dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name, "package.json")),
)];
for (const rel of manifests) {
  const path = join(root, rel);
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  const next = text.replace(/(vendor\/)tacit-(db|core)(?:-[0-9a-f]+)?\.tgz/g, (_, dir, name) => dir + tarball(name));
  if (next !== text) writeFileSync(path, next);
}

writeFileSync(join(vendor, "SOURCE"), `Tacit-Awareness@${sha}\n`);
console.log(`vendor/ now holds ${tarball("db")} and ${tarball("core")} from Tacit-Awareness@${short}. Run pnpm install.`);
