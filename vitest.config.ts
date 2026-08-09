import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./test/aliases.js";

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
