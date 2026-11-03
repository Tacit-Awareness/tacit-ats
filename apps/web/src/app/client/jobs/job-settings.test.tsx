import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { JobFormState, JobSettings } from "@/lib/client/job-settings-rules";

// No DOM here: the hooks stand still, so a test can walk what the job form
// hands React. A select reads its defaultValue only when it mounts, so what
// keeps it on the page's status is its key: a new status is a new select.
const hooks = vi.hoisted(() => ({ state: {} as JobFormState }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: (run: unknown) => [hooks.state, run, false],
}));
vi.mock("./actions", () => ({ saveJobAction: vi.fn(), addOpeningsAction: vi.fn(), closeOpeningAction: vi.fn() }));

import { JobSettingsPanel } from "./job-settings";

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

function find(node: ReactNode, match: (el: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, match);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as El;
  if (match(el)) return el;
  return find(el.props.children, match);
}

/** The job form as React gets it: the panel's JobForm element, called. */
function jobForm(settings: JobSettings) {
  const panel = JobSettingsPanel({ settings });
  const form = find(panel, (el) => typeof el.type === "function" && el.type.name === "JobForm")!;
  const tree = (form.type as (p: unknown) => ReactNode)(form.props);
  const select = find(tree, (el) => el.type === "select" && el.props.name === "status")!;
  const was = find(tree, (el) => el.type === "input" && el.props.name === "was:status")!;
  return { key: select.key, shows: select.props.defaultValue, was: was.props.value };
}

const settings = (status: string): JobSettings => ({ jobId: "e6a00000-0000-4000-8000-0000000000a1", title: "Engineer", status, openings: null });

beforeEach(() => {
  hooks.state = {};
});

describe("the job form's status", () => {
  test("after the status moves on, the select is drawn again on it, so a title-only save sends no status", () => {
    // Opened on paused; this form's own save, another tab or tats moves it to open.
    const before = jobForm(settings("paused"));
    hooks.state = { notice: "saved" };
    const after = jobForm(settings("open"));
    expect(before).toMatchObject({ shows: "paused", was: "paused" });
    // A new key is a new select, mounted on open: it cannot keep showing paused while was:status says open.
    expect(after.key).not.toBe(before.key);
    expect(after).toMatchObject({ shows: "open", was: "open" });
  });

  test("the same status keeps the same select, so what a member picked is kept", () => {
    expect(jobForm(settings("open")).key).toBe(jobForm(settings("open")).key);
  });

  test("a refusal keeps the status picked, but not one refused for being stale", () => {
    hooks.state = { error: "forbidden", draft: { title: "Engineer", status: "closed" } };
    expect(jobForm(settings("open"))).toMatchObject({ shows: "closed", was: "open" });
    hooks.state = { error: "status_changed", draft: { title: "Engineer", status: "closed" } };
    expect(jobForm(settings("paused"))).toMatchObject({ shows: "paused", was: "paused" });
  });
});
