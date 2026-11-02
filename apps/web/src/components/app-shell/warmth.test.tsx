import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { WarmthFilter } from "./warmth";

// The levels and the matrix are lib/warmth.ts; here, what the server sends.
describe("the warmth filter", () => {
  test("the server renders Off: no SVG filter at all, so the first paint is never tinted", () => {
    expect(renderToStaticMarkup(<WarmthFilter />)).toBe("");
  });
});
