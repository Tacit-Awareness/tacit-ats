// Root vitest config for the whole pnpm monorepo. Extended here (rather than
// left package-local) so `apps/landing` — a Next.js app — can be tested with
// the same `pnpm test`: JSX needs an explicit transform (Next's tsconfig sets
// jsx: "preserve", so vitest must compile it itself), `server-only` imports
// need a no-op stub (see test/stubs/server-only.js), and `@/*` needs to
// resolve the way Next's own tsconfig maps it.
//
// This transform is why the root package.json carries `react`/`react-dom` as
// devDependencies even though the root has no app of its own: pnpm doesn't
// hoist a sibling workspace app's dependencies, and `apps/landing` has no
// package.json yet, so nothing else lets `pnpm test` (run from here) resolve
// `react-dom/server` for JSX tests under `apps/*/src`. Keep that pair
// version-aligned with whatever react version the apps under test declare
// themselves (currently 19.2.8 everywhere) — if they drift apart, pnpm's
// isolated node_modules gives a test two distinct React copies, the classic
// hooks/context footgun. They can be deleted once every app with tests also
// declares react as a real dependency of its own.
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
      // Only apps/landing has tests today, so one root "@" alias is safe.
      // apps/internal has its own "@" meaning apps/internal/src but no tests
      // yet — the moment it gains a test, this must become test.projects so
      // each app's "@" resolves independently.
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
