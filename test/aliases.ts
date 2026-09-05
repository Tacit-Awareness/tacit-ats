import { fileURLToPath } from "node:url";

// Tests import workspace packages from source (src/index.ts), not dist/ --
// no build step needed before running tests.
//
// `@/` is apps/internal's own tsconfig path alias, and it belongs to that app
// alone: apps/mcp deliberately uses relative imports precisely because a global
// `@/` would collide with this one (see apps/mcp/CLAUDE.md). Declared here so a
// server action can be unit tested at all -- Next resolves the alias in its own
// build, vitest does not.
export const workspaceAliases = [
  {
    find: "@tacit/db",
    replacement: fileURLToPath(new URL("../packages/db/src/index.ts", import.meta.url)),
  },
  {
    find: "@tacit/core",
    replacement: fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
  },
  {
    find: /^@\/(.*)$/,
    replacement: fileURLToPath(new URL("../apps/internal/src/", import.meta.url)) + "$1",
  },
];
