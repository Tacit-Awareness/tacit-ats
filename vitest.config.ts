// Root vitest config. JSX needs an explicit transform (Next's tsconfig sets
// jsx: "preserve"), `server-only` imports need a no-op stub, and each Next app
// resolves its own `@/`, so every app is its own project with a
// non-overlapping `include`.
//
// The root package.json carries react/react-dom as devDependencies because
// vitest resolves a bare `react-dom/server` from the repo root; keep them
// version-aligned with the apps (19.2.8) or a test gets two Reacts.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { atAliasFor, packageAliases } from "./test/aliases.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const serverOnlyStub = { find: "server-only", replacement: here("./test/stubs/server-only.js") };
const exclude = ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"];

const base = {
  oxc: { jsx: { runtime: "automatic" as const } },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...base,
        resolve: { alias: [...packageAliases, serverOnlyStub, atAliasFor("web")] },
        test: { name: "web", include: ["apps/web/src/**/*.test.{ts,tsx}"], exclude },
      },
      {
        ...base,
        resolve: { alias: [...packageAliases, serverOnlyStub] },
        test: {
          name: "rest",
          include: ["apps/mcp/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.ts"],
          exclude,
        },
      },
    ],
  },
});
