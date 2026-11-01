// Unsaved work in an editor, for the ways off a page that are no link: the G keys,
// ⌘K and the tour call router.push, which fires no click for an editor's own
// listener to catch. Module state, so the shell needn't know which page holds it.

const LEAVE = "Leave without saving? What you changed here will be lost.";
let held = 0;

/** While an editor has unsaved work. Returns the release. */
export function holdLeave(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

/** Whether to go on, asking first if something is unsaved. */
export const mayLeave = (ask: (text: string) => boolean = (text) => window.confirm(text)): boolean => held === 0 || ask(LEAVE);
