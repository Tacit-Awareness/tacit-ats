import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildDigest, DIGEST_KEY, DIGEST_REASONS, inboxHref, markId, parseMark, parseRange, rangeStart, seenBy, worthLine, type Booking, type DigestInput, type FiledFeedback, type ReadMark, type StageEvent } from "./inbox-digest";
import { doneItems, isIssueKey, parseInstance, type Dismissal } from "./inbox-done";
import { isIssueReason } from "./inbox-issues";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const subject = { applicationId: uuid(100), personId: uuid(101), personName: "Sam Lee", jobTitle: "Staff Engineer", live: true };
const event = (n: number, over: Partial<StageEvent> = {}): StageEvent => ({ ...subject, id: uuid(n), actorName: "Ada Admin", toStage: "offer", at: hoursAgo(2), ...over });
const booking = (n: number, over: Partial<Booking> = {}): Booking => ({ ...subject, id: uuid(n), interviewerNames: ["Dana Fox"], startsAt: hoursAgo(-24), at: hoursAgo(3), ...over });
const feedback = (n: number, over: Partial<FiledFeedback> = {}): FiledFeedback => ({ ...subject, id: uuid(n), interviewId: uuid(n + 500), interviewerName: "Dana Fox", recommendation: "yes", at: hoursAgo(4), ...over });
const input = (over: Partial<DigestInput> = {}): DigestInput => ({ events: [], bookings: [], feedback: [], ...over });
const none = new Set<string>();
const whats = (d: ReturnType<typeof buildDigest>) => d.groups.flatMap((g) => g.rows.map((r) => r.what));

describe("grouping", () => {
  test("stage changes are decisions, interviews booked, feedback FYI, in that order", () => {
    const d = buildDigest(input({ feedback: [feedback(3)], bookings: [booking(2)], events: [event(1)] }), none, 1, NOW, 0);
    expect(d.groups.map((g) => [g.key, g.label])).toEqual([["decided", "Decisions made"], ["booked", "Booked"], ["fyi", "FYI"]]);
    expect(whats(d)).toEqual(["Sam Lee moves to an offer.", "Sam Lee is booked with Dana.", "Dana filed feedback on Sam Lee: a yes."]);
  });

  test("a group with nothing in it is left out", () => {
    expect(buildDigest(input({ events: [event(1)] }), none, 1, NOW, 0).groups.map((g) => g.key)).toEqual(["decided"]);
    expect(buildDigest(input(), none, 1, NOW, 0).groups).toEqual([]);
  });

  test("a group shows its six newest, and Mark all as read still covers the rest", () => {
    const events = Array.from({ length: 8 }, (_, n) => event(n + 1, { at: hoursAgo(n + 1) }));
    const d = buildDigest(input({ events: [...events].reverse() }), none, 1, NOW, 0);
    expect(d.groups[0]!.rows.map((r) => r.id)).toEqual(events.slice(0, 6).map((e) => e.id));
    expect(d.unread).toHaveLength(8);
  });

  test("the sentence counts what's listed against everything, Needs you in both", () => {
    const events = Array.from({ length: 8 }, (_, n) => event(n + 1));
    const d = buildDigest(input({ events }), new Set([markId({ key: `evt-${uuid(1)}`, reason: "decided", at: events[0]!.at })]), 1, NOW, 2);
    expect(d).toMatchObject({ shown: 8, total: 10 });
    expect(worthLine(1, 1)).toBe("1 worth your time, from 1 update");
    expect(worthLine(4, 1205)).toBe("4 worth your time, from 1,205 updates");
  });
});

describe("range", () => {
  test("1 day, 3 days and 1 week, with 1 day for anything else", () => {
    expect([parseRange("1"), parseRange("3"), parseRange("7")]).toEqual([1, 3, 7]);
    expect([parseRange(""), parseRange("30"), parseRange(null), parseRange("7 or 1=1")]).toEqual([1, 1, 1, 1]);
    expect(rangeStart(3, NOW)).toBe("2026-10-28T12:00:00.000Z");
  });

  test("leaves out what's older, in the rows and the count", () => {
    const events = [event(1, { at: hoursAgo(23) }), event(2, { at: hoursAgo(25) }), event(3, { at: hoursAgo(24 * 8) })];
    expect(buildDigest(input({ events }), none, 1, NOW, 0)).toMatchObject({ shown: 1, total: 1 });
    expect(buildDigest(input({ events }), none, 3, NOW, 0)).toMatchObject({ shown: 2, total: 2 });
    expect(buildDigest(input({ events }), none, 7, NOW, 0)).toMatchObject({ shown: 2, total: 2 });
  });

  test("the default range stays out of the URL, and an issue keeps the range it opened from", () => {
    expect(inboxHref(1)).toBe("/client/inbox");
    expect(inboxHref(3)).toBe("/client/inbox?range=3");
    expect(inboxHref(7, "app-x")).toBe("/client/inbox?range=7&i=app-x");
  });
});

