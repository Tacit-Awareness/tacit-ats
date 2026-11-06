import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Marked } from "@/components/marked";
import { Editable } from "./editable";

const noop = () => {};
const edit = (value: string, formatting: boolean) =>
  renderToStaticMarkup(<Editable value={value} onChange={noop} label="Question" placeholder="Type a question" path="q" formatting={formatting} />);

describe("Editable with formatting", () => {
  test("away from it, a marked question is drawn bold and italic, the text kept behind it", () => {
    const html = edit("Why **this** *role*?", true);
    expect(html).toContain('<strong data-from="6" class="font-semibold">this</strong>');
    expect(html).toContain('<em data-from="14">role</em>');
    // The editable text is still there, raw and hidden, for a click to come back to.
    expect(html).toMatch(/contentEditable="plaintext-only"[^>]*class="[^"]* hidden">Why \*\*this\*\* \*role\*\?</);
  });

  test("a question with no marks is only the editable text", () => {
    const html = edit("Why this role?", true);
    expect(html).not.toContain("<strong");
    expect(html).not.toContain("hidden");
  });

  test("without formatting, marks stay as typed", () => {
    const html = edit("Why **this** role?", false);
    expect(html).not.toContain("<strong");
    expect(html).toContain("Why **this** role?");
  });
});

describe("Marked", () => {
  test("draws text, never markup", () => {
    const html = renderToStaticMarkup(<Marked text={'**<img src=x onerror="alert(1)">** done'} />);
    expect(html).toBe('<strong class="font-semibold">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong> done');
  });
});
