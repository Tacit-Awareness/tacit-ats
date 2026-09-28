import { fileURLToPath } from "node:url";

// Tests import workspace packages from source (src/index.ts), not dist/ --
// no build step needed before running tests.
export const packageAliases = [
  // Deep dist imports -- the off-barrel research machinery apps deep-import
  // (`@tacit/core/dist/enrichment/agent/exa.js`, `dist/connections/enrich-run.js`,
  // ...) -- resolve to their source file, the same no-build-step contract as
  // the barrel alias below. Must precede the bare `@tacit/core` entry.
  {
    find: /^@tacit\/core\/dist\/(.*)\.js$/,
    replacement: fileURLToPath(new URL("../packages/core/src/", import.meta.url)) + "$1.ts",
  },
  {
    find: "@tacit/db",
    replacement: fileURLToPath(new URL("../packages/db/src/index.ts", import.meta.url)),
  },
  {
    find: "@tacit/core",
    replacement: fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
  },
  {
    find: "@tacit/scheduling",
    replacement: fileURLToPath(new URL("../packages/scheduling/src/index.ts", import.meta.url)),
  },
  {
    find: "@tacit/engine",
    replacement: fileURLToPath(new URL("../packages/engine/src/index.ts", import.meta.url)),
  },
];

// `@/` is a Next tsconfig path alias, and BOTH apps/internal and apps/landing
// define it -- each pointing at its own `src/`. A single global vitest alias
// can't serve both (the specifier is identical, only the importing app
// differs), so the root config resolves `@/` PER-PROJECT via `test.projects`,
// handing each app the mapping below. (This is the "switch to test.projects"
// the previous single-alias comment anticipated once internal grew a test
// whose module-under-test imports `@/`.)
export function atAliasFor(appDir: string) {
  return {
    find: /^@\/(.*)$/,
    replacement: fileURLToPath(new URL(`../apps/${appDir}/src/`, import.meta.url)) + "$1",
  };
}

// Back-compat: the old flat array (packages + internal's `@/`). Unused by the
// root config now that resolution is per-project, kept only so any external
// importer of `workspaceAliases` doesn't break.
export const workspaceAliases = [...packageAliases, atAliasFor("internal")];
