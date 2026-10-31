import { isInstant } from "./inbox-done";

// The Inbox's digest (design/tats's `ibDigest`), the pure half: what happened
// lately, under Needs you. Decisions made is a stage change, Booked an interview
// made, FYI feedback filed. Nothing here is stored: lib/client/inbox-feed.ts
// reads it on the member's own token, so a row exists only where they may read
// it, and a read mark is their own inbox_dismissals row.
//
// A read mark's key is `evt-<uuid>` or `iv-<uuid>` and its reason one of
// DIGEST_REASONS, never an IssueReason ("feedback" is one, which is why FYI's is
// `filed`), so a mark can't hide an issue or land on Done. An event's detail (a
// rejection's reason) and everything an interviewer wrote stay out: a verdict is
// the one word `recommendation`, on feedback the member's own read returned.
// All of this is plain text, never markup.

export const DIGEST_RANGES = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
] as const;

export type DigestRange = (typeof DIGEST_RANGES)[number]["days"];
export const DEFAULT_RANGE: DigestRange = 1;

/** Rows a group shows; the prototype's six. Mark all as read covers the rest too. */
const GROUP_MAX = 6;
const DAY = 86_400_000;

export const parseRange = (v: unknown): DigestRange => DIGEST_RANGES.find((r) => String(r.days) === v)?.days ?? DEFAULT_RANGE;
export const rangeLabel = (range: DigestRange) => DIGEST_RANGES.find((r) => r.days === range)!.label;
export const rangeStart = (range: DigestRange, now: number) => new Date(now - range * DAY).toISOString();

/** The Inbox at a range, `?i=` for an issue and `?open=` for a digest row: a pop-up closes back to the same range. */
export function inboxHref(range: DigestRange, i?: string | null, open?: string | null): string {
  const qs = new URLSearchParams();
  if (range !== DEFAULT_RANGE) qs.set("range", String(range));
  if (i) qs.set("i", i);
  if (open) qs.set("open", open);
  const query = qs.toString();
  return query ? `/client/inbox?${query}` : "/client/inbox";
}

export const DIGEST_REASONS = ["decided", "booked", "filed"] as const;
export type DigestReason = (typeof DIGEST_REASONS)[number];

/** What a read mark names. `at` is what the database gave back, untouched: microseconds included. */
export type ReadMark = { key: string; reason: DigestReason; at: string };

export const DIGEST_KEY = /^(evt|iv)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** As instants, not strings: a timestamp comes back from Postgres in its own format. */
export const markId = (m: ReadMark) => `${m.key}|${m.reason}|${Date.parse(m.at)}`;

const isDigestReason = (v: unknown): v is DigestReason => DIGEST_REASONS.includes(v as DigestReason);

/** The mark a form names, re-read: posted fields are request data. Null for anything else. */
export function parseMark(form: FormData): ReadMark | null {
  const key = form.get("markKey");
  const reason = form.get("markReason");
  const at = form.get("markAt");
  if (typeof key !== "string" || !DIGEST_KEY.test(key) || !isDigestReason(reason) || !isInstant(at)) return null;
  return { key, reason, at };
}

/** What a row is about, as the member's own read found it. */
export type DigestSubject = {
  applicationId: string;
  personId: string;
  personName: string | null;
  jobTitle: string | null;
};

export type StageEvent = DigestSubject & { id: string; actorName: string | null; toStage: string | null; at: string };
export type Booking = DigestSubject & { id: string; interviewerNames: string[]; startsAt: string; at: string };
/** Filed feedback the member's read returned: who and whether, and only the one-word verdict. */
export type FiledFeedback = DigestSubject & { id: string; interviewId: string; interviewerName: string | null; recommendation: string | null; at: string };

export type DigestInput = { events: StageEvent[]; bookings: Booking[]; feedback: FiledFeedback[] };

export type DigestRow = {
  /** Unique on the page: two interviewers' feedback on one interview share a mark's key. */
  id: string;
  mark: ReadMark;
  what: string;
  /** Who it comes from, for the avatar. */
  who: string | null;
  meta: string;
  at: string;
  /** A booking's interview, which the browser words in its own zone. */
  interviewAt: string | null;
  /** Whose ticket the row opens, in the pop-up over the Inbox (`?open=`). */
  candidate: { id: string; name: string };
  applicationId: string;
  jobTitle: string | null;
  href: string;
  page: string;
};

export type DigestGroupKey = "decided" | "booked" | "fyi";
export type DigestGroup = { key: DigestGroupKey; label: string; rows: DigestRow[] };

export type Digest = {
  groups: DigestGroup[];
  /** Everything in the range, read or not, plus Needs you. */
  total: number;
  /** What is listed: Needs you and each group's first six. */
  shown: number;
  /** Every unread row, past each group's six too. */
  unread: ReadMark[];
};

const nameOf = (s: DigestSubject) => s.personName?.trim() || "This candidate";
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const STAGE_WORD: Record<string, string> = {
  sourced: "moves back to sourced",
  contacted: "moves to contacted",
  screening: "moves to screening",
  interviewing: "moves to interviews",
  offer: "moves to an offer",
  hired: "is hired",
  rejected: "is a no",
};

