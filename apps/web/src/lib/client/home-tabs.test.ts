import { describe, expect, test } from "vitest";
import { homeSubBase, hrefAt, parseHomeSub } from "./home-tabs";

describe("Home's tabs", () => {
  test("only a tab Home has is a tab", () => {
    expect(parseHomeSub("tickets")).toBe("tickets");
    expect(parseHomeSub("referrals")).toBe("referrals");
    expect(parseHomeSub("")).toBeNull();
    expect(parseHomeSub("__proto__")).toBeNull();
  });

  test("a link keeps the tab it was drawn in", () => {
    expect(hrefAt("/client/applicants", new URLSearchParams({ a: "x" }))).toBe("/client/applicants?a=x");
    expect(hrefAt(homeSubBase("tickets"), new URLSearchParams({ a: "x" }))).toBe("/client?sub=tickets&a=x");
    expect(hrefAt(homeSubBase("tickets"), new URLSearchParams())).toBe("/client?sub=tickets");
  });
});
