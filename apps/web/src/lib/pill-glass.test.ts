import { describe, expect, test } from "vitest";
import { followsPointer, glassBox, takesGlass } from "./pill-glass";

const item = { offsetLeft: 34, offsetTop: 3, offsetWidth: 80, offsetHeight: 30 };

describe("the glass pill", () => {
  test("covers the option it is under", () => {
    expect(glassBox(item)).toEqual({ width: "80px", height: "30px", transform: "translate(34px, 3px)" });
  });

  test("skips a disabled option", () => {
    expect(takesGlass(item)).toBe(true);
    expect(takesGlass({ ...item, disabled: true })).toBe(false);
  });

  test("follows a mouse or a pen, never a finger", () => {
    expect(followsPointer("mouse")).toBe(true);
    expect(followsPointer("pen")).toBe(true);
    expect(followsPointer("touch")).toBe(false);
  });
});
