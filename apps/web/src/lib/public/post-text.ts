// A job post's text. `job_posts.description` is one plain-text column, so the
// lines of design/tats's posting ("What you'll do", "You might be a fit if")
// are kept as text an applicant, a connector and an editor can all read: blocks
// split by a blank line, a block being a paragraph, or an optional heading line
// over `- ` lines. Pure, because the public page, the read-only post and the
// client-side editor all draw it. A description written any other way is still
// paragraphs: nothing here drops text it does not recognise.

export type PostBlock = { kind: "text"; text: string } | { kind: "list"; heading: string; lines: string[] };

const BULLET = /^[-•*]\s+(.+)$/;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function parsePostText(text: string | null | undefined): PostBlock[] {
  const blocks: PostBlock[] = [];
  for (const chunk of (text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const heading = BULLET.test(lines[0]) ? null : lines[0];
    const items = heading === null ? lines : lines.slice(1);
    if (items.length && items.every((l) => BULLET.test(l))) {
      blocks.push({ kind: "list", heading: heading ?? "", lines: items.map((l) => oneLine(l.match(BULLET)![1])) });
    } else {
      blocks.push({ kind: "text", text: lines.join("\n") });
    }
  }
  return blocks;
}

/** The column's text. A list with no lines goes, its heading with it, so an unfilled section is never published. */
export function serializePostText(blocks: PostBlock[]): string {
  return blocks
    .flatMap((b) => {
      if (b.kind === "text") {
        const text = b.text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        return text ? [text] : [];
      }
      const lines = b.lines.map(oneLine).filter(Boolean);
      if (!lines.length) return [];
      const heading = oneLine(b.heading);
      return [[...(heading ? [heading] : []), ...lines.map((l) => `- ${l}`)].join("\n")];
    })
    .join("\n\n");
}
