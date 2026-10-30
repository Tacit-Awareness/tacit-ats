import { describe, expect, test } from "vitest";

import { granolaHref, granolaReadable, granolaText, granolaTranscript, matchedLine } from "./interview-granola";

const NOW = Date.parse("2026-10-20T12:00:00Z");

describe("granolaReadable", () => {
  const item = (over = {}) => ({ mine: true, status: "done", startsAt: "2026-10-20T10:00:00Z", ...over });

  test("an interview the member ran, once it has started", () => {
    expect(granolaReadable(item(), NOW)).toBe(true);
    expect(granolaReadable(item({ status: "scheduled", startsAt: "2026-10-20T11:59:00Z" }), NOW)).toBe(true);
  });

  test("never someone else's, a cancelled one, or one still to come", () => {
    expect(granolaReadable(item({ mine: false }), NOW)).toBe(false);
    expect(granolaReadable(item({ status: "cancelled" }), NOW)).toBe(false);
    expect(granolaReadable(item({ status: "scheduled", startsAt: "2026-10-20T12:01:00Z" }), NOW)).toBe(false);
  });
});

test("granolaHref keeps a picked meeting across the transcript's link", () => {
  expect(granolaHref("iv-1")).toBe("/client/interviews?i=iv-1");
  expect(granolaHref("iv-1", { note: "abc-123", transcript: true })).toBe("/client/interviews?i=iv-1&note=abc-123&transcript=1");
  expect(granolaHref("iv 1&x=2")).toBe("/client/interviews?i=iv+1%26x%3D2");
});

describe("granolaText", () => {
  const meeting = `<meetings_data count="1">
<meeting id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" title="Pat / Ada" date="Oct 15, 2026 5:00 PM">
  <known_participants>
  Pat <pat@x.test>
  </known_participants>
  <summary>
  Strong on systems.
  </summary>
  <private_notes>
  Ask about on-call.
  </private_notes>
</meeting>
</meetings_data>`;

  test("reads Granola's sections in its order, under plain headings", () => {
    expect(granolaText(meeting)).toEqual({
      title: "Pat / Ada",
      date: "Oct 15, 2026 5:00 PM",
      sections: [
        { label: "Attendees", text: "Pat <pat@x.test>" },
        { label: "Summary", text: "Strong on systems." },
        { label: "Your notes", text: "Ask about on-call." },
      ],
    });
  });

  test("a section loses its tag's indent and keeps its own", () => {
    const { sections } = granolaText("<summary>\n    ### Systems\n    - Rate limiter\n      - On-call\n\n    Done\n  </summary>");
    expect(sections).toEqual([{ label: "Summary", text: "### Systems\n- Rate limiter\n  - On-call\n\nDone" }]);
  });

  test("text in no known shape stays whole, tags and all", () => {
    const raw = "Some notes.\n<b>Bold</b> and <script>alert(1)</script>\n<enhanced_notes>x</enhanced_notes>";
    expect(granolaText(raw)).toEqual({ title: null, date: null, sections: [{ label: null, text: raw }] });
  });

  test("a section cut short by core's clip runs to the end, cut mark included", () => {
    const { sections } = granolaText("<summary>A long read\\n[…cut at 40000 characters]");
    expect(sections).toEqual([{ label: "Summary", text: "A long read\\n[…cut at 40000 characters]" }]);
  });

  test("text around a section is kept, and an empty section is not", () => {
    expect(granolaText("before\n<summary>  </summary>\n<summary>kept</summary>\nafter").sections).toEqual([
      { label: null, text: "before" },
      { label: "Summary", text: "kept" },
      { label: null, text: "after" },
    ]);
  });

  test("a title with angle brackets, the common 'Pat <> Ada', is still the meeting's title", () => {
    const raw = `<meeting id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" title="Pat <> Ada" date="Oct 15, 2026">\n<summary>Strong.</summary>\n</meeting>`;
    expect(granolaText(raw)).toEqual({ title: "Pat <> Ada", date: "Oct 15, 2026", sections: [{ label: "Summary", text: "Strong." }] });
  });

  test("a stray quote in a title loses no notes, and text after the tag is not read as part of it", () => {
    const raw = `<meeting id="x" title="24" monitor" date="Oct 15">\n<summary>He said "great" > fine</summary>\n</meeting>`;
    expect(granolaText(raw).sections).toEqual([{ label: "Summary", text: 'He said "great" > fine' }]);
  });

  test("hostile text of the longest size stays quick", () => {
    const started = performance.now();
    for (const chunk of ['<meeting "', '<summary "<', '<meeting "x" ', "<summary>", '"<>"', "<meeting a=", "\n"]) granolaText(chunk.repeat(Math.floor(60_000 / chunk.length)));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("a section with nothing in it, self-closed, does not swallow the ones after it", () => {
    expect(granolaText("<private_notes/>\n<summary>Strong.</summary>").sections).toEqual([{ label: "Summary", text: "Strong." }]);
    expect(granolaText('<summary />\n<private_notes foo="1">Mine.</private_notes>').sections).toEqual([{ label: "Your notes", text: "Mine." }]);
  });

  test("nothing at all is nothing", () => {
    expect(granolaText(null)).toEqual({ title: null, date: null, sections: [] });
    expect(granolaText("   ").sections).toEqual([]);
  });
});

test("a transcript loses only Granola's wrapper", () => {
  expect(granolaTranscript('<transcript meeting="x">\nAda: Hello <b>there</b>\n</transcript>')).toBe("Ada: Hello <b>there</b>");
  expect(granolaTranscript(null)).toBe("");
});

test("a word in someone's notes that only looks like a wrapper stays", () => {
  expect(granolaText("<summary>Booked the <meeting room> for the <transcript review></summary>").sections).toEqual([
    { label: "Summary", text: "Booked the <meeting room> for the <transcript review>" },
  ]);
  expect(granolaTranscript("<transcript>\nAda: see my <meeting notes>\n</transcript>")).toBe("Ada: see my <meeting notes>");
});

test("matchedLine says how the meeting was found, and nothing for what it does not know", () => {
  expect(matchedLine("event")).toBe("Matched by the calendar event");
  expect(matchedLine("chosen")).toBe("The meeting you picked");
  expect(matchedLine("other")).toBeNull();
});
