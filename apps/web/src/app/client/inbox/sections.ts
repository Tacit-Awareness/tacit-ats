import type { DigestGroupKey } from "@/lib/client/inbox-digest";
import type { IssueKind, IssueReason } from "@/lib/client/inbox-issues";

// The Inbox grouped by the kind of work, in Hy's three: New applicants (anyone
// newly in, applied or referred), Interview judgement (reads and feedback) and
// Interview routing (moving a candidate on and keeping them moving and caught
// up). Every issue reason and digest group has its place here; a plain file, so
// the page, the view and their tests read the same map.

export const SECTIONS = [
  { key: "applicants", label: "New applicants" },
  { key: "judgement", label: "Interview judgement" },
  { key: "routing", label: "Interview routing" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * Where each issue goes. Feedback nobody has filed is judgement; the team's call
 * on who goes on, an approval (an offer, or a job to open), a follow-up past
 * due, an application nobody has touched, a candidate's reply and an unsent
 * invite are all routing: each is about moving someone on or keeping them
 * caught up.
 */
export const REASON_SECTION: Record<IssueReason, SectionKey> = {
  feedback: "judgement",
  decide: "routing",
  approval: "routing",
  overdue: "routing",
  quiet: "routing",
  reply: "routing",
  draft: "routing",
};

/** A row with no reason left to read (a test's, or a Done row's) goes by its kind. */
export const KIND_SECTION: Record<IssueKind, SectionKey> = { late: "routing", decide: "routing", reply: "routing", draft: "routing" };

/** What happened lately: a read filed is judgement; a stage move and a booking are routing. */
export const DIGEST_SECTION: Record<DigestGroupKey, SectionKey> = { fyi: "judgement", decided: "routing", booked: "routing" };

export const isSectionKey = (v: unknown): v is SectionKey => SECTIONS.some((s) => s.key === v);
