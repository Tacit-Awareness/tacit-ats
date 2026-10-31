import { describe, expect, test } from "vitest";

import { THEME_COOKIE, parseTheme, themeChoice, themeCookie } from "./theme";

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
