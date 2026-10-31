import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Avatar } from "./page";

describe("Avatar", () => {
  test("an applicant has no picture, and the team keeps theirs", () => {
    expect(renderToStaticMarkup(<Avatar name="Nia Okafor" candidate />)).toBe("");
    expect(renderToStaticMarkup(<Avatar name="Nia Okafor" />)).toContain("NO");
  });
});
