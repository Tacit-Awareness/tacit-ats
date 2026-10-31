import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { clientTools } from "@tacit-ats/core";
import { addAreas, profileFromForm } from "@/lib/client/interviewer-profile";
import { TagInput } from "./tag-input";

const noop = () => {};

describe("addAreas", () => {
  test("adds a line, trimmed", () => {
    expect(addAreas(["Go"], "  Rust ")).toEqual({ areas: ["Go", "Rust"], refused: null });
  });

  test("a comma is part of the tag", () => {
    expect(addAreas([], "Go, Rust").areas).toEqual(["Go, Rust"]);
  });

  test("a pasted list adds each line, and a repeat only once, ignoring case", () => {
    expect(addAreas(["Go"], "go\r\nRust\n\nrust\nZig").areas).toEqual(["Go", "Rust", "Zig"]);
  });

  test("refuses past 20, adding nothing", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `Skill ${i}`);
    expect(addAreas(twenty, "One more")).toEqual({ areas: twenty, refused: expect.stringContaining("20") });
    expect(addAreas(twenty, "skill 3").refused).toBeNull();
  });

  test("refuses a tag past 60 characters, counting code points", () => {
    expect(addAreas([], "x".repeat(61)).refused).toContain("60");
    expect(addAreas([], "😀".repeat(60)).refused).toBeNull();
  });

  test("what it passes, core's cleanFocusAreas keeps", () => {
    const { areas } = addAreas(["Go"], "GO\nRust");
    expect(clientTools.cleanFocusAreas(areas)).toEqual(areas);
  });
});

describe("TagInput", () => {
  test("with a name it sends one tag a line, the shape profileFromForm reads", () => {
    const html = renderToStaticMarkup(<TagInput name="focusAreas" label="Knows" tags={["Go", "Rust"]} onChange={noop} />);
    const value = /name="focusAreas" value="([^"]*)"/.exec(html)?.[1]?.replaceAll("&#10;", "\n");
    expect(value).toBe("Go\nRust");
    const form = new FormData();
    form.set("focusAreas", value!);
    expect(profileFromForm(form).focusAreas).toEqual(["Go", "Rust"]);
  });

  test("with no name it sends nothing, and each tag can be removed", () => {
    const html = renderToStaticMarkup(<TagInput label="Skill for Ada" tags={["Go"]} onChange={noop} />);
    expect(html).not.toContain('type="hidden"');
    expect(html).toContain('aria-label="Remove Go"');
    expect(html).toContain('aria-label="Skill for Ada"');
  });
});
