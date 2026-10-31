import { departmentOptions, type DepartmentsRead } from "./department-tree";

// Applicant Tickets' arrangement of the queue (design/tats's #triage): the
// job-board applicants core's listApplicationsInbox returns, grouped by team
// (the data model's teams are departments), and each application's answers
// split into contact and the rest. Pure: the page reads, this arranges. Every
// answer is candidate text, so nothing here turns one into markup; a link is
// only ever an http(s) URL.

/** One applicant in the queue, as the list and reader need it. */
export type QueueEntry = {
  applicationId: string;
  candidateId: string;
  name: string | null;
  email: string | null;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  post: string | null;
  appliedAt: string;
  answers: { questionId: string; type: string; label: string; value: string }[];
};

/** `isTeam` says whether `title` names a team, or a job when the org has no departments. */
export type QueueGroup = { key: string; title: string; isTeam: boolean; entries: QueueEntry[] };

const newestFirst = (entries: QueueEntry[]) => [...entries].sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));

/** Newest first; jobs in the order of their newest applicant. */
export function groupByJob(entries: QueueEntry[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  for (const e of newestFirst(entries)) {
    const g = groups.get(e.jobId) ?? { key: e.jobId, title: e.jobTitle ?? "Untitled job", isTeam: false, entries: [] };
    g.entries.push(e);
    groups.set(e.jobId, g);
  }
  return [...groups.values()];
}

/**
 * The queue by team, the way Job Postings bands jobs: each department under
 * its full path, in path order, a job counting in the department it was filed
 * under, even an archived one, and never rolled up into a parent. Jobs in none
 * (or in one the member cannot read) come last under "Other". An org with no
 * departments, or a member who reads none, keeps the list by job: one "Other"
 * holding everyone would say nothing.
 */
export function groupByTeam(entries: QueueEntry[], read: DepartmentsRead): QueueGroup[] {
  if (!read.departments.length) return groupByJob(entries);
  // Archived ones too: departmentOptions leaves those out, and only the filter wants that.
  const teams = departmentOptions(read.departments.map((d) => ({ ...d, archived: false })));
  const known = new Set(teams.map((t) => t.id));
  const departmentOf = new Map(read.jobs.map((j) => [j.jobId, j.departmentId]));
  const teamOf = (e: QueueEntry) => {
    const id = departmentOf.get(e.jobId);
    return id && known.has(id) ? id : null;
  };
  const sorted = newestFirst(entries);
  const groups: QueueGroup[] = teams.map((t) => ({ key: t.id, title: t.path, isTeam: true, entries: sorted.filter((e) => teamOf(e) === t.id) }));
  groups.push({ key: "other", title: "Other", isTeam: true, entries: sorted.filter((e) => teamOf(e) === null) });
  return groups.filter((g) => g.entries.length > 0);
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
