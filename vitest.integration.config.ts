import { defineConfig } from "vitest/config";
import { packageAliases } from "./test/aliases.js";

// Integration tests run against the local Supabase stack, started from the
// tacit-internal checkout (test/integration-setup.ts). They share tables, so
// files run serially.
export default defineConfig({
  resolve: {
    alias: packageAliases,
  },
  test: {
    include: ["apps/*/src/**/*.integration.test.ts", "packages/*/src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: "./test/integration-setup.ts",
    fileParallelism: false,
  },
});
