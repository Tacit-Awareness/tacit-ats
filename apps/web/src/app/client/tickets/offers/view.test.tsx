import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock("../../candidates/[id]/actions", () => ({ askOfferApprovalAction: vi.fn(), moveOfferAction: vi.fn(), saveOfferAction: vi.fn() }));
vi.mock("../../inbox/actions", () => ({ decideIssueAction: vi.fn() }));

import type { OfferRow } from "@/lib/client/offer-list";
import { OfferView } from "./view";

const row = (id: string, status: string, over: Record<string, unknown> = {}, mine: string | null = null) =>
  ({
    offer: { offerId: id, applicationId: `a${id}`, status, salary: 185000, currency: "USD", bonus: null, equity: null, startDate: "2027-01-05", expiresOn: null, notes: null, createdBy: "Ada", createdAt: "2026-11-12T00:00:00Z", extendedAt: null, resolvedAt: null, approval: null, customFields: [], ...over },
    applicationId: `a${id}`,
    jobId: "j1",
    candidateId: `c${id}`,
    name: `Person ${id}`,
    jobTitle: "Engineer",
    stage: "offer",
    myRequestId: mine,
  }) as unknown as OfferRow;

const pending = { required: true, status: "pending", requestId: "r1", waitingStep: 1, steps: 1, requestedBy: "Ada", requestedAt: "x", decisions: [] };
const view = (rows: OfferRow[], sel: OfferRow | null) => renderToStaticMarkup(<OfferView org="Acme" team={null} rows={rows} sel={sel} departmentId={null} candidates={[]} flash={null} capped={false} />);

describe("the Offer page", () => {
  test("the queue groups what waits on your sign-off first, then drafts, extended and closed", () => {
    const rows = [row("1", "accepted"), row("2", "draft"), row("3", "extended"), row("4", "draft", { approval: pending }, "r1")];
    const html = view(rows, rows[3]!);
    const at = (s: string) => html.indexOf(s);
    expect(at("Needs Your Sign-Off")).toBeLessThan(at("Drafts"));
    expect(at("Drafts")).toBeLessThan(at("Extended"));
    expect(at("Extended")).toBeLessThan(at("Closed"));
    expect(html).toContain('href="/client/tickets/offers?o=2"');
  });

  test("an approver signs off or sends back through the Inbox's decision", () => {
    const r = row("4", "draft", { approval: pending }, "r1");
    const html = view([r], r);
    expect(html).toContain("Ada asked you to sign off");
    expect(html).toMatch(/name="decision" value="approve"/);
    expect(html).toMatch(/name="requestId" value="r1"/);
    expect(html).toContain("Send Back");
  });

  test("a draft with no flow is marked as extended; the terms show, an empty one as not set", () => {
    const r = row("2", "draft");
    const html = view([r], r);
    expect(html).toContain("Ready to go out to Person.");
    expect(html).toContain("Mark As Extended");
    expect(html).toContain("185,000 USD");
    expect(html).toContain("Not set");
    expect(html).not.toMatch(/name="decision"/);
  });

  test("an extended offer waits on their answer", () => {
    const r = row("3", "extended", { extendedAt: "x" });
    const html = view([r], r);
    expect(html).toContain("They Accepted");
    expect(html).toContain("They Declined");
  });

  test("no offers yet says so", () => {
    expect(view([], null)).toContain("No offers yet");
  });
});
