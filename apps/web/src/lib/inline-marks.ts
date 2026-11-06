// Bold and italic in a line of plain text, as Typeform keeps them: the text
// stays text (a question's label is one plain-text column, read by the
// connector, the CLI and the form's checklist as it is) and the marks are
// Markdown's, `**bold**` and `*italic*`, `***both***`. Pure, so the public
// form, the editor and the applicant reader all draw it the same way, and
// nothing here ever produces markup: a span is text and two flags.
//
// A mark opens only before a character that is not a space and closes only
// after one, as Markdown's flanking rule, so "5 * 3 * 2" and a lone "*" stay
// as typed. An opener with no closer is text.

export type Mark = "bold" | "italic";
export type MarkSpan = {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Where the span's text starts in the raw string. */ from: number;
};

/** How many stars run from `at`, forwards or backwards. */
const stars = (s: string, at: number, step: 1 | -1) => {
  let n = 0;
  for (let k = at; k >= 0 && k < s.length && s[k] === "*"; k += step) n++;
  return n;
};

const space = (c: string | undefined) => c === undefined || /\s/.test(c);

/** The `**` closing a bold run opened before `from`, skipping single stars (an italic inside). */
function closeBold(s: string, from: number): number {
  if (space(s[from])) return -1;
  for (let j = from + 1; j < s.length - 1; j++) {
    if (s[j] === "*" && s[j + 1] === "*" && !space(s[j - 1])) {
      // `***`: the bold closes on the last two, leaving the first to an italic inside.
      if (s[j + 2] === "*") continue;
      return j;
    }
  }
  return -1;
}

/**
 * The `*` closing an italic run opened before `from`. A `**` inside opens or
 * closes a bold within it, and `***` after an open bold closes both.
 */
function closeItalic(s: string, from: number): number {
  if (space(s[from])) return -1;
  let boldOpen = false;
  for (let j = from + 1; j < s.length; j++) {
    if (s[j] !== "*") continue;
    const run = stars(s, j, 1);
    if (run === 1) {
      if (!boldOpen && !space(s[j - 1])) return j;
    } else if (run === 2) {
      if (boldOpen ? !space(s[j - 1]) : !space(s[j + 2])) boldOpen = !boldOpen;
      j += 1;
    } else if (!space(s[j - 1])) {
      return boldOpen ? j + 2 : j;
    } else {
      j += run - 1;
    }
  }
  return -1;
}

function walk(s: string, offset: number, bold: boolean, italic: boolean, out: MarkSpan[]) {
  let buf = "";
  let bufFrom = offset;
  const flush = () => {
    if (buf) out.push({ text: buf, bold, italic, from: bufFrom });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    if (!bold && s[i] === "*" && s[i + 1] === "*") {
      const close = closeBold(s, i + 2);
      if (close !== -1) {
        flush();
        walk(s.slice(i + 2, close), offset + i + 2, true, italic, out);
        i = close + 2;
        bufFrom = offset + i;
        continue;
      }
    }
    if (!italic && s[i] === "*" && (bold || s[i + 1] !== "*")) {
      const close = closeItalic(s, i + 1);
      if (close !== -1) {
        flush();
        walk(s.slice(i + 1, close), offset + i + 1, bold, true, out);
        i = close + 1;
        bufFrom = offset + i;
        continue;
      }
    }
    if (!buf) bufFrom = offset + i;
    buf += s[i];
    i++;
  }
  flush();
}

/** The text as spans of plain, bold, italic or both, in order. Joined, the spans' text is `stripMarks`. */
export function parseMarks(text: string): MarkSpan[] {
  const out: MarkSpan[] = [];
  walk(text, 0, false, false, out);
  return out;
}

/** The text without its marks: for a sentence, an aria-label, a checklist line. */
export function stripMarks(text: string): string {
  return parseMarks(text)
    .map((s) => s.text)
    .join("");
}

/** Whether any of the text is bold or italic. */
export function hasMarks(text: string): boolean {
  return parseMarks(text).some((s) => s.bold || s.italic);
}

type Char = { c: string; bold: boolean; italic: boolean; sel: boolean };

/**
 * The characters as runs of one style, each run's marks hugging its words:
 * spaces at a run's edges go outside it, since a mark cannot open or close
 * on one. Records where each character lands.
 */
function serialize(chars: Char[]): { text: string; at: number[] } {
  let text = "";
  const at: number[] = new Array(chars.length);
  const emit = (i: number) => {
    at[i] = text.length;
    text += chars[i].c;
  };
  // Runs of chars[i..j) where key(char) is the same.
  const runs = (from: number, to: number, key: (c: Char) => boolean, each: (i: number, j: number, on: boolean) => void) => {
    for (let i = from; i < to;) {
      let j = i + 1;
      while (j < to && key(chars[j]) === key(chars[i])) j++;
      each(i, j, key(chars[i]));
      i = j;
    }
  };
  const wrapped = (i: number, j: number, delim: string, inner: (i: number, j: number) => void) => {
    let a = i;
    let b = j;
    while (a < b && /\s/.test(chars[a].c)) emit(a++);
    const trail: number[] = [];
    while (b > a && /\s/.test(chars[b - 1].c)) trail.unshift(--b);
    if (a < b) {
      text += delim;
      inner(a, b);
      text += delim;
    }
    trail.forEach(emit);
  };
  const italics = (from: number, to: number) =>
    runs(
      from,
      to,
      (c) => c.italic,
      (i, j, on) =>
        on
          ? wrapped(i, j, "*", (a, b) => {
              for (let k = a; k < b; k++) emit(k);
            })
          : Array.from({ length: j - i }, (_, k) => emit(i + k)),
    );
  runs(
    0,
    chars.length,
    (c) => c.bold,
    (i, j, on) => (on ? wrapped(i, j, "**", italics) : italics(i, j)),
  );
  return { text, at };
}

/**
 * ⌘B or ⌘I on a selection, in the raw text's offsets: the selected words take
 * the mark, or lose it when every one of them already has it. The marks are
 * written again around the runs that result, so selecting a whole question
 * that is partly bold makes all of it bold, not a second pair of stars.
 * Returns the new text and where the selection now is. Nothing selected
 * changes nothing.
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): { text: string; start: number; end: number } {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(text.length, Math.max(start, end));
  const chars: Char[] = parseMarks(text).flatMap((span) =>
    Array.from(span.text, (c, k) => ({
      c,
      bold: span.bold,
      italic: span.italic,
      sel: span.from + k >= s && span.from + k < e,
    })),
  );
  const picked = chars.filter((c) => c.sel && !/\s/.test(c.c));
  if (!picked.length) return { text, start, end };
  const on = !picked.every((c) => c[mark]);
  for (const c of chars) if (c.sel) c[mark] = on;
  const out = serialize(chars);
  const first = chars.findIndex((c) => c.sel);
  const last = chars.length - 1 - [...chars].reverse().findIndex((c) => c.sel);
  return { text: out.text, start: out.at[first], end: out.at[last] + 1 };
}
