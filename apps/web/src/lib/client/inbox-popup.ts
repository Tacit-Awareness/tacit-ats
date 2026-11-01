// The pop-up's DOM half (components/pop-up.tsx is the React half), the Inbox's
// first and now the Pipeline's too. A native modal <dialog> would turn off every page key: useKeys and ignoreKey
// stand down while one is open, on purpose, and A, O, R, F, E, J and K have to
// work in here. So the pop-up is an aria-modal element, and these give it what
// showModal gives a <dialog>: nothing behind it can be reached. Unit-tested.

/** The fields read and written, so a test needs no DOM. */
export type PopupNode = {
  tagName: string;
  inert: boolean;
  parentElement: PopupNode | null;
  children: Iterable<PopupNode>;
  dataset?: { toasts?: string };
};

/**
 * Left alone: nothing to reach, Next's announcer has to go on reading route
 * changes, and a <dialog> is closed until it opens over everything, which inert
 * on the dialog itself would leave dead to the mouse (the `?` sheet is always
 * mounted). The toasts stay live too (`data-toasts`): an Undo has to work over a
 * pop-up, and a reader has to hear what lands there.
 */
const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NEXT-ROUTE-ANNOUNCER", "DIALOG"]);

/**
 * Everything outside `root` goes inert, sibling by sibling up to the body, and
 * the answer puts it back. What was already inert stays so. A confirmation
 * still works from inside an inert parent, because a modal <dialog> escapes its
 * ancestors' inertness, though not its own, so a <dialog> beside the way up is
 * skipped. What mounts afterwards (the command menu) isn't touched.
 */
export function inertOutside(root: PopupNode): () => void {
  const set: PopupNode[] = [];
  for (let node = root; node.parentElement && node.tagName !== "BODY"; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.inert || SKIP.has(sibling.tagName) || sibling.dataset?.toasts !== undefined) continue;
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
 * confirmation, and a navigation discards the action's answer. `data-off` is a
 * button that is off for good, such as a reject with no reasons set up.
 */
export const writeInFlight = (sheet: { querySelector(selector: string): unknown } | null): boolean => !!sheet?.querySelector('form button[type="submit"]:disabled:not([data-off])');

/** The row an issue key names. The key came through the URL, so it is quoted. */
export const rowSelector = (key: string) => `[data-issue-row="${key.replace(/["\\]/g, "\\$&")}"]`;
