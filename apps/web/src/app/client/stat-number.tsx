// The app's one number style, for a big figure in Home's widgets and Analytics'
// stats (StatStrip in components/page.tsx draws the same): Mona Sans (the "sans
// mono" Hy picked: Mona Sans, digits even) in its own proportional figures, at
// weight 400 with normal tracking so the figure reads calm and the digits keep
// their room. Not its tabular figures: in Mona Sans those are a monospaced set
// with a slashed zero and a footed one, so "100%" reads like a code font, and no
// feature turns them off ("zero" 0 and every stylistic set leave them; ss08 bars
// the zero instead). A big number stands alone, so it needs no column to line up
// in. Set explicitly, so a container that is tabular can't pass its figures down.
// A trailing ".0" goes ("0.0%" says no more than "0%"), and a short unit (%, h,
// d, m, w, K, pts) sits at half size in the muted ink right beside the digits,
// as Testbench's `.stat-value small`. Anything that is not a plain figure (None,
// a dash) is drawn as it is, in the same face. The figure brings its own face,
// so whatever holds it only sets its size and ink.

/** The face of every big number. Exported for the containers that hold more than a Figure. */
export const figureFace = "font-sans font-normal tracking-normal proportional-nums";

const FIGURE = /^([+-]?)(\d[\d,]*)(?:\.(\d+))?(\s?)([a-z%]{1,3})?$/i;

/** A figure's parts, or null for text that is not one. Exported for the tests. */
export function figureParts(value: string | number) {
  const m = FIGURE.exec(String(value).trim());
  if (!m) return null;
  const [, sign, whole, decimals, , unit] = m;
  const frac = decimals && /[1-9]/.test(decimals) ? decimals : null;
  return { whole: `${sign}${whole}`, frac, unit: unit ?? null };
}

export function Figure({ value }: { value: string | number }) {
  const p = figureParts(value);
  if (!p) return <span className={figureFace}>{value}</span>;
  return (
    <span className={figureFace}>
      {p.whole}
      {p.frac ? `.${p.frac}` : null}
      {p.unit ? <small className="ml-[0.06em] text-[0.5em] text-muted-foreground">{p.unit}</small> : null}
    </span>
  );
}
