import { afterEach, describe, expect, test, vi } from "vitest";

// No DOM here: the effect runs where it is declared, and its dependencies are
// kept, since they are what stops a tab click from counting again.
const effects = vi.hoisted(() => ({ deps: [] as unknown[][] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (run: () => void, deps: unknown[]) => {
    effects.deps.push(deps);
    run();
  },
}));

import { CountView } from "./count-view";

const sendBeacon = vi.fn();
vi.stubGlobal("navigator", { sendBeacon });

afterEach(() => {
  sendBeacon.mockClear();
  effects.deps = [];
});

describe("the view beacon's trigger", () => {
  test("a visit sends one beacon, for its post", () => {
    CountView({ slug: "abc", returning: false });
    expect(sendBeacon.mock.calls).toEqual([["/api/jobs/abc/view"]]);
  });

  test("the form's redirect back sends none", () => {
    CountView({ slug: "abc", returning: true });
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  test("leaving the redirect for a tab is no reason to count: only the post re-runs it", () => {
    CountView({ slug: "abc", returning: true });
    expect(effects.deps).toEqual([["abc"]]);
  });
});
