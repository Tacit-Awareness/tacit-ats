import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock("../applicants/actions", () => ({ routeApplicantAction: vi.fn(), draftReplyAction: vi.fn(), sendReplyAction: vi.fn() }));

import type { QueueEntry } from "@/lib/client/applicant-queue";
import type { Issue } from "@/lib/client/inbox-issues";
import { triageGroups } from "@/lib/client/triage-rules";
import type { Ticket } from "../applicants/view";
import { TriageView, type TriageProps } from "./view";

const entry = (id: string, name: string, source: string, hours: number) =>
  ({ applicationId: id, candidateId: `c${id}`, name, email: null, jobId: "j1", jobTitle: "Engineer", stage: "sourced", source, post: null, referredBy: null, linkedinUrl: null, appliedAt: new Date(Date.now() - hours * 3_600_000).toISOString(), answers: [] }) as unknown as QueueEntry;
const issue = (key: string, kind: Issue["kind"]) =>
  ({ key, kind, reason: kind === "late" ? "overdue" : "decide", at: new Date().toISOString(), what: kind === "late" ? "Next action overdue" : "The team's call", why: "Ended 2d ago", who: null, candidate: { id: "p", name: `Person ${key}` }, job: { id: "j1", title: "Engineer" }, applicationId: null, interviewId: null, nextAction: null, approval: null, draft: null, reply: null }) as Issue;

const ticket: Ticket = {
  applicationId: "a1",
  name: "Nora Lind",
  email: "nora@example.com",
  phone: null,
  jobTitle: "Engineer",
  jobHref: "/client/jobs/j1",
  applied: "3h ago",
  referral: false,
  added: false,
  source: "Job board · Careers",
  notes: [],
  files: [],
  team: "Platform",
  answers: [],
  routing: { applicationId: "a1", next: "a2", reasons: [{ reasonId: "r1", name: "Role filled" }] },
  reply: {
    applicationId: "a1",
    candidateId: "ca1",
    to: "nora@example.com",
    enabled: true,
    draft: null,
    sender: null,
    failed: null,
    sent: null,
    starters: { subject: "Your application", bodies: { interview: "Hi Nora, let's talk.", testbench: "Hi Nora, {{testbench_link}}", decline: "Hi Nora, no.", blank: "" } },
    subjectMax: 200,
    bodyMax: 10_000,
    testbench: false,
  },
};

const queue = [entry("a1", "Nora Lind", "job_board", 3), entry("a2", "Ref Erred", "referral", 1), entry("a3", "Sam Sourced", "sourced", 9)];
const props = (over: Partial<TriageProps> = {}): TriageProps => ({
  team: null,
  needs: [issue("i1", "decide"), issue("i2", "late")],
  groups: triageGroups(queue),
  need: null,
  applicant: queue[0]!,
  issue: null,
  ticket,
  flash: null,
  laterHref: "/client/triage?a=a2",
  hrefOf: (p) => `/client/triage?${new URLSearchParams(p)}`,
  queueFailed: false,
  nowMs: Date.now(),
  ...over,
});

describe("Triage", () => {
  test("the queue is Needs You first, then Referred, Applied and Sourced, each a link that opens it in place", () => {
    const html = renderToStaticMarkup(<TriageView {...props()} />);
    const at = (s: string) => html.indexOf(s);
    expect(at("Needs You")).toBeLessThan(at("Referred"));
    expect(at("Referred")).toBeLessThan(at("Applied"));
    expect(at("Applied")).toBeLessThan(at("Sourced"));
    expect(html).toContain('href="/client/triage?i=i1"');
    expect(html).toContain('href="/client/triage?a=a2"');
    // A late item is marked red, the rest amber, each with its meaning.
    expect(html).toContain('aria-label="Next action overdue"');
  });

  test("the open applicant gets the composer: the job's team, a draft to review, and a route that posts the picked move", () => {
    const html = renderToStaticMarkup(<TriageView {...props()} />);
    expect(html).toContain("Platform");
    expect(html).toContain("Review Draft");
    expect(html).toMatch(/name="route" value="interview"/);
    expect(html).toMatch(/name="next" value="a2"/);
    // No Testbench pick where the reply can't carry the candidate's link.
    expect(html).not.toContain(">Testbench<");
    expect(html).toContain("Later");
  });

  test("no reply where the member may not email them, and the route alone remains", () => {
    const html = renderToStaticMarkup(<TriageView {...props({ ticket: { ...ticket, reply: null } })} />);
    expect(html).toContain("You can&#x27;t email this candidate from here.");
    expect(html).not.toContain("Review Draft");
    expect(html).toMatch(/name="route" value="interview"/);
  });

  test("a stored draft is shown as it will go, with Send", () => {
    const html = renderToStaticMarkup(<TriageView {...props({ ticket: { ...ticket, reply: { ...ticket.reply!, draft: { draftId: "d1", to: "nora@example.com", subject: "Hello", body: "Body" } } } })} />);
    expect(html).toContain("Draft not sent");
    expect(html).toMatch(/name="draftId" value="d1"/);
    expect(html).toContain(">Send<");
  });

  test("its words have no dot separators and no em dashes", () => {
    const html = renderToStaticMarkup(<TriageView {...props()} />);
    expect(html).toContain("Job board, Careers");
    expect(html).not.toMatch(/ · |—/);
  });

  test("nothing waiting says so, with a way to Tickets", () => {
    const html = renderToStaticMarkup(<TriageView {...props({ needs: [], groups: [], applicant: null, ticket: null })} />);
    expect(html).toContain("Nothing waiting on you");
    expect(html).toContain("Nothing in triage");
    expect(html).toContain('href="/client/pipeline"');
  });
});
