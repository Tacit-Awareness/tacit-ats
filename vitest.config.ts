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
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { workspaceAliases } from "./test/aliases.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // tsconfig sets jsx: "preserve" for Next; vitest has to transform it itself.
  // Vite 8 transforms with Oxc, not esbuild — esbuild: { jsx: "automatic" }
  // was tried and still fails, so this must stay under `oxc`.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      ...workspaceAliases,
      "server-only": here("./test/stubs/server-only.js"),
      // One root "@" alias, pointing at apps/landing. apps/internal also has
      // tests (lib/*.test.ts) but they import relatively and their modules
      // under test don't use "@" — keep it that way, or switch to
      // test.projects so each app's "@" resolves independently.
      "@": here("./apps/landing/src"),
    },
  },
  test: {
    include: [
      "apps/*/src/**/*.test.{ts,tsx}",
      "packages/*/src/**/*.test.ts",
      "packages/db/supabase/functions/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
