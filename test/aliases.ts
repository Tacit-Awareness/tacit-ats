import { fileURLToPath } from "node:url";

// Tests import this repo's own package from source (src/index.ts), not dist/,
// so no build step is needed first. @tacit/db and @tacit/core are NOT aliased:
// they are the vendored builds from tacit-internal (vendor/, node_modules).
export const packageAliases = [
  {
    find: "@tacit-ats/core",
    replacement: fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
  },
  {
    find: "@tacit-ats/member-db",
    replacement: fileURLToPath(new URL("../packages/member-db/src/index.ts", import.meta.url)),
  },
];

// `@/` is each Next app's own tsconfig path alias, resolved per vitest project.
export function atAliasFor(appDir: string) {
  return {
    find: /^@\/(.*)$/,
    replacement: fileURLToPath(new URL(`../apps/${appDir}/src/`, import.meta.url)) + "$1",
  };
}
