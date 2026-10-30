import type { TargetError } from "@/lib/client/home-target-rules";

/** What saveTargetAction answers: a code and never a message, which the dialog words. */
export type TargetState = { status: "idle" } | { status: "saved" } | { status: "error"; error: TargetError };

/**
 * What the dialog runs. An action that rejects (the connection dropped, the
 * session lapsed) would otherwise be rethrown by useActionState into the
 * render, and this app has no error boundary, so the whole page would go for a
 * dialog that can say what happened. Nobody knows whether it landed.
 */
export const answering =
  (save: (prev: TargetState, form: FormData) => Promise<TargetState>) =>
  async (prev: TargetState, form: FormData): Promise<TargetState> => {
    try {
      return await save(prev, form);
    } catch {
      return { status: "error", error: "failed" };
    }
  };

export const TARGET_ERRORS: Record<TargetError, string> = {
  invalid: "That target couldn't be saved. Reload the page and try again.",
  not_number: "Enter a number, like 2 or 1.5.",
  not_whole: "Enter a whole number.",
  too_big: "That's over the limit of 1,000,000 hours or applications.",
  too_small: "That's too small to keep. Enter at least 0.01, or 0.",
  forbidden: "Only an admin at your company can change targets.",
  rate_limited: "Your team has hit its limit of changes for this hour. Try again later.",
  failed: "That didn't save, and it may not have gone through. Reload the page to check.",
};
