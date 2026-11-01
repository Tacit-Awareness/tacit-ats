import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { requireClient, tagCandidate, untagCandidate, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  tagCandidate: vi.fn(),
  untagCandidate: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/client/candidates/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, tagCandidate, untagCandidate } };
});

import { clientTools } from "@tacit-ats/core";
import { parseLabel } from "@/lib/client/candidate-edit-rules";
import { setLabelAction } from "./actions";
import { CandidateLabels } from "./controls";

const CANDIDATE = "c1c00000-0000-4000-8000-000000000001";
const TAG = "c1e00000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const on = form({ candidateId: CANDIDATE, tagId: TAG, on: "1" });
const off = form({ candidateId: CANDIDATE, tagId: TAG, on: "0" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireClient.mockResolvedValue({ db: {}, actorId: "a1", accessLevel: "elevated", org: { id: "o1" } });
});

describe("a posted label", () => {
  test("reads back typed, and anything tampered with is nothing", () => {
    expect(parseLabel(on)).toEqual({ candidateId: CANDIDATE, tagId: TAG, on: true });
    expect(parseLabel(off)).toEqual({ candidateId: CANDIDATE, tagId: TAG, on: false });
    expect(parseLabel(form({ candidateId: "x", tagId: TAG, on: "1" }))).toBeNull();
    expect(parseLabel(form({ candidateId: CANDIDATE, tagId: "gold", on: "1" }))).toBeNull();
    expect(parseLabel(form({ candidateId: CANDIDATE, tagId: TAG, on: "toggle" }))).toBeNull();
  });
});

describe("setLabelAction", () => {
  test("puts one on through tagCandidate, as the dashboard", async () => {
    tagCandidate.mockResolvedValue({ outcome: "tagged", tagId: TAG, tag: "Gold" });
    expect(await setLabelAction(on)).toEqual({ ok: true, changed: true });
    expect(tagCandidate.mock.calls[0]![1]).toMatchObject({ source: "dashboard", actorId: "a1" });
    expect(tagCandidate.mock.calls[0]![2]).toEqual({ candidateId: CANDIDATE, tag: TAG });
    expect(untagCandidate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/client/pipeline");
  });

  test("takes one off through untagCandidate", async () => {
    untagCandidate.mockResolvedValue({ outcome: "untagged", tagId: TAG, tag: "Gold" });
    expect(await setLabelAction(off)).toEqual({ ok: true, changed: true });
    expect(tagCandidate).not.toHaveBeenCalled();
  });

  test("the same answer twice changes nothing, and re-reads: a teammate got there first", async () => {
    tagCandidate.mockResolvedValue({ outcome: "already_tagged", tagId: TAG, tag: "Gold" });
    expect(await setLabelAction(on)).toEqual({ ok: true, changed: false });
    expect(revalidatePath).toHaveBeenCalled();
  });

  test("each refusal is its own code", async () => {
    for (const [code, error] of [
      ["forbidden", "label_forbidden"],
      ["not_found", "label_gone"],
      ["invalid", "label_archived"],
      ["rate_limited", "rate_limited"],
    ] as const) {
      tagCandidate.mockRejectedValueOnce(new clientTools.ClientToolError(code, "A sentence."));
      expect(await setLabelAction(on)).toEqual({ ok: false, error });
    }
  });

  test("a tampered form and a failure write nothing and say nothing of why", async () => {
    expect(await setLabelAction(form({ candidateId: CANDIDATE, tagId: "x", on: "1" }))).toEqual({ ok: false, error: "label_gone" });
    expect(tagCandidate).not.toHaveBeenCalled();
    tagCandidate.mockRejectedValue(new Error("connection reset"));
    expect(await setLabelAction(on)).toEqual({ ok: false, error: "failed" });
  });

  test("a caller who isn't signed in stops at the first line", async () => {
    requireClient.mockRejectedValue(new Error("not signed in"));
    await expect(setLabelAction(on)).rejects.toThrow("not signed in");
    expect(tagCandidate).not.toHaveBeenCalled();
  });
});

describe("CandidateLabels", () => {
  test("read-only: the chips, as text, and no control", () => {
    const html = renderToStaticMarkup(<CandidateLabels candidateId={CANDIDATE} labels={["<b>Gold</b>"]} choices={null} />);
    expect(html).toContain("&lt;b&gt;Gold");
    expect(html).not.toContain("<button");
  });

  test("with labels to offer, the button; no labels in the company, none", () => {
    const html = renderToStaticMarkup(<CandidateLabels candidateId={CANDIDATE} labels={["Gold"]} choices={[{ tagId: TAG, name: "Gold" }]} />);
    expect(html).toContain('data-command="labels"');
    expect(renderToStaticMarkup(<CandidateLabels candidateId={CANDIDATE} labels={[]} choices={[]} />)).toBe("");
  });
});
