import type { GlyphKind } from "@/components/page";
import type { ColumnKey } from "@/lib/client/pipeline-columns";

// Each Pipeline column's square (Testbench's StatusGlyph), filling as a person
// moves along, in the stage tints (--st-1 to --st-5, New to Your call); Offer
// is the full square in ink. The stage bar, the list's group bands and rows,
// and the board's column heads all draw a column with this, so they agree.

export type ColumnGlyph = { kind: GlyphKind; color: string };

const COLUMN_GLYPH: Record<ColumnKey, ColumnGlyph> = {
  new: { kind: "empty", color: "var(--st-1)" },
  screening: { kind: "quarter", color: "var(--st-2)" },
  scheduling: { kind: "half", color: "var(--st-3)" },
  booked: { kind: "most", color: "var(--st-4)" },
  decide: { kind: "most", color: "var(--st-5)" },
  offer: { kind: "full", color: "var(--ink)" },
};

/** A column's glyph by its key; a key the board doesn't know gets the empty square. */
export const columnGlyph = (key: string): ColumnGlyph => COLUMN_GLYPH[key as ColumnKey] ?? { kind: "empty", color: "var(--faint)" };
