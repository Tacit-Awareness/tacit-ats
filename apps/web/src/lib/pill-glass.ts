// design/tats's liquid glass hover, the pure half (components/app-shell/pill-glass.tsx
// is the React half): one grey glass pill per option group slides under the
// option you point at. Unit-tested in pill-glass.test.ts.

/** Every option group has this class (`pillTrack` in components/page.tsx). */
export const PILL_TRACK = ".pill-track";
export const GLASS_CLASS = "pill-glass";

/** The fields read, so a test needs no DOM. */
export type GlassItem = {
  disabled?: boolean;
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
};

/** A disabled option takes no hover. */
export const takesGlass = (item: GlassItem) => !item.disabled;

/** A touch has no hover to follow, and the pill would stay where the finger left it. */
export const followsPointer = (pointerType: string) => pointerType !== "touch";

/**
 * Where the pill sits, in the track's own box. `offset*` and not a rect: they
 * move with a track that has scrolled sideways, and under the UI scale they are
 * the same units as what is written to `style`.
 */
export const glassBox = (item: GlassItem) => ({
  width: `${item.offsetWidth}px`,
  height: `${item.offsetHeight}px`,
  transform: `translate(${item.offsetLeft}px, ${item.offsetTop}px)`,
});
