import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { FeedbackForm as Form } from "@/lib/client/feedback-rules";

vi.mock("./actions", () => ({ fileFeedbackAction: vi.fn() }));

import { FeedbackForm } from "./feedback-form";

describe("your feedback", () => {
  const A1 = "e6a00000-0000-4000-8000-0000000000c1";
  const own = (filed: boolean): Form => ({
    interviewId: "e6a00000-0000-4000-8000-0000000000b1",
    attributes: [{ attributeId: A1, name: "System design", description: "Trade-offs" }],
    filed,
    draft: filed ? { recommendation: "no" as const, rating: 2, notes: "<b>kept</b>", ratings: { [A1]: 3 }, ratingNotes: { [A1]: "ok" } } : { recommendation: null, rating: null, notes: "", ratings: {}, ratingNotes: {} },
  });

  test("a first filing opens on the form, with the scorecard", () => {
    const html = renderToStaticMarkup(<FeedbackForm form={own(false)} candidate="Ada" />);
    expect(html).toContain("<details open=\"\"");
    expect(html).toContain("File your feedback");
    expect(html).toContain("Would you hire Ada?");
    expect(html).toContain(`name="r:${A1}"`);
    expect(html).toContain(`name="attr" value="${A1}"`);
  });

  test("a filed one folds away and opens on what was filed, as text", () => {
    const html = renderToStaticMarkup(<FeedbackForm form={own(true)} candidate="Ada" />);
    expect(html).not.toContain("<details open");
    expect(html).toContain("Edit your feedback");
    expect(html).toContain(`name="recommendation" checked="" value="no"`);
    expect(html).toContain(`name="r:${A1}" checked="" value="3"`);
    expect(html).toContain("&lt;b&gt;kept&lt;/b&gt;");
    expect(html).not.toContain("<b>kept</b>");
  });
});
