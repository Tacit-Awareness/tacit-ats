import { describe, expect, test } from "vitest";
import { parseMethod, safeNext, signInHref } from "./rules";

describe("safeNext", () => {
  test("keeps a page of the client area, with its query", () => {
    expect(safeNext("/client/inbox?i=app-1")).toBe("/client/inbox?i=app-1");
  });

  test.each([
    [undefined],
    [""],
    ["client"],
    ["https://evil.test/client"],
    ["//evil.test/client"],
    ["/\\evil.test/client"],
    ["/jobs/a"],
    ["/clientele"],
    ["/client/callback?code=x"],
    ["/client/../jobs"],
    [["/client"]],
  ])("%j goes Home", (raw) => {
    expect(safeNext(raw)).toBe("/client");
  });
});

describe("signInHref", () => {
  test("Home needs no next", () => {
    expect(signInHref("/client", "")).toBe("/sign-in");
  });

  test("anywhere else comes back to it", () => {
    expect(signInHref("/client/inbox", "?i=1")).toBe("/sign-in?next=%2Fclient%2Finbox%3Fi%3D1");
  });
});

test("a method is one of three", () => {
  expect(parseMethod("google")).toBe("google");
  expect(parseMethod("hosted")).toBe("hosted");
  expect(parseMethod("github")).toBeNull();
  expect(parseMethod(undefined)).toBeNull();
});
