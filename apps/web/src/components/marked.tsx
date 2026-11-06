import { parseMarks } from "@/lib/inline-marks";

// A line of text with its bold and italic (lib/inline-marks.ts) drawn. React
// text only, never markup: a span is <strong>, <em> or plain. `data-from` is
// where the span starts in the raw text, so a click can find its place there.

export function Marked({ text, offsets = false }: { text: string; offsets?: boolean }) {
  return (
    <>
      {parseMarks(text).map((s, i) => {
        const at = offsets ? { "data-from": s.from } : {};
        if (s.bold && s.italic)
          return (
            <strong key={i} {...at} className="font-semibold">
              <em>{s.text}</em>
            </strong>
          );
        if (s.bold)
          return (
            <strong key={i} {...at} className="font-semibold">
              {s.text}
            </strong>
          );
        if (s.italic)
          return (
            <em key={i} {...at}>
              {s.text}
            </em>
          );
        return offsets ? (
          <span key={i} {...at}>
            {s.text}
          </span>
        ) : (
          s.text
        );
      })}
    </>
  );
}
