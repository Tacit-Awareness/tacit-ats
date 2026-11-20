import { describe, expect, test } from "vitest";

import { APPEARANCES, LOOK_COOKIE, THEME_COOKIE, appearanceOf, appearanceParts, lookCookie, parseLook, parseTheme, themeChoice, themeCookie } from "./theme";

describe("the theme choice", () => {
  test("only light and dark are stored choices", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    for (const v of [undefined, null, "", "system", "Dark"]) expect(parseTheme(v), String(v)).toBeNull();
  });

  test("anything but a stored choice reads as System", () => {
    expect(themeChoice("dark")).toBe("dark");
    for (const v of [undefined, null, "", "sepia"]) expect(themeChoice(v), String(v)).toBe("system");
  });

  test("a choice is kept for a year on the whole site", () => {
    expect(themeCookie("dark")).toBe(`${THEME_COOKIE}=dark; path=/; max-age=31536000; samesite=lax`);
  });

  test("System stores nothing: it expires the same cookie, on the same path", () => {
    expect(themeCookie("system")).toBe(`${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`);
  });
});

describe("the look", () => {
  test("only soft and max are stored looks", () => {
    expect(parseLook("soft")).toBe("soft");
    expect(parseLook("max")).toBe("max");
    for (const v of [undefined, null, "", "classic", "Max"]) expect(parseLook(v), String(v)).toBeNull();
  });

  test("each pick is a theme and, for the two new ones, a look", () => {
    expect(appearanceParts("classic-dark")).toEqual({ theme: "dark", look: null });
    expect(appearanceParts("dark")).toEqual({ theme: "dark", look: "soft" });
    expect(appearanceParts("light")).toEqual({ theme: "light", look: null });
    expect(appearanceParts("max-light")).toEqual({ theme: "light", look: "max" });
    expect(appearanceParts("system")).toEqual({ theme: "system", look: null });
  });

  test("what is on the page reads back as the pick that put it there", () => {
    for (const a of APPEARANCES) {
      const { theme, look } = appearanceParts(a.key);
      expect(appearanceOf(theme === "system" ? undefined : theme, look), a.key).toBe(a.key);
    }
  });

  test("a look of the other theme counts as none, and no theme is System", () => {
    expect(appearanceOf("dark", "max")).toBe("classic-dark");
    expect(appearanceOf("light", "soft")).toBe("light");
    expect(appearanceOf(undefined, "soft")).toBe("system");
  });

  test("every pick has a name and a line saying what it is", () => {
    expect(APPEARANCES.map((a) => a.name)).toEqual(["Classic Dark", "Dark", "Light", "Max Light", "System"]);
    for (const a of APPEARANCES) expect(a.means.length, a.key).toBeGreaterThan(8);
  });

  test("a look is kept for a year; none expires the same cookie", () => {
    expect(lookCookie("soft")).toBe(`${LOOK_COOKIE}=soft; path=/; max-age=31536000; samesite=lax`);
    expect(lookCookie(null)).toBe(`${LOOK_COOKIE}=; path=/; max-age=0; samesite=lax`);
  });
});
