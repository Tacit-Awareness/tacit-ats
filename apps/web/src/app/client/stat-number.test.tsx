import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { Figure, figureParts } from "./stat-number";

const text = (v: string | number) => renderToStaticMarkup(<Figure value={v} />).replace(/<[^>]+>/g, "");

describe("the app's number style", () => {
  test("a trailing .0 goes, so 0.0% sits like 37", () => {
    expect(figureParts("0.0%")).toEqual({ whole: "0", frac: null, unit: "%" });
    expect(text("0.0%")).toBe("0%");
    expect(text("640.0%")).toBe("640%");
  });

  test("a real decimal stays, and so does a unit", () => {
    expect(figureParts("7.6")).toEqual({ whole: "7", frac: "6", unit: null });
    expect(text("3.5h")).toBe("3.5h");
    expect(text("1,204")).toBe("1,204");
  });

  test("the unit is drawn smaller, apart from the digits", () => {
    expect(renderToStaticMarkup(<Figure value="32%" />)).toMatch(/32<small[^>]*>%<\/small>/);
  });

  test("words are drawn as they are", () => {
    expect(figureParts("None")).toBeNull();
    expect(text("None")).toBe("None");
    expect(text("—")).toBe("—");
  });
});
