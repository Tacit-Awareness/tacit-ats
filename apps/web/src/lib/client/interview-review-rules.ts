// The reviewed check on Interviews (design/tats's `ivReviewed`, its E key and
// "N to review"), the pure half: what a write may say, what the bar says, which
// interview E means, and saving in order. A check is the member's own mark that
// they went through an interview, never feedback and nothing about how it went.
// interview-reviews.ts reads and writes it; interviews/review.tsx is the page's half.

export type ReviewWrite = { interviewId: string; reviewed: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request's body, which is only data: an interview's id and what to set it to. */
export function parseReviewWrite(raw: unknown): ReviewWrite | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { interviewId, reviewed } = raw as Record<string, unknown>;
  if (typeof interviewId !== "string" || !UUID.test(interviewId) || typeof reviewed !== "boolean") return null;
  return { interviewId: interviewId.toLowerCase(), reviewed };
}

/** The bar's count, as the prototype. */
export const reviewCount = (toReview: number) => (toReview ? `${toReview} to review` : "All reviewed");

/** What this page has set since it loaded wins over what it loaded with: a read can land before the write it follows. */
export const isReviewed = (id: string, saved: ReadonlySet<string>, set: ReadonlyMap<string, boolean>) => set.get(id) ?? saved.has(id);

/**
 * Which interview E means: the row with focus, else the one open. J moves focus
 * at once and the reader follows when the page lands, so E right after J means
 * the row J reached. Only a past one: there is nothing to review in an upcoming one.
 */
export function reviewTarget(focused: string | null, selected: string | null, past: ReadonlySet<string>): string | null {
  const id = focused ?? selected;
  return id && past.has(id) ? id : null;
}

/**
 * Saves one at a time, in the order they were made, so E twice ends where the
 * screen does. A write that fails or throws goes to `failed`, and the rest still run.
 */
export function reviewSaver(send: (write: ReviewWrite) => Promise<boolean>, failed: (write: ReviewWrite) => void) {
  let tail: Promise<void> = Promise.resolve();
  return (write: ReviewWrite): Promise<void> => {
    tail = tail.then(async () => {
      const ok = await send(write).catch(() => false);
      if (!ok) failed(write);
    });
    return tail;
  };
}
