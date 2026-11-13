import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The candidate as a pop-up shows them: everything to read, nothing to change.
// The full page keeps its controls.

vi.mock("@/lib/client/session", () => ({ requireClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/client/pipeline", useSearchParams: () => new URLSearchParams() }));

import type { clientTools } from "@tacit-ats/core";
import type { Offer } from "@/lib/client/offer-rules";
import { CandidateBody, type CandidateViewProps } from "./view";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const CANDIDATE = "c1c00000-0000-4000-8000-000000000001";
const REJECTED = "c1d00000-0000-4000-8000-000000000001";
const AT_OFFER = "c1d00000-0000-4000-8000-000000000002";

const app = (over: Partial<clientTools.CandidateDetail["applications"][number]>): clientTools.CandidateDetail["applications"][number] => ({
  applicationId: REJECTED, jobId: "j1", jobTitle: "Product Engineer", stage: "rejected", source: "job_board", sourceDetail: null,
  nextAction: null, nextActionDue: null, lastTouchAt: "2026-11-01T10:00:00Z", rejectionReason: "Skills or experience", rejectionNote: null,
  offer: null, answers: null, ...over,
});

const candidate: clientTools.CandidateDetail = {
  candidateId: CANDIDATE, name: "Omar Siddiqui", headline: "Engineer at Figma", full: true, email: "omar@example.com", location: "Remote",
  linkedinUrl: "https://linkedin.com/in/omar", summary: "Built Figma's sync layer.", tags: ["Gold"],
  applications: [
    app({}),
    app({ applicationId: AT_OFFER, jobId: "j2", jobTitle: "Founding Engineer, Infra", stage: "offer", rejectionReason: null, nextAction: "Chase the offer call", nextActionDue: "2026-11-10" }),
  ],
  notes: [], files: [{ fileId: "f1", kind: "resume", filename: "omar.pdf", contentType: "application/pdf", sizeBytes: 1000, uploadedBy: "Ada", uploadedAt: "2026-11-01T00:00:00Z" }],
  emails: [], customFields: [], prospect: false, prospectSource: null, prospectSourceDetail: null, pools: [],
};

const activity: clientTools.ActivityEntry[] = [
  { at: "2026-10-30T10:00:00Z", kind: "application.stage_changed", actor: "Priya Raman", applicationId: REJECTED, jobTitle: "Product Engineer", fromStage: "interviewing", toStage: "rejected", source: null, people: [], text: "Skills or experience", startsAt: null, refId: null },
  { at: "2026-10-20T10:00:00Z", kind: "application.added", actor: null, applicationId: REJECTED, jobTitle: "Product Engineer", fromStage: null, toStage: "sourced", source: "job_board", people: [], text: null, startsAt: null, refId: null },
];

const offer: Offer = {
  offerId: "c1f00000-0000-4000-8000-000000000001", applicationId: AT_OFFER, status: "draft", salary: 185000, currency: "USD", bonus: null, equity: null, startDate: null, expiresOn: null,
  notes: null, createdBy: "Ada", createdAt: "2026-11-01T00:00:00Z", extendedAt: null, resolvedAt: null, approval: null, customFields: [],
};

const props: CandidateViewProps = {
  candidate,
  activity,
  owners: { [REJECTED]: "Priya Raman", [AT_OFFER]: "Ryan Huang" },
  past: [],
  editing: { apps: { [REJECTED]: { ownerActorId: null }, [AT_OFFER]: { ownerActorId: null } }, owners: [{ actorId: "a1", name: "Priya Raman" }], reasons: [] },
  labels: [{ tagId: "t1", name: "Gold" }],
  offers: { [AT_OFFER]: [offer] },
  upload: { accept: ".pdf", extensions: ["pdf"], maxBytes: 3 * 1024 * 1024 },
  notice: null,
  error: null,
  now: NOW,
};

describe("the pop-up's dashboard", () => {
  const html = renderToStaticMarkup(<CandidateBody {...props} dashboard />);

  test("has nothing to change: no form, field, menu or button", () => {
    for (const tag of ["<form", "<input", "<select", "<textarea", "<button"]) expect(html).not.toContain(tag);
    for (const word of ["Move to", "Reopen at", "Log a touch", "Add note", "Add file", "Draft an offer", "Edit labels"]) expect(html).not.toContain(word);
  });

  test("keeps what those controls showed, to read", () => {
    expect(html).toContain("Priya Raman");
    expect(html).toContain("Chase the offer call");
    expect(html).toContain("2d overdue");
    expect(html).toContain("Skills or experience");
    expect(html).toContain("Gold");
    expect(html).toContain("185,000 USD");
  });

  test("draws each job's way through the stages, a closed one up to where it closed", () => {
    expect(html).toContain('aria-label="Stages, in order"');
    expect(html).toContain("Closed");
    expect(html).toContain("Interviewing");
  });

  test("keeps the side card, with files to open", () => {
    expect(html).toContain('href="/client/files/f1"');
    // The email breaks before its @ when it must, so a <wbr> sits there.
    expect(html.replace(/<wbr\/>/g, "")).toContain("omar@example.com");
  });
});

describe("under a pop-up head that names them", () => {
  // One job: the card opens on it, and leaves its stage, owner and source to the side card.
  const one = { ...candidate, applications: [candidate.applications[1]!] };

  test("opens on the job, not their name again, and says each fact once", () => {
    const html = renderToStaticMarkup(<CandidateBody {...props} candidate={one} dashboard />);
    expect(html).toMatch(/<h2[^>]*><a[^>]*>Founding Engineer, Infra<\/a><\/h2>/);
    expect(html).not.toContain(">Omar Siddiqui<");
    expect(html.match(/Ryan Huang/g)).toHaveLength(1);
    expect(html.match(/Job board/g)).toHaveLength(1);
  });

  test("names their one job once: not again as the side card's role, a posting's title as its source, or in each activity line", () => {
    const job = { ...candidate.applications[1]!, sourceDetail: "Founding Engineer, Infra" };
    const story: clientTools.ActivityEntry[] = [
      { ...activity[1]!, kind: "interview.scheduled", applicationId: AT_OFFER, jobTitle: "Founding Engineer, Infra", toStage: null, text: "Technical", people: ["Dana Doe"] },
      { ...activity[1]!, applicationId: AT_OFFER, jobTitle: "Founding Engineer, Infra", text: "Founding Engineer, Infra" },
    ];
    const html = renderToStaticMarkup(<CandidateBody {...props} candidate={{ ...one, applications: [job] }} activity={story} dashboard />);
    expect(html.match(/>Founding Engineer, Infra</g)).toHaveLength(1);
    expect(html).not.toContain(">Role<");
    expect(html).toContain("Scheduled the Technical interview<");
    expect(html).toContain("Added them at Sourced<");
    // Who was invited reads under the entry in the entry's own voice, not in Mona Sans.
    expect(html).toContain("With Dana Doe");
    expect(html).not.toMatch(/font-sans[^>]*>With Dana Doe/);
  });

  test("the step they are at says since when, on a line that doesn't break", () => {
    const moved: clientTools.ActivityEntry = { ...activity[0]!, at: "2026-11-11T10:00:00Z", applicationId: AT_OFFER, jobTitle: "Founding Engineer, Infra", fromStage: "interviewing", toStage: "offer", text: null };
    const html = renderToStaticMarkup(<CandidateBody {...props} candidate={one} activity={[moved]} dashboard />);
    expect(html).toMatch(/<em class="[^"]*whitespace-nowrap[^"]*">Since (<!-- -->)?1d ago<\/em>/);
    expect(html).not.toContain(">Now<");
  });

  test("under a ticket that already states a job's next action, that Next line isn't said again", () => {
    const under = renderToStaticMarkup(<CandidateBody {...props} candidate={one} nextInCall={AT_OFFER} dashboard />);
    expect(under).not.toContain("Chase the offer call");
    expect(under).not.toContain("overdue");
    // Another job's ticket leaves this one's next action where it was.
    expect(renderToStaticMarkup(<CandidateBody {...props} candidate={one} nextInCall={REJECTED} dashboard />)).toContain("Chase the offer call");
  });

  test("folds a long activity after the latest few, with the rest to show", () => {
    const long = Array.from({ length: 9 }, (_, i) => ({ ...activity[1]!, at: `2026-10-${String(20 - i).padStart(2, "0")}T10:00:00Z` }));
    const html = renderToStaticMarkup(<CandidateBody {...props} candidate={one} activity={long} dashboard />);
    expect(html).toContain("<details");
    expect(html).toContain("Show all 9");
    // Every entry is there to read, the folded ones too (nobody did these, so they open with a capital).
    expect(html.match(/Added them/g)).toHaveLength(9);
  });
});

describe("the full page", () => {
  test("keeps its controls", () => {
    const html = renderToStaticMarkup(<CandidateBody {...props} />);
    expect(html).toContain("<form");
    expect(html).toContain("Add file");
    expect(html).toContain('data-command="labels"');
  });

  test("keeps the side card's role and each activity line's job", () => {
    const html = renderToStaticMarkup(<CandidateBody {...props} candidate={{ ...candidate, applications: [candidate.applications[1]!] }} />);
    expect(html).toContain(">Role<");
    expect(renderToStaticMarkup(<CandidateBody {...props} />)).toContain("to Rejected for Product Engineer");
  });
});