describe("read marks", () => {
  test("a read row leaves the list and stays in the count", () => {
    const e = event(1);
    const d = buildDigest(input({ events: [e, event(2)] }), new Set([markId({ key: `evt-${e.id}`, reason: "decided", at: e.at })]), 1, NOW, 0);
    expect(d.groups[0]!.rows.map((r) => r.id)).toEqual([uuid(2)]);
    expect(d).toMatchObject({ shown: 1, total: 2 });
    expect(d.unread.map((m) => m.key)).toEqual([`evt-${uuid(2)}`]);
  });

  test("matches as instants: Postgres writes a timestamp its own way", () => {
    const e = event(1, { at: "2026-10-31T10:00:00.123456+00:00" });
    const read = new Set([markId({ key: `evt-${e.id}`, reason: "decided", at: "2026-10-31T10:00:00.123Z" })]);
    expect(buildDigest(input({ events: [e] }), read, 1, NOW, 0).groups).toEqual([]);
  });

  test("a booking read says nothing about the feedback on the same interview", () => {
    const b = booking(1);
    const f = feedback(2, { interviewId: b.id });
    const d = buildDigest(input({ bookings: [b], feedback: [f] }), new Set([markId({ key: `iv-${b.id}`, reason: "booked", at: b.at })]), 1, NOW, 0);
    expect(d.groups.map((g) => g.key)).toEqual(["fyi"]);
  });

  test("two interviewers' feedback on one interview are two rows", () => {
    const d = buildDigest(input({ feedback: [feedback(1, { interviewId: uuid(9) }), feedback(2, { interviewId: uuid(9), at: hoursAgo(5) })] }), none, 1, NOW, 0);
    expect(new Set(d.groups[0]!.rows.map((r) => r.id)).size).toBe(2);
  });

  test("Mark all as read leaves what landed after the page", () => {
    const marks: ReadMark[] = [{ key: `evt-${uuid(1)}`, reason: "decided", at: hoursAgo(2) }, { key: `evt-${uuid(2)}`, reason: "decided", at: hoursAgo(0) }];
    expect(seenBy(marks, hoursAgo(1))).toEqual([marks[0]]);
  });

  test("a form's mark is re-read", () => {
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    const good = { markKey: `evt-${uuid(1)}`, markReason: "decided", markAt: "2026-10-31T10:00:00.123456+00:00" };
    expect(parseMark(form(good))).toEqual({ key: good.markKey, reason: "decided", at: good.markAt });
    expect(parseMark(form({ ...good, markKey: `app-${uuid(1)}` }))).toBeNull();
    expect(parseMark(form({ ...good, markKey: "evt-Sam Lee" }))).toBeNull();
    expect(parseMark(form({ ...good, markReason: "overdue" }))).toBeNull();
    expect(parseMark(form({ ...good, markAt: "yesterday" }))).toBeNull();
  });
});

