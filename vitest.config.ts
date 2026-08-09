import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests import workspace packages from source (src/index.ts), not dist/ —
// no build step needed before running tests.
export const workspaceAliases = {
  "@tacit/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@tacit/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/db/supabase/functions/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
