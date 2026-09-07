// Root vitest config for the whole pnpm monorepo. Extended here (rather than
// left package-local) so `apps/landing` — a Next.js app — can be tested with
// the same `pnpm test`: JSX needs an explicit transform (Next's tsconfig sets
// jsx: "preserve", so vitest must compile it itself), `server-only` imports
// need a no-op stub (see test/stubs/server-only.js), and `@/*` needs to
// resolve the way Next's own tsconfig maps it.
//
// This transform is why the root package.json carries `react`/`react-dom` as
// devDependencies even though the root has no app of its own. `apps/landing`
// DOES declare its own `react`/`react-dom` (real dependencies, not just
// these root devDependencies) -- but that alone isn't enough: this config
// runs from the repo root, and Vite/vitest resolve a bare specifier like
// `react-dom/server` relative to that root, not per test file's own
// directory. pnpm's isolated (non-hoisted) node_modules means the root's own
// node_modules has to carry a copy too, or that resolution fails for every
// JSX test under `apps/*/src`, regardless of what any individual app
// declares for itself. Keep this pair version-aligned with whatever react
// version the apps under test declare themselves (currently 19.2.8
// everywhere) -- if they drift apart, pnpm's isolated node_modules gives a
// test two distinct React copies, the classic hooks/context footgun.
//
// `@/` forced the move to `test.projects`: apps/internal and apps/landing BOTH
// map `@/` to their own `src/`, and a single global alias can't tell which app
// a test file belongs to. Each project below owns its `@/` mapping and a
// non-overlapping `include`, so every test file is matched by exactly one
// project. The shared bits (oxc JSX transform, the `@tacit/*` source aliases,
// the server-only stub) are factored into `base` and spread into each.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { atAliasFor, packageAliases } from "./test/aliases.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const serverOnlyStub = { find: "server-only", replacement: here("./test/stubs/server-only.js") };
const exclude = ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"];

// Everything a project needs except its `@/` mapping and its file glob.
const base = {
  oxc: { jsx: { runtime: "automatic" as const } },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...base,
        resolve: { alias: [...packageAliases, serverOnlyStub, atAliasFor("internal")] },
        test: {
          name: "internal",
          include: ["apps/internal/src/**/*.test.{ts,tsx}"],
          exclude,
        },
      },
      {
        ...base,
        resolve: { alias: [...packageAliases, serverOnlyStub, atAliasFor("landing")] },
        test: {
          name: "landing",
          include: ["apps/landing/src/**/*.test.{ts,tsx}"],
          exclude,
        },
      },
      {
        // Everything with no `@/` of its own: the other apps and all packages.
        ...base,
        resolve: { alias: [...packageAliases, serverOnlyStub] },
        test: {
          name: "rest",
          include: [
            "apps/mcp/src/**/*.test.{ts,tsx}",
            "apps/ingest-local/src/**/*.test.{ts,tsx}",
            "apps/ingest-cloud/src/**/*.test.{ts,tsx}",
            "packages/*/src/**/*.test.ts",
            "packages/db/supabase/functions/**/*.test.ts",
          ],
          exclude,
        },
      },
    ],
  },
});
