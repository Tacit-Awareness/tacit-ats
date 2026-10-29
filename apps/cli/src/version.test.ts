import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { PACKAGE, VERSION } from "./version.js";

it("says the version package.json publishes", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect([PACKAGE, VERSION]).toEqual([pkg.name, pkg.version]);
});
