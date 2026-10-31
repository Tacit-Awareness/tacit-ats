import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The Inbox's frame, in the markup. No test here can run an effect (the repo
// has no DOM environment), so what the keys and the focus do in a browser is
// lib/client/inbox-popup.test.ts for the helpers and a look at the page for the rest.

vi.mock("next/navigation", () => ({ usePathname: () => "/client/inbox", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ dismissIssueAction: vi.fn(), restoreIssueAction: vi.fn(), fixIssueAction: vi.fn(), decideIssueAction: vi.fn(), markDigestReadAction: vi.fn(), markAllDigestReadAction: vi.fn() }));

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
  card: { title: "t", detail: "d" },
  draft: null,
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
const opened = (over: Partial<React.ComponentProps<typeof InboxView>> = {}) => view({ rows: [row, other], issue, ...over });

describe("the digest card", () => {
  test("says what's worth your time, then a row each: what's wrong, who, how long", () => {
    const html = view();
    expect(html).toContain("Welcome back");
    expect(html).toContain("2 worth your time, from 2 updates");
    expect(html).toContain("Needs you");
    expect(html).toContain("Waiting on feedback");
    expect(html).toContain("Dana · Lee");
    expect(html).toContain("2d ago");
    expect(view({ rows: [row] })).toContain("1 worth your time, from 1 update");
  });

  test("a row opens by URL, leaving the card's scroll alone", () => {
    expect(view()).toContain('href="/client/inbox?i=j"');
    expect(view()).toContain('data-issue-row="j"');
  });

  test("Open and Done are one pill group, Open picked and counted", () => {
    const html = view();
    expect(html).toMatch(/<nav aria-label="Inbox"[^>]*><a aria-current="page"[^>]*href="\/client\/inbox"/);
    expect(html).toContain('href="/client/inbox?tab=done"');
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
});

test("Done: the reader's column holds to the pane, as it did", () => {
  const html = renderToStaticMarkup(
    <DoneView
      rows={[row]}
      item={{ id: "i", what: "Nobody had been in touch", subject: "Sam", how: "Dismissed today", since: null, canMoveBack: false, candidateHref: null, story: null, now: 0 }}
      flash={null}
      open
      openCount={1}
      capped={false}
    />,
  );
  expect(html).toContain(FRAME);
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
    href: "/client/pipeline?open=a1",
    page: "/client/candidates/p1",
    age: "today",
  };
  const digest: DigestProps = { range: 3, asOf: "2026-10-31T12:00:00.000Z", now: 0, total: 9, shown: 3, unread: 7, capped: false, groups: [{ key: "decided", label: "Decisions made", rows: [info] }] };

  test("sits under Needs you, with the range and its own row", () => {
    const html = view({ digest });
    expect(html).toContain("3 worth your time, from 9 updates");
    expect(html.indexOf("Needs you")).toBeLessThan(html.indexOf("Decisions made"));
    expect(html).toContain('href="/client/pipeline?open=a1"');
    expect(html).toContain('href="/client/candidates/p1"');
    expect(html).toContain('aria-label="Mark read: Sam moves to an offer."');
    expect(html).toContain('value="2026-10-31T10:00:00.123456+00:00"');
  });

  test("the range is three links, the one picked marked, and Open and Done stay", () => {
    const html = view({ digest });
    expect(html).toMatch(/<nav aria-label="How far back"/);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/client\/inbox\?range=3"/);
    expect(html).toContain('href="/client/inbox?range=7"');
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

  test("a booking words its day in the browser, and the server names none", () => {
    const html = view({ digest: { ...digest, now: Date.parse("2026-11-01T00:00:00Z"), groups: [{ key: "booked", label: "Booked", rows: [{ ...info, interviewAt: "2026-11-03T09:00:00Z" }] }] } });
    expect(html).toContain("Interview coming up");
  });

  test("a cut-off read says so", () => {
    expect(view({ digest: { ...digest, capped: true } })).toContain("only the newest updates are listed");
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
