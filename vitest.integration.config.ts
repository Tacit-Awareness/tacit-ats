import { defineConfig } from "vitest/config";
import { atAliasFor, packageAliases } from "./test/aliases.js";

// Integration tests run against the local Supabase stack of this repo's own
// migration track (supabase/, test/integration-setup.ts). They share tables,
// so files run serially. `@/` is apps/web's: apps/mcp's integration tests
// import nothing through it.
export default defineConfig({
  resolve: {
    alias: [...packageAliases, atAliasFor("web")],
  },
  test: {
    include: ["apps/*/src/**/*.integration.test.ts", "packages/*/src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: "./test/integration-setup.ts",
    fileParallelism: false,
  },
});
