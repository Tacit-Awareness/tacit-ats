import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The Inbox's frame, in the markup. No test here can run an effect (the repo
// has no DOM environment), so what the keys and the focus do in a browser is
// lib/client/inbox-popup.test.ts for the helpers and a look at the page for the rest.

vi.mock("next/navigation", () => ({ usePathname: () => "/client/inbox", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("../onboarding/process/actions", () => ({ readProcessAction: vi.fn(), saveProcessAction: vi.fn(), previewApplyAction: vi.fn(), applyProcessAction: vi.fn() }));
vi.mock("./actions", () => ({ dismissIssueAction: vi.fn(), restoreIssueAction: vi.fn(), fixIssueAction: vi.fn(), decideIssueAction: vi.fn(), markDigestReadAction: vi.fn(), markAllDigestReadAction: vi.fn() }));
vi.mock("../applicants/actions", () => ({ routeApplicantAction: vi.fn(), draftReplyAction: vi.fn(), sendReplyAction: vi.fn(), addApplicantAction: vi.fn() }));

import { ignoreKey, modalOpen } from "@/lib/keys";
import { DoneView } from "./done-view";
import { InboxView, type DigestProps, type IssueReaderProps } from "./view";

const FRAME = 'class="grid grid-cols-[minmax(0,1fr)] content-start';
const row = { key: "k", kind: "late" as const, href: "/client/inbox?i=k", what: "Nobody has been in touch", who: null, line: "Sam", age: "9d ago", active: true };
const other = { ...row, key: "j", href: "/client/inbox?i=j", what: "Waiting on feedback", who: "Dana", line: "Dana · Lee", age: "2d ago", active: false };
const issue: IssueReaderProps = {
  kind: "late",
  instance: { key: "k", reason: "quiet", at: "2026-10-20T10:00:00Z" },
  what: "Nobody has been in touch",
  subject: "Sam · Staff Engineer",
  who: null,
  age: "Waiting 2d",
  card: { title: "t", detail: "d" },
  draft: null,
  reply: null,
  fix: { type: "link", label: "Open candidate", href: "/client/candidates/p" },
  decision: null,
  terms: null,
  next: null,
  secondary: null,
  page: "/client/candidates/p",
  story: null,
  now: 0,
};
const view = (over: Partial<React.ComponentProps<typeof InboxView>> = {}) => renderToStaticMarkup(<InboxView rows={[{ ...row, active: false }, other]} issue={null} flash={null} truncated={false} draftsCapped={false} {...over} />);
describe("the opening", () => {
  const digest: DigestProps = { range: 1, asOf: "", unread: 0, capped: false, total: 3, shown: 2, sources: [{ label: "Stage moves", count: 3 }], groups: [] };

  test("plays over the card, and the card's real line stays underneath it", () => {
    const html = view({ digest });
    expect(html).toContain("ibx-opening");
    expect(html).toContain("Reading 3 updates…");
    expect(html).toContain("Stage moves");
    expect(html).toContain("2 worth your time");
  });

  test("says nothing of a Grokbot, Slack or Gmail", () => {
    expect(view({ digest })).not.toMatch(/grok|slack|gmail/i);
  });

  test("does not play over a notice or a pop-up", () => {
    expect(view({ digest, flash: "Done" })).not.toContain("ibx-opening");
    expect(opened({ digest })).not.toContain("ibx-opening");
  });

  test("plays with nothing to show too: the read is how the Inbox opens", () => {
    expect(view({ rows: [], digest: { ...digest, total: 0, shown: 0 } })).toContain("ibx-opening");
  });
});

const opened = (over: Partial<React.ComponentProps<typeof InboxView>> = {}) => view({ rows: [row, other], issue, ...over });

describe("the digest card", () => {
  test("says what's worth your time on the title's hover, then a row each: what's wrong, who, how long", () => {
    const html = view();
    expect(html).toContain("Welcome back");
    expect(html).toContain('title="2 worth your time, from 2 updates"');
    // The three kinds of work, in Hy's order.
    expect(html.indexOf("New applicants")).toBeLessThan(html.indexOf("Interview judgement"));
    expect(html.indexOf("Interview judgement")).toBeLessThan(html.indexOf("Interview routing"));
    expect(html).toContain("Waiting on feedback");
    // The row's facts sit side by side with space between, never a dot.
    expect(html).toContain(">Dana</span>");
    expect(html).toContain(">Lee</span>");
    expect(html).not.toContain("Dana · Lee");
    expect(html).toContain("2d ago");
    expect(view({ rows: [row] })).toContain("1 worth your time, from 1 update");
  });

  test("a row opens by URL, leaving the card's scroll alone", () => {
    expect(view()).toContain('href="/client/inbox?i=j"');
    expect(view()).toContain('data-issue-row="j"');
  });

  test("has no Open and Done tabs: Done is a quiet link in the footer", () => {
    const html = view();
    expect(html).not.toContain('aria-label="Inbox"');
    const foot = html.slice(html.indexOf("<footer"));
    expect(foot).toContain('href="/client/inbox?tab=done"');
    expect(foot).toContain(">Done<");
  });

  test("J and K walk every row: what is only news is a key item too", () => {
    const info = { id: "e1", mark: { key: "evt-x", reason: "decided" as const, at: "2026-10-31T10:00:00Z" }, what: "Sam moves to an offer.", who: null, meta: "", at: "2026-10-31T10:00:00Z", interviewAt: null, candidate: { id: "p", name: "Sam" }, applicationId: "a", jobTitle: "Job", href: "/client/inbox?open=e1", page: "/client/candidates/p", age: "2h ago", active: false, next: "j" };
    const html = view({ digest: { range: 1, asOf: "2026-10-31T12:00:00.000Z", total: 3, shown: 3, unread: 1, capped: false, groups: [{ key: "decided", label: "Decisions made", rows: [info] }] } });
    expect(html.match(/data-key-item/g)).toHaveLength(3);
    expect(html.match(/data-key-row/g)).toHaveLength(3);
    expect(html).toContain('data-issue-row="e1"');
  });

  test("nothing opened is no pop-up, and the notice reads on the card", () => {
    const html = view({ flash: <p>Moved to Done.</p> });
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("Moved to Done.");
  });
});

describe("a row's buttons", () => {
  const live = { ...row, active: false, instance: { key: "k", reason: "quiet" as const, at: "2026-10-20T10:00:00Z" }, page: "/client/candidates/p", next: null };
  const html = () => view({ rows: [live] });
  const link = () => html().match(/<a [^>]*data-issue-row[\s\S]*?<\/a>/)![0];

  test("Dismiss posts the row's instance, marked as from the card", () => {
    expect(html()).toContain('name="issueKey" value="k"');
    expect(html()).toContain('name="issueReason" value="quiet"');
    expect(html()).toContain('name="from" value="row"');
  });

  test("the row's link holds neither button", () => {
    expect(link()).not.toContain("<button");
    expect(link()).not.toContain("<form");
    expect(link().match(/<a /g)).toHaveLength(1);
  });

  test("open goes to the page, not the pop-up", () => {
    expect(html()).toContain('aria-label="Open as a page: Nobody has been in touch"');
    expect(html()).toContain('href="/client/candidates/p"');
  });

  test("a row that can't say the member may open it has only Dismiss", () => {
    const only = view({ rows: [{ ...live, page: null }] });
    expect(only).not.toContain("Open as a page");
    expect(only).toContain("Dismiss:");
  });

  test("a row with nothing to dismiss, as on Done, has neither", () => {
    expect(view()).not.toContain('name="from"');
  });
});

describe("the pop-up", () => {
  test("is a labelled modal over the card, and ✕ goes back to the plain Inbox", () => {
    const html = opened();
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-label="Close"');
    expect(html).toMatch(/aria-label="Close"[^>]*href="\/client\/inbox"/);
  });

  test("has Open as a page when there's one to open", () => {
    expect(opened()).toContain('aria-label="Open as a page"');
    expect(opened()).toContain('href="/client/candidates/p"');
    expect(opened({ issue: { ...issue, page: null } })).not.toContain('aria-label="Open as a page"');
  });

  test("holds the reader, and the column holds to the sheet, so the notice's Undo is on screen", () => {
    const html = opened({ flash: <p>Moved to Done.</p> });
    const sheet = html.slice(html.indexOf('role="dialog"'));
    expect(sheet).toContain("Sam · Staff Engineer");
    expect(sheet).toContain("Open candidate");
    expect(sheet).toContain("Dismiss");
    expect(sheet).toContain(FRAME);
    expect(sheet).toContain("Moved to Done.");
    expect(html.indexOf("Moved to Done.")).toBe(html.lastIndexOf("Moved to Done."));
  });

  // keys.tsx's useKeys and keys.ts's ignoreKey stand down for any open <dialog>,
  // so one here would quietly turn off A, O, R, F, E, J and K.
  test("is not a <dialog>, so the page keys reach the bars inside it", () => {
    const html = opened({ issue: { ...issue, decision: null } });
    expect(html).not.toContain("<dialog");
    const target = { ownerDocument: { querySelector: (s: string) => (s.startsWith("dialog") && html.includes("<dialog") ? {} : null) } };
    expect(modalOpen(target as unknown as EventTarget)).toBe(false);
    const e = { key: "a", metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: target as unknown as EventTarget };
    expect(ignoreKey(e)).toBe(false);
  });

  test("a confirmation on top of it still stops them, Esc included", () => {
    const target = { ownerDocument: { querySelector: () => ({}) } };
    const e = { key: "Escape", metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: target as unknown as EventTarget };
    expect(ignoreKey(e)).toBe(true);
  });

  test("what a member or candidate wrote is text, in the heading, the row and the draft", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = opened({
      rows: [{ ...row, what: evil, line: evil }],
      issue: { ...issue, what: evil, subject: evil, draft: { to: "a@b.co", subject: evil, body: evil, from: null, replyTo: null }, fix: { type: "send", label: "Send here", draftId: "d", canSend: true } },
    });
    expect(html).not.toContain("<img");
  });

  test("an offer's terms show only in the pop-up, never on the card", () => {
    const terms = [{ label: "Base", value: "$200,000" }];
    expect(view()).not.toContain("$200,000");
    expect(opened({ issue: { ...issue, terms } })).toContain("$200,000");
  });

  test("every form in it posts the range it opened from", () => {
    const html = opened({ issue: { ...issue, fix: { type: "write", write: "touch", label: "Log a touch", applicationId: "a", nextAction: null } }, digest: { range: 3, asOf: "2026-10-31T12:00:00.000Z", total: 2, shown: 2, unread: 0, capped: false, groups: [] } });
    const sheet = html.slice(html.indexOf('role="dialog"'));
    expect(sheet.match(/name="range" value="3"/g)).toHaveLength(2);
  });
});

describe("a decision's whole ticket", () => {
  const loop = { candidate: "Sam", tag: "Round 1 of 2", loopLine: "Staff Engineer · 1 of 2 rounds held", rounds: [], route: null, editProcess: null, partial: false, feedback: [], feedbackNote: null };
  const story = [{ at: "2026-10-20T10:00:00Z", kind: "note", title: "A short story", detail: null, actor: null }] as unknown as IssueReaderProps["story"];

  const reads = [{ feedbackId: "f1", interviewer: "Dana", recommendation: "Strong yes", verdict: "pass" as const, rating: 4, submitted: "Filed 2h ago", ratings: [], notes: "Hire them." }];
  const ticket = { title: "Ada Lovelace", subject: "Staff Engineer · Interviewing", loop: { ...loop, feedback: reads }, body: (call: React.ReactNode) => <>{call}<p>The whole candidate</p></> };

  test("names the candidate, then the route, the card with its buttons under them, and the candidate, with no thin story", () => {
    const html = opened({ issue: { ...issue, story, ticket } });
    const sheet = html.slice(html.indexOf('role="dialog"'));
    expect(sheet.indexOf("Ada Lovelace")).toBeLessThan(sheet.indexOf("Interview loop"));
    expect(sheet.indexOf("Interview loop")).toBeLessThan(sheet.indexOf('aria-label="Where it stands"'));
    expect(sheet.indexOf('aria-label="Where it stands"')).toBeLessThan(sheet.indexOf("Dismiss"));
    expect(sheet.indexOf("Dismiss")).toBeLessThan(sheet.indexOf("The whole candidate"));
    expect(sheet).not.toContain("A short story");
  });

  test("a candidate's reply is on the card, marked as theirs and as text", () => {
    const sheet = opened({ issue: { ...issue, reply: { subject: "Re: hello", body: "<b>Tuesday works</b>" }, ticket } });
    expect(sheet).toContain('data-untrusted="candidate-email"');
    expect(sheet).toContain("&lt;b&gt;Tuesday works&lt;/b&gt;");
    expect(sheet.indexOf("Tuesday works")).toBeLessThan(sheet.indexOf("The whole candidate"));
  });

  test("a line that only says when is the title's hover, and the bar leaves Open candidate to the header", () => {
    const fix = { type: "write" as const, write: "touch" as const, label: "Log a touch", applicationId: "a", nextAction: null };
    const sheet = opened({ issue: { ...issue, fix, card: { title: "No touch in over a week", detail: "Last touched 9d ago." }, secondary: { label: "Open candidate", href: "/client/candidates/p" }, ticket } });
    expect(sheet).toContain('title="Last touched 9d ago."');
    expect(sheet).not.toContain('text-muted-foreground">Last touched 9d ago.');
    expect(sheet).not.toContain("Open candidate");
    expect(sheet).toContain('aria-label="Open as a page"');
  });

  test("no fix to offer leaves no empty row for one", () => {
    expect(opened({ issue: { ...issue, fix: { type: "approval", requestId: "r", kind: "offer" }, decision: null, ticket } })).not.toContain("To move it on");
  });

  test("a decision's card holds the read and the buttons together", () => {
    const decision = { key: "d", target: { name: "approvalId", value: "a" }, actions: [] } as unknown as IssueReaderProps["decision"];
    const sheet = opened({ issue: { ...issue, decision, ticket } });
    expect(sheet).toContain('aria-label="Your call"');
    expect(sheet).toContain("Dana&#x27;s read");
    expect(sheet.indexOf("Hire them.")).toBeLessThan(sheet.indexOf("The whole candidate"));
    // The head carries who and the verdict; the transcript under it starts past the hire question.
    expect(sheet).toContain("read-thread");
    expect(sheet).toContain("What did you see?");
    expect(sheet).not.toContain("Would you hire");
  });

  test("with no loop to show it still has the candidate", () => {
    const html = opened({ issue: { ...issue, ticket: { title: "Ada Lovelace", subject: "Staff Engineer · Interviewing", loop: null, body: (call) => <>{call}<p>The whole candidate</p></> } } });
    expect(html).toContain("The whole candidate");
    expect(html).not.toContain("Interview loop");
  });

  test("an issue with no ticket keeps the reader as it was: a job's approval, an approver not on the job", () => {
    expect(opened({ issue: { ...issue, story: null, ticket: null } })).not.toContain("Interview loop");
  });
});

describe("a digest row's pop-up", () => {
  test("leaves where they stand to the candidate under it: no card repeats it, and nothing asks for a call", () => {
    const html = view({ person: { key: "e1", title: "Sam Lee", subject: "", page: "/p", loop: null, body: (call) => <>{call}</> } });
    expect(html).not.toContain('aria-label="Where it stands"');
    expect(html).not.toContain('aria-label="Your call"');
  });

  const person = { key: "e1", title: "Sam Lee", subject: "Staff Engineer · Offer", page: "/client/candidates/p", loop: null, body: () => <p>The whole candidate</p> };

  test("holds the whole candidate over the card, and closes back to the range", () => {
    const html = view({ person, home: "/client/inbox?range=3" });
    const sheet = html.slice(html.indexOf('role="dialog"'));
    expect(sheet).toContain("Sam Lee");
    expect(sheet).toContain("Staff Engineer · Offer");
    expect(sheet).toContain("The whole candidate");
    expect(sheet).toMatch(/aria-label="Close"[^>]*href="\/client\/inbox\?range=3"/);
    expect(sheet).toContain('aria-label="Open as a page"');
  });

  test("none open is none drawn", () => {
    expect(view()).not.toContain('role="dialog"');
  });

  // The row's own Mark read, so the pop-up has something to finish: the same post, on the same key.
  const news = { what: "Sam moves to an offer.", group: "decided" as const, who: "Priya Raman", at: "2026-10-31T10:00:00Z", age: "today", interviewAt: null, mark: { key: "evt-00000000-0000-4000-8000-000000000001", reason: "decided" as const, at: "2026-10-31T10:00:00Z" }, next: "k" };

  test("finishes with Mark read: what happened, who did it and when, and the row's own read mark on E", () => {
    const html = view({ person: { ...person, news, body: (call) => <>{call}</> } });
    const card = html.slice(html.indexOf('aria-label="What happened"'));
    expect(card).toContain("Sam moves to an offer<");
    expect(card).toContain("By Priya Raman");
    expect(card).toContain("today");
    expect(card).toMatch(/aria-keyshortcuts="E"[^>]*>Mark read<kbd/);
    for (const [name, value] of [["markKey", news.mark.key], ["markReason", "decided"], ["markAt", news.mark.at], ["range", "1"]]) expect(card).toContain(`type="hidden" name="${name}" value="${value}"`);
    expect(html).not.toContain('aria-label="Where it stands"');
    expect(html).not.toContain('aria-label="Your call"');
  });
});

describe("Done", () => {
  const done = (over: Partial<React.ComponentProps<typeof DoneView>> = {}) =>
    renderToStaticMarkup(
      <DoneView
        rows={[row]}
        item={{ id: "i", what: "Nobody had been in touch", subject: "Sam", how: "Dismissed today", since: null, canMoveBack: false, candidateHref: null, story: null, now: 0 }}
        flash={null}
        open
        capped={false}
        {...over}
      />,
    );

  test("the reader's column holds to the pane, as it did", () => {
    expect(done()).toContain(FRAME);
  });

  test("has no tabs, and its bar is the way back to the Inbox, empty or not", () => {
    for (const html of [done(), done({ rows: [], item: null, open: false })]) {
      expect(html).not.toContain('aria-label="Inbox"');
      expect(html).toContain('href="/client/inbox"');
    }
  });
});

// "You're all caught up" is a claim about everything, and the reads have caps:
// a hundred dismissed drafts hold the whole of the drafts read, so older ones
// never reach the queue and the page has nothing left to say so on.
describe("all caught up", () => {
  const empty = (caps: { truncated: boolean; draftsCapped: boolean }) => renderToStaticMarkup(<InboxView rows={[]} issue={null} flash={null} {...caps} />);

  test("says so when a read stopped at its cap", () => {
    expect(empty({ truncated: false, draftsCapped: true })).toContain("Showing your newest 100 unsent drafts.");
    expect(empty({ truncated: true, draftsCapped: false })).toContain("some missing feedback may not be listed");
  });

  test("says nothing when nothing did", () => {
    const html = empty({ truncated: false, draftsCapped: false });
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).toContain("Nothing new in the last 1 day.");
    expect(html).not.toContain("Showing your newest");
    expect(html).not.toContain("may not be listed");
  });

  test("still reaches Done, the only way back once a toast's Undo has gone", () => {
    expect(empty({ truncated: false, draftsCapped: false })).toContain('href="/client/inbox?tab=done"');
  });
});

describe("what happened lately", () => {
  const info = {
    id: "e1",
    mark: { key: "evt-00000000-0000-4000-8000-000000000001", reason: "decided" as const, at: "2026-10-31T10:00:00.123456+00:00" },
    what: "Sam moves to an offer.",
    who: "Ada Admin",
    meta: "Ada Admin · Staff Engineer",
    at: "2026-10-31T10:00:00.123456+00:00",
    interviewAt: null,
    candidate: { id: "p1", name: "Sam" },
    applicationId: "a1",
    jobTitle: "Staff Engineer",
    href: "/client/inbox?range=3&open=e1",
    page: "/client/candidates/p1",
    age: "today",
    active: false,
    next: null,
  };
  const digest: DigestProps = { range: 3, asOf: "2026-10-31T12:00:00.000Z", total: 9, shown: 3, unread: 7, capped: false, groups: [{ key: "decided", label: "Decisions made", rows: [info] }] };

  test("sits after what needs the member in its section, with the range and its own row", () => {
    const html = view({ digest });
    expect(html).toContain("3 worth your time, from 9 updates");
    const routing = html.slice(html.indexOf('data-section="routing"'));
    expect(routing.indexOf('data-issue-row="k"')).toBeLessThan(routing.indexOf('data-issue-row="e1"'));
    expect(html).toContain('href="/client/inbox?range=3&amp;open=e1"');
    expect(html).toContain('href="/client/candidates/p1"');
    expect(html).toContain('aria-label="Mark read: Sam moves to an offer."');
    expect(html).toContain('value="2026-10-31T10:00:00.123456+00:00"');
  });

  test("a row says who, the job and when, the server's when being relative", () => {
    const html = view({ digest });
    expect(html).toContain(">Ada Admin</span>");
    expect(html).toContain(">Staff Engineer</span>");
    expect(html).not.toContain("Ada Admin · Staff Engineer");
    expect(html).toMatch(/tabular-nums">today</);
  });

  test("has no range switch (a link's ?range= still holds, in every row), and Done stays", () => {
    const html = view({ digest });
    expect(html).not.toContain('aria-label="How far back"');
    expect(html).toContain('href="/client/inbox?range=3&amp;open=e1"');
    expect(html).toContain('href="/client/inbox?tab=done"');
  });

  test("Mark all as read posts the range and when the page was read, and goes once nothing's unread", () => {
    const html = view({ digest });
    expect(html).toContain("Mark all as read");
    expect(html).toContain('name="asOf" value="2026-10-31T12:00:00.000Z"');
    expect(view({ digest: { ...digest, unread: 0, groups: [] } })).not.toContain("Mark all as read");
  });

  test("with no rows of its own it says so only when Needs you is empty too", () => {
    const quiet = { ...digest, total: 0, shown: 0, unread: 0, groups: [] };
    expect(view({ rows: [], digest: quiet })).toContain("Nothing new in the last 3 days.");
    expect(view({ digest: quiet })).not.toContain("You&#x27;re all caught up");
    expect(view({ rows: [], digest })).not.toContain("You&#x27;re all caught up");
  });

  test("a candidate's name renders as text", () => {
    const html = view({ digest: { ...digest, groups: [{ key: "decided", label: "Decisions made", rows: [{ ...info, what: "<script>alert(1)</script> moves to an offer." }] }] } });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("a booking words its time in the browser, and the server names none", () => {
    const html = view({ digest: { ...digest, groups: [{ key: "booked", label: "Booked", rows: [{ ...info, what: "Sam is booked with Dana.", interviewAt: "2026-11-03T09:00:00Z" }] }] } });
    // An entry's line ends with no full stop, the time or not.
    expect(html).toContain("Sam is booked with Dana</span>");
    expect(html).not.toContain("Nov 3");
  });

  test("a cut-off read says so", () => {
    expect(view({ digest: { ...digest, capped: true } })).toContain("only the newest updates are listed");
  });
});

// Hy's three kinds of work: who is newly in, reads and feedback, and moving a
// candidate on. Each issue and digest group lands in one, the filter shows all
// or one, and a new applicant's row opens their ticket in the pop-up, as New Applicants draws it.
describe("the three sections", () => {
  const at = "2026-10-31T10:00:00Z";
  const issueRow = (key: string, reason: "feedback" | "decide" | "reply", kind: "late" | "decide" | "reply") => ({ ...row, key, kind, href: `/client/inbox?i=${key}`, what: `What ${key}`, active: false, instance: { key, reason, at }, page: null, next: null });
  const info = (id: string) => ({ id, mark: { key: "evt-00000000-0000-4000-8000-000000000001", reason: "decided" as const, at }, what: `News ${id}.`, who: null, meta: "", at, interviewAt: null, candidate: { id: "p", name: "Sam" }, applicationId: "a", jobTitle: "Job", href: `/client/inbox?open=${id}`, page: "/client/candidates/p", age: "today", active: false, next: null });
  const digest: DigestProps = {
    range: 1,
    asOf: at,
    total: 6,
    shown: 6,
    unread: 3,
    capped: false,
    groups: [
      { key: "decided", label: "Decisions made", rows: [info("moved")] },
      { key: "booked", label: "Booked", rows: [info("booked")] },
      { key: "fyi", label: "FYI", rows: [info("filed")] },
    ],
  };
  const rows = [issueRow("fb", "feedback", "late"), issueRow("call", "decide", "decide"), issueRow("wrote", "reply", "reply")];
  const applicants = {
    total: 9,
    href: "/client/applicants",
    rows: [
      { applicationId: "a1", href: "/client/inbox?a=a1", page: "/client/applicants?a=a1", name: "Lin Zhou", referral: false, job: "Founding Engineer", source: "Job board", age: "today", active: false },
      { applicationId: "a2", href: "/client/inbox?a=a2", page: "/client/applicants?a=a2", name: "Sofia Alvarez", referral: true, job: "Founding Engineer", source: "Backchannel from Daniel", age: "1d ago", active: false },
    ],
  };
  const sectionOf = (html: string, key: string) => {
    const from = html.indexOf(`data-section="${key}"`);
    const next = html.indexOf("data-section=", from + 1);
    return html.slice(from, next < 0 ? undefined : next);
  };
  // A notice skips the opening, so the counts are already there.
  const card = (over: Partial<React.ComponentProps<typeof InboxView>> = {}) => view({ rows, digest, applicants, flash: <p>ok</p>, ...over });

  test("feedback and reads filed are judgement; a call, a reply, a stage move and a booking are routing", () => {
    const html = card();
    expect(sectionOf(html, "judgement")).toContain('data-issue-row="fb"');
    expect(sectionOf(html, "judgement")).toContain('data-issue-row="filed"');
    for (const id of ["call", "wrote", "moved", "booked"]) expect(sectionOf(html, "routing")).toContain(`data-issue-row="${id}"`);
  });

  test("in a section, what needs the member comes before what is only news", () => {
    const routing = sectionOf(card(), "routing");
    expect(routing.indexOf('data-issue-row="wrote"')).toBeLessThan(routing.indexOf('data-issue-row="moved"'));
    // No label between them: a news entry's plain weight and its glyph say so.
    expect(routing).not.toContain(">Updates<");
  });

  test("a new applicant opens their ticket in the pop-up, in words, with their place in New Applicants beside it, and the rest are a link away", () => {
    const html = sectionOf(card(), "applicants");
    expect(html).toMatch(/data-issue-row="a1" aria-haspopup="dialog"[^>]*href="\/client\/inbox\?a=a1"/);
    expect(html).toContain('aria-label="Open as a page: Lin Zhou applied" class');
    expect(html).toContain('href="/client/applicants?a=a1"');
    expect(html).toContain("Lin Zhou applied");
    expect(html).toContain("Sofia Alvarez was referred");
    expect(html).toContain("Backchannel from Daniel");
    expect(html).toContain("All 9 in New Applicants");
  });

  test("J and K reach a new applicant over the card and from a pop-up alike, where they open the next ticket", () => {
    expect(card().match(/data-key-item/g)).toHaveLength(8);
    expect(card({ issue }).match(/data-key-item/g)).toHaveLength(8);
  });

  // New Applicants' own reader: the application as its white page, then the routing bar and the reply, posting back here.
  const ticket = {
    applicationId: "a1",
    name: "Lin Zhou",
    email: "lin@example.test",
    phone: null,
    jobTitle: "Founding Engineer",
    jobHref: "/client/jobs/j1",
    applied: "today",
    referral: false,
    added: false,
    source: "Job board",
    notes: [],
    files: [],
    team: "Infra",
    answers: [{ questionId: "q1", label: "Where are you based?", value: "Austin, TX", href: null }],
    routing: { applicationId: "a1", next: "a2", reasons: [{ reasonId: "r1", name: "Not a fit" }], inbox: 3 },
    reply: null,
  };
  const applicant = { key: "a1", title: "Lin Zhou", subject: "Founding Engineer", page: "/client/applicants?a=a1", ticket };

  test("a new applicant's pop-up is their ticket as New Applicants draws it, routed from right there", () => {
    const html = card({ applicant, applicants: { ...applicants, rows: applicants.rows.map((r) => ({ ...r, active: r.applicationId === "a1" })) }, home: "/client/inbox?range=3" });
    const sheet = html.slice(html.indexOf('role="dialog"'));
    expect(sheet).toContain("Lin Zhou");
    expect(sheet).toContain("Austin, TX");
    expect(sheet).toMatch(/aria-label="Open as a page"[^>]*href="\/client\/applicants\?a=a1"|href="\/client\/applicants\?a=a1"[^>]*aria-label="Open as a page"/);
    expect(sheet).toMatch(/aria-label="Close"[^>]*href="\/client\/inbox\?range=3"|href="\/client\/inbox\?range=3"[^>]*aria-label="Close"/);
    for (const pick of ["Interview", "Testbench", "Decline"]) expect(sheet).toContain(`>${pick}<kbd`);
    expect(sheet).toContain('<span title="Infra"');
    expect(sheet).toContain('type="hidden" name="applicationId" value="a1"');
    expect(sheet).toContain('type="hidden" name="next" value="a2"');
    expect(sheet).toContain('type="hidden" name="inbox" value="3"');
    // The pop-up has its own close, so the phone's way back to the list stays on New Applicants.
    expect(sheet).not.toContain("All applicants");
    expect(sectionOf(html, "applicants")).toMatch(/data-issue-row="a1" aria-current="true"/);
  });

  test("a refusal from routing shows on the ticket it came back to, not on the card", () => {
    const html = card({ applicant, flash: <p>Someone already moved them on</p> });
    expect(html.slice(html.indexOf('role="dialog"'))).toContain("Someone already moved them on");
    expect(html.slice(0, html.indexOf('role="dialog"'))).not.toContain("Someone already moved them on");
  });

  test("a section with nothing in it says so, and the card is not all caught up while anything is left", () => {
    const html = card({ rows: [], digest: { ...digest, groups: [] } });
    expect(sectionOf(html, "routing")).toContain("Nothing here right now.");
    expect(html).not.toContain("You&#x27;re all caught up");
  });

  test("the filter is All and the three, each with its count once the read is done", () => {
    const html = card();
    expect(html).toContain('role="tablist" aria-label="Show"');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>All</);
    for (const label of ["New applicants", "Interview judgement", "Interview routing"]) expect(html).toMatch(new RegExp(`role="tab" aria-selected="false"[^>]*>${label}`));
    // 9 newly in; feedback and a read filed; a call, a reply, a stage move and a booking.
    for (const n of [9, 2, 4]) expect(html).toContain(`>${n}</span></span></button>`);
    // Without a notice the card opens: the counts are in the markup, and inbox.css holds them back until the read is done.
    expect(view({ rows, digest, applicants })).toContain("ibx-count");
  });

  test("?show= opens the card on one section", () => {
    const html = card({ show: "judgement" });
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Interview judgement/);
    expect(html).toContain('data-section="judgement"');
    expect(html).not.toContain('data-section="routing"');
    expect(html).not.toContain('data-section="applicants"');
  });

  test("an approval, a quiet application, an overdue follow-up and an unsent invite are routing too", () => {
    const more = (["approval", "quiet", "overdue", "draft"] as const).map((r) => ({ ...row, key: r, href: `/client/inbox?i=${r}`, active: false, instance: { key: r, reason: r, at }, page: null, next: null }));
    const routing = sectionOf(card({ rows: more }), "routing");
    for (const r of more) expect(routing).toContain(`data-issue-row="${r.key}"`);
  });
});

// What a `"use client"` file exports reaches a server component as a reference,
// not a value: its class strings come through as nothing, the Done reader's link
// lost its button, and neither the types nor a test here can tell. Only its
// components may cross.
describe("the page's server files", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
  const source = (f: string) => readFileSync(join(here, f), "utf8");
  const clientOnes = new Set(files.filter((f) => source(f).startsWith('"use client"')).map((f) => f.replace(/\.tsx?$/, "")));

  test.each(files.filter((f) => !clientOnes.has(f.replace(/\.tsx?$/, ""))))("%s takes only components from a client file", (f) => {
    const values = [...source(f).matchAll(/^import \{([^}]*)\} from "\.\/([^"]+)";$/gm)]
      .filter(([, , from]) => clientOnes.has(from!))
      .flatMap(([, names]) => names!.split(",").map((n) => n.trim()))
      .filter((n) => n && !n.startsWith("type ") && !/^[A-Z]/.test(n));
    expect(values).toEqual([]);
  });
});
