import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("./actions", () => ({ bookingChoicesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { Panels } from "./booking";

// Back from the Confirm card must find the form as it was left. BookForm holds
// the booking's one id, so a form that unmounts for the card comes back empty
// with a new id, and a retry after a lost answer books a second interview.
describe("the Confirm card over a form", () => {
  const html = (card: boolean) => renderToStaticMarkup(<Panels card={card ? <p>Card</p> : null} form={<input name="filled-in" />} other={<p>Other</p>} />);

  test("the form stays mounted, hidden, behind the card", () => {
    const out = html(true);
    expect(out).toContain("Card");
    expect(out).toContain("filled-in");
    expect(out).toMatch(/class="[^"]*\bhidden\b[^"]*"><input/);
  });

  test("the card comes first, so the dialog's title is the card's", () => {
    const out = html(true);
    expect(out.indexOf("Card")).toBeLessThan(out.indexOf("filled-in"));
  });

  test("with no card the form shows, and another panel only when there is no card", () => {
    expect(html(false)).toMatch(/class="[^"]*\bflex\b[^"]*"><input/);
    expect(html(false)).toContain("Other");
    expect(html(true)).not.toContain("Other");
  });
});
