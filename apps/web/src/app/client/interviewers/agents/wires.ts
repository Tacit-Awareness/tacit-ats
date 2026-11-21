// The connectors' geometry, pure so the tests can hold it: soft elbows (a
// rounded corner where a line turns, as stageshow's Connector draws its
// `step` route) between a card's port and a lane's, and the hub's sideways
// version. Coordinates are the drawing's own pixels.

export type Pt = { x: number; y: number };

/**
 * Down (or up) out of `a` to the run at `busY`, across, then on into `b`.
 * Straight when the two ports line up; the corners never round past half the
 * run they sit on, so a short hop stays a clean step.
 */
export function wireV(a: Pt, b: Pt, busY: number, r = 10): string {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 0.5) return `M${a.x} ${a.y}V${b.y}`;
  const sx = Math.sign(dx);
  const s1 = Math.sign(busY - a.y) || 1;
  const s2 = Math.sign(b.y - busY) || 1;
  const k = Math.max(0, Math.min(r, Math.abs(dx) / 2, Math.abs(busY - a.y), Math.abs(b.y - busY)));
  return `M${a.x} ${a.y}V${busY - s1 * k}Q${a.x} ${busY} ${a.x + sx * k} ${busY}H${b.x - sx * k}Q${b.x} ${busY} ${b.x} ${busY + s2 * k}V${b.y}`;
}

/** The hub's: across out of `a` to the run at `busX`, up or down, then across into `b`. */
export function wireH(a: Pt, b: Pt, busX: number, r = 10): string {
  const dy = b.y - a.y;
  if (Math.abs(dy) < 0.5) return `M${a.x} ${a.y}H${b.x}`;
  const sy = Math.sign(dy);
  const s1 = Math.sign(busX - a.x) || 1;
  const s2 = Math.sign(b.x - busX) || 1;
  const k = Math.max(0, Math.min(r, Math.abs(dy) / 2, Math.abs(busX - a.x), Math.abs(b.x - busX)));
  return `M${a.x} ${a.y}H${busX - s1 * k}Q${busX} ${a.y} ${busX} ${a.y + sy * k}V${b.y - sy * k}Q${busX} ${b.y} ${busX + s2 * k} ${b.y}H${b.x}`;
}

/** Where `count` ports sit along an edge from `start` to `end`: one in the middle, more spread over its middle half. */
export function spread(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  const mid = (start + end) / 2;
  if (count === 1) return [mid];
  const span = Math.min((end - start) * 0.5, (count - 1) * 28);
  return Array.from({ length: count }, (_, i) => mid - span / 2 + (span * i) / (count - 1));
}

/** The levels the across-runs take between two edges, so no two lie on one another. */
export function levels(count: number, top: number, bottom: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const pad = Math.min(12, (bottom - top) / 4);
  return Array.from({ length: count }, (_, i) => top + pad + ((bottom - top - 2 * pad) * i) / (count - 1));
}

/** An arrowhead at `tip`, pointing along `dx, dy`. */
export function arrowHead(tip: Pt, dx: number, dy: number, size = 5): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return `M${tip.x - ux * size - uy * size * 0.75} ${tip.y - uy * size + ux * size * 0.75}L${tip.x} ${tip.y}L${tip.x - ux * size + uy * size * 0.75} ${tip.y - uy * size - ux * size * 0.75}`;
}
