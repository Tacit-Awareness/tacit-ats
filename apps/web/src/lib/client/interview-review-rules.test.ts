import { afterEach, describe, expect, test, vi } from "vitest";

import { isReviewed, parseReviewWrite, reviewCount, reviewSaver, reviewTarget, saveReview, type ReviewWrite } from "./interview-review-rules";

const ID = "d1e00000-0000-4000-8000-000000000001";

describe("what a write may say", () => {
  test("an interview's id and a yes or no", () => {
    expect(parseReviewWrite({ interviewId: ID, reviewed: true })).toEqual({ interviewId: ID, reviewed: true });
    expect(parseReviewWrite({ interviewId: ID, reviewed: false })).toEqual({ interviewId: ID, reviewed: false });
  });

  test("an id in capitals is the same id", () => {
    expect(parseReviewWrite({ interviewId: ID.toUpperCase(), reviewed: true })?.interviewId).toBe(ID);
  });

  test("anything else is nothing, and extra fields never get through", () => {
    for (const bad of [null, undefined, "x", 4, [], {}, { interviewId: ID }, { reviewed: true }, { interviewId: "1", reviewed: true }, { interviewId: ID, reviewed: "true" }, { interviewId: `${ID}\n`, reviewed: true }]) {
      expect(parseReviewWrite(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseReviewWrite({ interviewId: ID, reviewed: true, actorId: "someone" })).toEqual({ interviewId: ID, reviewed: true });
  });
});

describe("the bar's count", () => {
  test("says what is left, as the prototype", () => {
    expect(reviewCount(3, 5)).toBe("3 to review");
    expect(reviewCount(1, 1)).toBe("1 to review");
    expect(reviewCount(0, 5)).toBe("All reviewed");
    // Nothing has happened yet, so nothing is reviewed: no interviews, or only upcoming ones.
    expect(reviewCount(0, 0)).toBeNull();
  });
});

describe("whether one is reviewed", () => {
  test("what the page set wins over what it loaded, both ways", () => {
    expect(isReviewed("a", new Set(["a"]), new Map())).toBe(true);
    expect(isReviewed("a", new Set(), new Map())).toBe(false);
    expect(isReviewed("a", new Set(["a"]), new Map([["a", false]]))).toBe(false);
    expect(isReviewed("a", new Set(), new Map([["a", true]]))).toBe(true);
  });
});

describe("which interview E means", () => {
  const past = new Set(["held", "other"]);

  test("the one open, with no row focused", () => {
    expect(reviewTarget(null, "held", past)).toBe("held");
  });

  test("the row J just reached, before the reader follows", () => {
    expect(reviewTarget("other", "held", past)).toBe("other");
  });

  test("never an upcoming one, focused or open, and never the open one in its place", () => {
    expect(reviewTarget(null, "upcoming", past)).toBeNull();
    expect(reviewTarget("upcoming", "held", past)).toBeNull();
  });

  test("nothing open and nothing focused is nothing", () => {
    expect(reviewTarget(null, null, past)).toBeNull();
  });
});

describe("saving", () => {
  const write = (reviewed: boolean): ReviewWrite => ({ interviewId: ID, reviewed });
  const settle = () => {
    const open: ((ok: boolean) => void)[] = [];
    const send = vi.fn(() => new Promise<boolean>((resolve) => open.push(resolve)));
    return { send, open };
  };

  test("one at a time, in the order they were made", async () => {
    const { send, open } = settle();
    const failed = vi.fn();
    const save = reviewSaver(send, failed);
    void save(write(true));
    const last = save(write(false));

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenLastCalledWith(write(true));
    open[0]!(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith(write(false));
    open[1]!(true);
    await last;
    expect(failed).not.toHaveBeenCalled();
  });

  test("a no and a throw both count as failed, and what follows still goes", async () => {
    const other = { interviewId: "d1e00000-0000-4000-8000-000000000002", reviewed: true };
    const third = { interviewId: "d1e00000-0000-4000-8000-000000000003", reviewed: true };
    const failed = vi.fn();
    const send = vi.fn<(w: ReviewWrite) => Promise<boolean>>().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const save = reviewSaver(send, failed);
    void save(write(true));
    void save(other);
    await save(third);
    expect(send).toHaveBeenCalledTimes(3);
    expect(failed.mock.calls).toEqual([[write(true), null], [other, null]]);
  });

  test("two presses that both fail leave the check as it was loaded, not as the first press asked", async () => {
    const failed = vi.fn();
    const save = reviewSaver(async () => false, failed);
    void save(write(true));
    await save(write(false));
    expect(failed.mock.calls).toEqual([[write(false), null]]);
  });

  test("a failed write with another queued behind it for the same interview is the later write's to answer", async () => {
    const failed = vi.fn();
    const send = vi.fn<(w: ReviewWrite) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const save = reviewSaver(send, failed);
    void save(write(true));
    void save(write(false));
    await save(write(true));
    expect(failed).not.toHaveBeenCalled();
  });

  test("a failure goes back to the last state the server took, not the opposite of what failed", async () => {
    const failed = vi.fn();
    const send = vi.fn<(w: ReviewWrite) => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValue(false);
    const save = reviewSaver(send, failed);
    void save(write(true));
    void save(write(false));
    await save(write(true));
    expect(failed.mock.calls).toEqual([[write(true), true]]);
  });

  test("failed writes queued behind an answer on another interview still answer for their own", async () => {
    const other = { interviewId: "d1e00000-0000-4000-8000-000000000002", reviewed: true };
    const failed = vi.fn();
    const send = vi.fn<(w: ReviewWrite) => Promise<boolean>>().mockResolvedValue(false);
    const save = reviewSaver(send, failed);
    void save(write(true));
    await save(other);
    expect(failed.mock.calls).toEqual([[write(true), null], [other, null]]);
  });
});

describe("sending a write", () => {
  afterEach(() => vi.unstubAllGlobals());
  const write: ReviewWrite = { interviewId: ID, reviewed: true };

  test("a yes is a 2xx, a redirect to sign-in is an error, and it outlives the page", async () => {
    const fetch = vi.fn(async (..._: unknown[]) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await saveReview(write)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/client/interviews/review", expect.objectContaining({ method: "POST", body: JSON.stringify(write), redirect: "error", keepalive: true }));
    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await saveReview(write)).toBe(false);
  });

  test("a request that never answers gives up, so the writes queued behind it still go", async () => {
    vi.stubGlobal(
      "fetch",
      (_: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const failed = vi.fn();
    const save = reviewSaver((w) => saveReview(w, 5), failed);
    await save(write);
    expect(failed).toHaveBeenCalledWith(write, null);
  });
});
