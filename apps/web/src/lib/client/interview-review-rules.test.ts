import { describe, expect, test, vi } from "vitest";

import { isReviewed, parseReviewWrite, reviewCount, reviewSaver, reviewTarget, type ReviewWrite } from "./interview-review-rules";

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
    expect(reviewCount(3)).toBe("3 to review");
    expect(reviewCount(1)).toBe("1 to review");
    expect(reviewCount(0)).toBe("All reviewed");
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
    const failed = vi.fn();
    const send = vi.fn<(w: ReviewWrite) => Promise<boolean>>().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const save = reviewSaver(send, failed);
    void save(write(true));
    void save(write(false));
    await save(write(true));
    expect(send).toHaveBeenCalledTimes(3);
    expect(failed.mock.calls).toEqual([[write(true)], [write(false)]]);
  });
});
