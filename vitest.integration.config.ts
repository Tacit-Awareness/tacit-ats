import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./test/aliases.js";

// Integration tests run against the local Supabase stack (`supabase start`
// in packages/db). They share one `people` table, so files run serially.
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ["apps/*/src/**/*.integration.test.ts", "packages/*/src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: "./test/integration-setup.ts",
    fileParallelism: false,
  },
});
