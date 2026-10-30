import { describe, expect, test } from "vitest";
import { parsePostText, serializePostText } from "./post-text";

describe("parsePostText", () => {
  test("a paragraph, then headed lists", () => {
    expect(parsePostText("Build things.\n\nWhat you'll do\n- Ship\n- Run\n\nYou might be a fit if\n- You care")).toEqual([
      { kind: "text", text: "Build things." },
      { kind: "list", heading: "What you'll do", lines: ["Ship", "Run"] },
      { kind: "list", heading: "You might be a fit if", lines: ["You care"] },
    ]);
  });

  test("a list needs no heading, and takes the usual bullets", () => {
    expect(parsePostText("- one\n* two\n• three")).toEqual([{ kind: "list", heading: "", lines: ["one", "two", "three"] }]);
  });

  test("a paragraph with a dash inside it stays a paragraph, its lines kept", () => {
    expect(parsePostText("Salary band\n$100k - $120k\n- and equity")).toEqual([{ kind: "text", text: "Salary band\n$100k - $120k\n- and equity" }]);
  });

  test("a heading alone, *emphasis* and a bare dash are not bullets", () => {
    expect(parsePostText("Heading only")).toEqual([{ kind: "text", text: "Heading only" }]);
    expect(parsePostText("*bold* start\n-no space")).toEqual([{ kind: "text", text: "*bold* start\n-no space" }]);
    expect(parsePostText("-\n- ")).toEqual([{ kind: "text", text: "-\n-" }]);
  });

  test("Windows line ends and blank lines holding spaces still split", () => {
    expect(parsePostText("One\r\n\r\nTwo\n  \nThree")).toEqual([
      { kind: "text", text: "One" }, { kind: "text", text: "Two" }, { kind: "text", text: "Three" },
    ]);
  });

  test("nothing is no blocks", () => {
    expect(parsePostText(null)).toEqual([]);
    expect(parsePostText(undefined)).toEqual([]);
    expect(parsePostText("  \n\n ")).toEqual([]);
  });
});

describe("serializePostText", () => {
  test("drops an unfilled section with its heading, and blank lines", () => {
    expect(
      serializePostText([
        { kind: "text", text: "  Intro  " },
        { kind: "list", heading: "What you'll do", lines: ["", "  "] },
        { kind: "list", heading: "Fit", lines: ["One", "", " two  words "] },
        { kind: "text", text: "" },
      ]),
    ).toBe("Intro\n\nFit\n- One\n- two words");
  });

  test("no heading writes the lines alone", () => {
    expect(serializePostText([{ kind: "list", heading: " ", lines: ["a"] }])).toBe("- a");
  });

  test.each([
    "Build things.\n\nWhat you'll do\n- Ship\n- Run\n\nFit\n- You care",
    "One paragraph\nwith two lines\n\nAnother",
    "- a\n- b",
    "Salary band\n$100k - $120k\n- and equity",
  ])("reading and writing changes nothing: %j", (text) => {
    expect(serializePostText(parsePostText(text))).toBe(text);
  });

  test("writing is stable after one pass over anything", () => {
    const once = serializePostText(parsePostText("a\r\n\r\n\r\n* b\n* c\n\n\n"));
    expect(once).toBe("a\n\n- b\n- c");
    expect(serializePostText(parsePostText(once))).toBe(once);
  });

  test("whatever is thrown at it, a save loses no word and a second save changes nothing", () => {
    const pieces = ["word", "two words", "- ", "* ", "• ", "-", "*", "\n", "\n\n", "\n \n", "\r\n", "  ", "\t", "🙂", "<b>x</b>", "$100 - $120", " "];
    // Seeded, so a failure is the same failure next time.
    let seed = 20261030;
    const pick = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let run = 0; run < 3000; run++) {
      const text = Array.from({ length: 1 + pick(24) }, () => pieces[pick(pieces.length)]).join("");
      const once = serializePostText(parsePostText(text));
      expect(serializePostText(parsePostText(once)), JSON.stringify(text)).toBe(once);
      // Only spacing and bullet marks may change.
      const words = (s: string) => s.split(/\s+/).filter((w) => w && !/^[-•*]$/.test(w)).join(" ");
      expect(words(once), JSON.stringify(text)).toBe(words(text));
    }
  });
});