describe("Done and the digest's marks", () => {
  test("no key or reason is one an issue can have", () => {
    expect(DIGEST_REASONS.filter(isIssueReason)).toEqual([]);
    expect(isIssueKey(`evt-${uuid(1)}`)).toBe(false);
    expect(isIssueKey(`iv-${uuid(1)}`)).toBe(false);
    expect(DIGEST_KEY.test(`app-${uuid(1)}`)).toBe(false);
  });

  test("the keys and reasons fit the table's checks", () => {
    expect(`evt-${uuid(1)}`).toMatch(/^[a-z]{1,16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const r of DIGEST_REASONS) expect(r).toMatch(/^[a-z]{1,20}$/);
  });

  test("Done words none of them, even with a subject to hand", () => {
    const mark = (key: string, reason: string): Dismissal => ({ id: uuid(7), key, reason, at: hoursAgo(1), how: "dismissed", dismissedAt: hoursAgo(1) });
    const rows = [mark(`evt-${uuid(1)}`, "decided"), mark(`iv-${uuid(2)}`, "booked"), mark(`iv-${uuid(2)}`, "filed")];
    const subjects = new Map(rows.map((r) => [r.key, { candidate: { id: uuid(3), name: "Sam" }, jobId: null, jobTitle: "Job", approvalKind: null }]));
    expect(doneItems(rows, [], subjects)).toEqual([]);
  });

  test("Dismiss's parser refuses a digest key", () => {
    const f = new FormData();
    f.set("issueKey", `evt-${uuid(1)}`);
    f.set("issueReason", "feedback");
    f.set("issueAt", hoursAgo(1));
    expect(parseInstance(f)).toBeNull();
  });
});

describe("nothing private in the wording", () => {
  test("a stage change's reason never reaches a row: only the stage is an input", () => {
    const d = buildDigest(input({ events: [event(1, { toStage: "rejected", detail: "Failed the reference check" } as Partial<StageEvent>)] }), none, 1, NOW, 0);
    expect(whats(d)).toEqual(["Sam Lee is a no."]);
    expect(JSON.stringify(d)).not.toContain("reference check");
  });

  test("feedback is who and the one-word verdict, and no notes or rating get through", () => {
    const extra = { notes: "Struggled with the systems round", rating: 2 } as Partial<FiledFeedback>;
    const json = JSON.stringify(buildDigest(input({ feedback: [feedback(1, extra)] }), none, 1, NOW, 0));
    expect(json).not.toContain("Struggled");
    expect(json).not.toContain("rating");
  });

  test("no verdict to hand, none claimed", () => {
    const d = buildDigest(input({ feedback: [feedback(1, { recommendation: null, interviewerName: null })] }), none, 1, NOW, 0);
    expect(whats(d)).toEqual(["An interviewer filed feedback on Sam Lee."]);
  });

  test("a stage it doesn't know is never printed raw, and a rejection claims no email", () => {
    expect(whats(buildDigest(input({ events: [event(1, { toStage: "<b>odd</b>" })] }), none, 1, NOW, 0))).toEqual(["Sam Lee moves to a new stage."]);
    expect(whats(buildDigest(input({ events: [event(1, { toStage: "rejected" })] }), none, 1, NOW, 0)).join()).not.toMatch(/note|email|went out/i);
  });

  test("the feed never asks for the private columns", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const code = readFileSync(join(here, "inbox-feed.ts"), "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    const selects = [...code.matchAll(/\bselect\(`?"?([^`"\n]*)/g), ...code.matchAll(/const SUBJECT = "([^"]*)"/g)].map((m) => m[1]).join(" ");
    expect(selects).toContain("recommendation");
    expect(selects).not.toMatch(/\b(notes?|rating|detail|subject|body|filename|location_or_link|rejection_note|source_detail)\b/);
  });
});

describe("where a row goes", () => {
  test("a live application opens in the Pipeline's pop-up, and the arrow is always their page", () => {
    const [row] = buildDigest(input({ events: [event(1)] }), none, 1, NOW, 0).groups[0]!.rows;
    expect(row).toMatchObject({ href: `/client/pipeline?open=${subject.applicationId}`, page: `/client/candidates/${subject.personId}` });
  });

  test("a closed one goes to the candidate: the pop-up can't show it", () => {
    const [row] = buildDigest(input({ events: [event(1, { live: false })] }), none, 1, NOW, 0).groups[0]!.rows;
    expect(row!.href).toBe(`/client/candidates/${subject.personId}`);
  });

  test("a name the member can't read, and an interview with nobody on it, still read as sentences", () => {
    const d = buildDigest(input({ bookings: [booking(1, { personName: null, interviewerNames: [] })] }), none, 1, NOW, 0);
    expect(whats(d)).toEqual(["This candidate has an interview booked."]);
    expect(whats(buildDigest(input({ bookings: [booking(2, { interviewerNames: ["Dana Fox", "Lee Lead", "Ivan Ng"] })] }), none, 1, NOW, 0))).toEqual(["Sam Lee is booked with Dana and 2 others."]);
  });
});
