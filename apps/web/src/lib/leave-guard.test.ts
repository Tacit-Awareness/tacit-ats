import { expect, test, vi } from "vitest";
import { holdLeave, mayLeave } from "./leave-guard";

test("nothing held asks nothing", () => {
  const ask = vi.fn();
  expect(mayLeave(ask)).toBe(true);
  expect(ask).not.toHaveBeenCalled();
});

test("held, the answer decides, and a release ends it once", () => {
  const first = holdLeave();
  const second = holdLeave();
  expect(mayLeave(() => false)).toBe(false);
  expect(mayLeave(() => true)).toBe(true);
  first();
  first();
  expect(mayLeave(() => false)).toBe(false);
  second();
  expect(mayLeave(() => false)).toBe(true);
});
