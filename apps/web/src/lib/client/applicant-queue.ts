// Applicant Tickets' arrangement of the queue (design/tats's #triage): the
// job-board applicants core's listApplicationsInbox returns, grouped by job,
// and each application's answers split into contact and the rest. Pure: the
// page reads, this arranges. Every answer is candidate text, so nothing here
// turns one into markup; a link is only ever an http(s) URL.

/** One applicant in the queue, as the list and reader need it. */
export type QueueEntry = {
  applicationId: string;
  name: string | null;
  email: string | null;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  post: string | null;
  appliedAt: string;
  answers: { questionId: string; type: string; label: string; value: string }[];
};

export type QueueGroup = { jobId: string; jobTitle: string; entries: QueueEntry[] };

/** Newest first; jobs in the order of their newest applicant. */
export function groupByJob(entries: QueueEntry[]): QueueGroup[] {
  const sorted = [...entries].sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));
  const groups = new Map<string, QueueGroup>();
  for (const e of sorted) {
    const g = groups.get(e.jobId) ?? { jobId: e.jobId, jobTitle: e.jobTitle ?? "Untitled job", entries: [] };
    g.entries.push(e);
    groups.set(e.jobId, g);
  }
  return [...groups.values()];
}

/** The list in reading order, as the groups show it. */
export const inOrder = (groups: QueueGroup[]): QueueEntry[] => groups.flatMap((g) => g.entries);

/** The one asked for, if it is in the queue, else the first. */
export function selected(order: QueueEntry[], id: string | null | undefined): QueueEntry | null {
  return order.find((e) => e.applicationId === id) ?? order[0] ?? null;
}

/** Who to open once this one leaves the queue: the next below it, else the one above. */
export function neighbour(order: QueueEntry[], id: string): QueueEntry | null {
  const i = order.findIndex((e) => e.applicationId === id);
  if (i < 0) return null;
  return order[i + 1] ?? order[i - 1] ?? null;
}

/**
 * An answer as a link, or null. Only http(s) is ever a link: an applicant
 * typing `javascript:` gets plain text. A bare host and path
 * ("linkedin.com/in/ada") is read as https.
 */
export function safeHref(value: string): string | null {
  const v = value.trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v) ? `https://${v}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export type ReaderAnswer = { questionId: string; label: string; value: string; href: string | null };

/** Already in the reader's header: name, email and phone. */
const IN_HEADER = new Set(["name", "email", "phone"]);
const LINKS = new Set(["linkedin", "resume"]);

/** The phone, and every other answer but name and email, in the form's order; resume and LinkedIn as links when they are URLs. */
export function readerAnswers(answers: QueueEntry["answers"]): { phone: string | null; answers: ReaderAnswer[] } {
  const phone = answers.find((a) => a.type === "phone" && a.value.trim())?.value.trim() ?? null;
  return {
    phone,
    answers: answers
      .filter((a) => !IN_HEADER.has(a.type) && a.value.trim() !== "")
      .map((a) => ({ questionId: a.questionId, label: a.label, value: a.value, href: LINKS.has(a.type) ? safeHref(a.value) : null })),
  };
}
