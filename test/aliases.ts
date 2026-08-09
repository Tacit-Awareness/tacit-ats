import { fileURLToPath } from "node:url";

// Tests import workspace packages from source (src/index.ts), not dist/ --
// no build step needed before running tests.
export const workspaceAliases = {
  "@tacit/db": fileURLToPath(new URL("../packages/db/src/index.ts", import.meta.url)),
  "@tacit/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
};
