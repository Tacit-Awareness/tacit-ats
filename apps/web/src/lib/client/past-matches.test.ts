import { describe, expect, test } from "vitest";
import { likePattern, nameFilter, pastMatchWords } from "./past-matches";

describe("a search as a pattern", () => {
  test("plain words sit between wildcards", () => {
    expect(likePattern("rust")).toBe("%rust%");
  });

  test("% and _ mean themselves, and so does a backslash", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });

  test("* is never PostgREST's wildcard", () => {
    expect(likePattern("c*t")).toBe("%c_t%");
  });
});

describe("the or() filter", () => {
  test("every column, the value quoted so a comma stays in the search", () => {
    expect(nameFilter("Doe, Jane")).toBe('display_name.ilike."%Doe, Jane%",current_title.ilike."%Doe, Jane%",current_company.ilike."%Doe, Jane%"');
  });

  test("a quote or a bracket can't end the value", () => {
    expect(nameFilter('a"b)').split(",")[0]).toBe('display_name.ilike."%a\\"b)%"');
  });

  test("the escape survives the quoting", () => {
    expect(nameFilter("a_b").split(",")[0]).toBe('display_name.ilike."%a\\\\_b%"');
  });
});

test("one candidate, or several", () => {
  expect(pastMatchWords(1, "rust")).toBe("1 past candidate in CRM also matches “rust”");
  expect(pastMatchWords(1200, "rust")).toBe("1,200 past candidates in CRM also match “rust”");
});
