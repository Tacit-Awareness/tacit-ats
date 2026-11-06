import { describe, expect, it } from "vitest";
import { hasMarks, parseMarks, stripMarks, toggleMark } from "./inline-marks";

const show = (text: string) =>
  parseMarks(text)
    .map((s) => (s.bold && s.italic ? `<bi>${s.text}</bi>` : s.bold ? `<b>${s.text}</b>` : s.italic ? `<i>${s.text}</i>` : s.text))
    .join("");

describe("parseMarks", () => {
  it("reads bold, italic and both", () => {
    expect(show("Why **this** role?")).toBe("Why <b>this</b> role?");
    expect(show("Why *this* role?")).toBe("Why <i>this</i> role?");
    expect(show("***Both*** here")).toBe("<bi>Both</bi> here");
    expect(show("**Bold** and *italic*")).toBe("<b>Bold</b> and <i>italic</i>");
  });

  it("nests one inside the other", () => {
    expect(show("**a *b* c**")).toBe("<b>a </b><bi>b</bi><b> c</b>");
    expect(show("*a **b** c*")).toBe("<i>a </i><bi>b</bi><i> c</i>");
  });

  it("leaves stars that open or close on a space, or never close, as typed", () => {
    for (const t of ["5 * 3 * 2", "Rating*", "* not this *", "**", "****", "a ** b ** c", "*", "Why **this role?"]) {
      expect(show(t)).toBe(t);
      expect(hasMarks(t)).toBe(false);
    }
  });

  it("keeps where each span starts in the raw text", () => {
    const spans = parseMarks("Why **this** role");
    expect(spans.map((s) => [s.text, s.from])).toEqual([
      ["Why ", 0],
      ["this", 6],
      [" role", 12],
    ]);
  });

  it("never makes markup of anything", () => {
    expect(stripMarks("**<b>hi</b>**")).toBe("<b>hi</b>");
    expect(parseMarks("<script>x</script>")).toEqual([{ text: "<script>x</script>", bold: false, italic: false, from: 0 }]);
  });
});

describe("stripMarks", () => {
  it("drops the marks and keeps the words", () => {
    expect(stripMarks("Why **this** *role*?")).toBe("Why this role?");
    expect(stripMarks("***x***")).toBe("x");
    expect(stripMarks("no marks")).toBe("no marks");
  });
});

describe("toggleMark", () => {
  it("wraps a selection", () => {
    expect(toggleMark("Why this role", 4, 8, "bold")).toEqual({ text: "Why **this** role", start: 6, end: 10 });
    expect(toggleMark("Why this role", 4, 8, "italic")).toEqual({ text: "Why *this* role", start: 5, end: 9 });
  });

  it("trims spaces off the selection first", () => {
    expect(toggleMark("Why this role", 3, 9, "bold").text).toBe("Why **this** role");
  });

  it("unwraps a selection inside the marks, or holding them", () => {
    expect(toggleMark("Why **this** role", 6, 10, "bold")).toEqual({ text: "Why this role", start: 4, end: 8 });
    expect(toggleMark("Why **this** role", 4, 12, "bold")).toEqual({ text: "Why this role", start: 4, end: 8 });
    expect(toggleMark("Why *this* role", 5, 9, "italic").text).toBe("Why this role");
  });

  it("tells bold and italic apart", () => {
    expect(toggleMark("**this**", 2, 6, "italic").text).toBe("***this***");
    expect(toggleMark("***this***", 3, 7, "italic").text).toBe("**this**");
    expect(toggleMark("***this***", 3, 7, "bold").text).toBe("*this*");
    expect(toggleMark("*this*", 1, 5, "bold").text).toBe("***this***");
  });

  it("round-trips", () => {
    const on = toggleMark("Tell us about a project", 15, 22, "bold");
    const off = toggleMark(on.text, on.start, on.end, "bold");
    expect(off.text).toBe("Tell us about a project");
    expect(stripMarks(on.text)).toBe("Tell us about a project");
  });

  it("makes a whole question that is partly bold all bold, then plain", () => {
    const all = toggleMark("**Why** this **role**", 0, 21, "bold");
    expect(all.text).toBe("**Why this role**");
    expect(toggleMark(all.text, 0, all.text.length, "bold").text).toBe("Why this role");
  });

  it("keeps a stray star as it was", () => {
    expect(toggleMark("5 * 3 is what", 9, 13, "italic").text).toBe("5 * 3 is *what*");
  });

  it("changes nothing with nothing selected", () => {
    expect(toggleMark("ab", 1, 1, "bold")).toEqual({ text: "ab", start: 1, end: 1 });
    expect(toggleMark("a  b", 1, 3, "bold").text).toBe("a  b");
  });
});
