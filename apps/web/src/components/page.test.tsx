import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Avatar } from "./page";

describe("Avatar", () => {
  test("nobody gets a picture or initials: a name stands alone, as in Testbench", () => {
    expect(renderToStaticMarkup(<Avatar name="Nia Okafor" candidate />)).toBe("");
    expect(renderToStaticMarkup(<Avatar name="Nia Okafor" />)).toBe("");
  });
});
