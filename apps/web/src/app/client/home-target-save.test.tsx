import { beforeEach, describe, expect, test, vi } from "vitest";

// No DOM here: the hooks stand still, so a test can read what the dialog hands
// React and call its handlers as the browser would.
const hooks = vi.hoisted(() => ({
  run: null as null | ((prev: unknown, form: FormData) => Promise<unknown>),
  pending: false,
  el: { showModal: vi.fn(), close: vi.fn(), open: true },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: (run: typeof hooks.run) => {
    hooks.run = run;
    return [{ status: "idle" }, run, hooks.pending];
  },
  useRef: () => ({ current: hooks.el }),
  useEffect: () => {},
  useState: (v: unknown) => [v, () => {}],
}));

const { saveTargetAction } = vi.hoisted(() => ({ saveTargetAction: vi.fn() }));
vi.mock("./actions", () => ({ saveTargetAction }));

import { TargetDialog, type TargetChipProps } from "./home-target";
import { TARGET_ERRORS } from "./target-messages";

const props: TargetChipProps = {
  metric: "review",
  card: "Waiting for review",
  label: "Target",
  shown: null,
  off: false,
  offNote: "Over target",
  sub: "",
  kind: "time",
  field: { value: "", unit: "d" },
  canEdit: true,
};

const close = vi.fn();
const dialog = () => TargetDialog({ ...props, close }) as unknown as { props: { onClose: () => void } };

beforeEach(() => {
  vi.clearAllMocks();
  hooks.pending = false;
});

describe("a save that never answers", () => {
  // useActionState rethrows a rejected action into the render, and this app has no error boundary.
  test("a dropped connection stays in the dialog and says it may have landed", async () => {
    dialog();
    saveTargetAction.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await hooks.run!({ status: "idle" }, new FormData())).toEqual({ status: "error", error: "failed" });
    expect(TARGET_ERRORS.failed).toMatch(/may not have gone through/);
  });

  test("a session that lapsed mid-save is the same answer, not a thrown page", async () => {
    dialog();
    saveTargetAction.mockRejectedValue(new Error("unauthenticated: signed_out"));
    expect(await hooks.run!({ status: "idle" }, new FormData())).toEqual({ status: "error", error: "failed" });
  });

  test("the action's own answers pass straight through", async () => {
    dialog();
    saveTargetAction.mockResolvedValue({ status: "error", error: "forbidden" });
    expect(await hooks.run!({ status: "idle" }, new FormData())).toEqual({ status: "error", error: "forbidden" });
    saveTargetAction.mockResolvedValue({ status: "saved" });
    expect(await hooks.run!({ status: "idle" }, new FormData())).toEqual({ status: "saved" });
  });
});

describe("closing mid-save", () => {
  // The browser refuses a cancel only once: a second Esc closes the dialog anyway.
  test("it comes straight back, or a refusal would land in a closed dialog", () => {
    hooks.pending = true;
    dialog().props.onClose();
    expect(hooks.el.showModal).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  test("with nothing in flight it closes", () => {
    dialog().props.onClose();
    expect(close).toHaveBeenCalledOnce();
    expect(hooks.el.showModal).not.toHaveBeenCalled();
  });
});
