import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { CareersChart, chartRuns, type ChartPoint } from "./chart";

const point = (current: number | null, previous: number | null = null, i = 0): ChartPoint => ({ label: `Day ${i}`, current, previous });
const draw = (points: ChartPoint[], extra: { compare?: boolean; bars?: boolean } = {}) =>
  renderToStaticMarkup(<CareersChart points={points} top={4} share={false} compare={extra.compare ?? false} bars={extra.bars ?? false} step={1} />);

/** The chart's paths, and its dots, which are the only 8px rounds it draws. */
const paths = (html: string) => [...html.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);
const dots = (html: string) => html.match(/size-2 rounded-full/g)?.length ?? 0;

describe("chartRuns", () => {
  test("splits a series at each value that is not there", () => {
    expect(chartRuns([1, 2, null, 3, null, null, 4, 5])).toEqual([[0, 1], [3], [6, 7]]);
    expect(chartRuns([null, 0, 0])).toEqual([[1, 2]]);
    expect(chartRuns([0, 0])).toEqual([[0, 1]]);
    expect(chartRuns([null, null])).toEqual([]);
    expect(chartRuns([])).toEqual([]);
  });
});

describe("a day with nothing recorded", () => {
  // Views start partway through a period: before that nothing was counting, which is not zero.
  const points = [point(null), point(null), point(2), point(3), point(1)];

  test("draws no point and no line down to the axis", () => {
    const html = draw(points);
    expect(dots(html)).toBe(3);
    const [area, line] = paths(html);
    // Five points across 1000: the line starts on the third, at x = 500.
    expect(line.startsWith("M500,")).toBe(true);
    expect(area.startsWith("M500,")).toBe(true);
    expect(area).toContain("L1000,300L500,300Z");
    expect(line).not.toContain("M0,");
  });

  test("a 0 is a real 0, and still draws", () => {
    const html = draw([point(0), point(0), point(0)]);
    expect(dots(html)).toBe(3);
    expect(paths(html)[1].startsWith("M0,300")).toBe(true);
  });

  test("the period before stops the same way", () => {
    const html = draw([point(1, null), point(2, 1), point(3, 2)], { compare: true });
    const [, previous] = paths(html);
    expect(previous.startsWith("M500,")).toBe(true);
  });

  test("a value with a gap on each side keeps its dot", () => {
    expect(dots(draw([point(null), point(2), point(null)]))).toBe(1);
  });

  test("nothing at all draws nothing and does not break", () => {
    const html = draw([point(null), point(null)]);
    expect(dots(html)).toBe(0);
    expect(paths(html).every((d) => d === "")).toBe(true);
  });

  test("bars leave the day empty, as they did", () => {
    expect(draw(points, { bars: true })).toContain("height:0%");
  });
});
