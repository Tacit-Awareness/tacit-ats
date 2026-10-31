// How far a menu has to slide to stay in the window, pure so a test needs no DOM.

const GAP = 8;

/**
 * Pixels to move a menu right (negative: left) so it clears both edges of the
 * window. Should it not fit between them, its left edge wins, where it starts reading.
 */
export function fitShift(left: number, right: number, viewWidth: number): number {
  const past = Math.min(0, viewWidth - GAP - right);
  return left + past < GAP ? GAP - left : past;
}
