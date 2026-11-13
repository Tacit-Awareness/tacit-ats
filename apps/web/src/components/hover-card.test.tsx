import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/client" }));

import { CardBody } from "./hover-card";
import type { HoverCardData } from "@/lib/hover-card";

const card: HoverCardData = {
  kind: "candidate",
  name: "<img src=x onerror=alert(1)>",
  line: "<script>alert(2)</script>",
  state: { stage: "Screening", note: "touched 2d ago" },
  rows: [{ label: "Source", value: "Referral", faint: "<b>Sam</b>" }],
  link: { href: "/client/candidates/p1", label: "Open" },
};

describe("a hover card's words", () => {
  test("candidate text is text, never markup", () => {
    const html = renderToStaticMarkup(<CardBody card={card} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>Sam");
    expect(html).toContain("&lt;img src=x");
  });

  test("nobody draws an avatar, as in Testbench; a card with no rows draws no list", () => {
    expect(renderToStaticMarkup(<CardBody card={card} />)).not.toContain("av-tone");
    const member = renderToStaticMarkup(<CardBody card={{ kind: "member", name: "Ivy", line: null, state: null, rows: [], link: null }} />);
    expect(member).not.toContain("av-tone");
    expect(member).toContain("Ivy");
    expect(member).not.toContain("<dl");
    expect(member).not.toContain("<a ");
  });
});
