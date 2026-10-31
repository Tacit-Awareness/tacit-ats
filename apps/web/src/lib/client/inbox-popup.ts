// The Inbox pop-up's DOM half (app/client/inbox/popup.tsx is the React half).
// A native modal <dialog> would turn off every page key: useKeys and ignoreKey
// stand down while one is open, on purpose, and A, O, R, F, E, J and K have to
// work in here. So the pop-up is an aria-modal element, and these give it what
// showModal gives a <dialog>: nothing behind it can be reached. Unit-tested.

/** The fields read and written, so a test needs no DOM. */
export type PopupNode = {
  tagName: string;
  inert: boolean;
  parentElement: PopupNode | null;
  children: Iterable<PopupNode>;
};

/** Left alone: nothing to reach, and Next's announcer has to go on reading route changes. */
const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NEXT-ROUTE-ANNOUNCER"]);

/**
 * Everything outside `root` goes inert, sibling by sibling up to the body, and
 * the answer puts it back. What was already inert stays so. A confirmation or
 * the `?` sheet still works from inside an inert parent, because a modal
 * <dialog> escapes its ancestors' inertness, and what mounts afterwards (the
 * command menu) isn't touched.
 */
export function inertOutside(root: PopupNode): () => void {
  const set: PopupNode[] = [];
  for (let node = root; node.parentElement && node.tagName !== "BODY"; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.inert || SKIP.has(sibling.tagName)) continue;
      sibling.inert = true;
      set.push(sibling);
    }
  }
  return () => {
    for (const el of set) el.inert = false;
  };
}

/**
 * A write under way in the pop-up: the fix and Dismiss turn their submit off
 * while posting. Closing then would hide it, as Esc mid-post would in a
 * confirmation, and a navigation discards the action's answer.
 */
export const writeInFlight = (sheet: { querySelector(selector: string): unknown } | null): boolean => !!sheet?.querySelector('form button[type="submit"]:disabled');

/** Where closing lands: the plain Inbox, carrying a notice and its Undo so a close doesn't lose them. */
export function closeHref(notice: string | null, undo: string | null): string {
  if (!notice) return "/client/inbox";
  const params = new URLSearchParams({ notice });
  if (undo) params.set("undo", undo);
  return `/client/inbox?${params}`;
}

/** The row an issue key names. The key came through the URL, so it is quoted. */
export const rowSelector = (key: string) => `[data-issue-row="${key.replace(/["\\]/g, "\\$&")}"]`;