/** Only the stage: an event's detail can hold a rejection's reason. No sentence says an email went out: a move sends none. */
const decided = (e: StageEvent) => `${nameOf(e)} ${(e.toStage && STAGE_WORD[e.toStage]) || "moves to a new stage"}.`;

function interviewers(names: string[]): string | null {
  const [one, two, ...rest] = names.map(firstName);
  if (!one) return null;
  if (!two) return one;
  return rest.length ? `${one} and ${rest.length + 1} others` : `${one} and ${two}`;
}

function booked(b: Booking): string {
  const who = interviewers(b.interviewerNames);
  return who ? `${nameOf(b)} is booked with ${who}.` : `${nameOf(b)} has an interview booked.`;
}

const VERDICT: Record<string, string> = { strong_yes: "a strong yes", yes: "a yes", no: "a no", strong_no: "a strong no" };

function filed(f: FiledFeedback): string {
  const who = f.interviewerName ? firstName(f.interviewerName) : "An interviewer";
  const verdict = f.recommendation ? VERDICT[f.recommendation] : undefined;
  return `${who} sent a read on ${nameOf(f)}${verdict ? `: ${verdict}` : ""}.`;
}

const candidatePage = (s: DigestSubject) => `/client/candidates/${s.personId}`;
const metaOf = (person: string | null, s: DigestSubject) => [person, s.jobTitle].filter(Boolean).join(" · ");

function rows(input: DigestInput, range: DigestRange): Record<DigestGroupKey, DigestRow[]> {
  const base = (s: DigestSubject, id: string, mark: ReadMark) => ({
    id,
    mark,
    at: mark.at,
    candidate: { id: s.personId, name: nameOf(s) },
    applicationId: s.applicationId,
    jobTitle: s.jobTitle,
    href: inboxHref(range, null, id),
    page: candidatePage(s),
  });
  return {
    decided: input.events.map((e) => ({ ...base(e, e.id, { key: `evt-${e.id}`, reason: "decided", at: e.at }), what: decided(e), who: e.actorName, meta: metaOf(e.actorName, e), interviewAt: null })),
    booked: input.bookings.map((b) => {
      const lead = b.interviewerNames[0] ?? null;
      return { ...base(b, b.id, { key: `iv-${b.id}`, reason: "booked", at: b.at }), what: booked(b), who: lead, meta: metaOf(lead, b), interviewAt: b.startsAt };
    }),
    fyi: input.feedback.map((f) => ({ ...base(f, f.id, { key: `iv-${f.interviewId}`, reason: "filed", at: f.at }), what: filed(f), who: f.interviewerName, meta: metaOf(f.interviewerName, f), interviewAt: null })),
  };
}

const LABEL: Record<DigestGroupKey, string> = { decided: "Decisions made", booked: "Booked", fyi: "FYI" };
const GROUPS: DigestGroupKey[] = ["decided", "booked", "fyi"];

export function buildDigest(input: DigestInput, read: ReadonlySet<string>, range: DigestRange, now: number, needs: number): Digest {
  const from = Date.parse(rangeStart(range, now));
  const all = rows(input, range);
  const inRange = GROUPS.map((key) => {
    const within = all[key].filter((r) => Date.parse(r.at) >= from);
    const unread = within.filter((r) => !read.has(markId(r.mark))).sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
    return { key, within, unread };
  });
  const groups = inRange.flatMap(({ key, unread }): DigestGroup[] => (unread.length ? [{ key, label: LABEL[key], rows: unread.slice(0, GROUP_MAX) }] : []));
  return {
    groups,
    total: needs + inRange.reduce((n, g) => n + g.within.length, 0),
    shown: needs + groups.reduce((n, g) => n + g.rows.length, 0),
    unread: inRange.flatMap((g) => g.unread.map((r) => r.mark)),
  };
}

/**
 * The row `?open=` asks for, by its exact id among the rows this member's own
 * read listed. A tampered id, someone else's row, or one read or aged out of
 * the range matches nothing, so nothing about it is read and no pop-up opens.
 */
export const selectedRow = (groups: DigestGroup[], id: string | null | undefined): DigestRow | null => groups.flatMap((g) => g.rows).find((r) => r.id === id) ?? null;

/** What takes focus when a row goes: the one below it, across Needs you and the groups, else the one above. */
export function rowAfter(walk: string[], key: string): string | null {
  const i = walk.indexOf(key);
  if (i < 0) return null;
  return walk[i + 1] ?? walk[i - 1] ?? null;
}

/** Mark all as read covers what the page showed, not what landed after it. */
export const seenBy = (marks: ReadMark[], asOf: string) => marks.filter((m) => Date.parse(m.at) <= Date.parse(asOf));

/** "4 worth your time, from 1,205 updates". */
export const worthLine = (shown: number, total: number) => `${shown.toLocaleString("en-US")} worth your time, from ${total.toLocaleString("en-US")} update${total === 1 ? "" : "s"}`;
