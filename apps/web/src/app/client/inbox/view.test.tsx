import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The reader's frame, in the markup. A 760px child in an auto grid track makes
// the track 760px whatever `max-w-full` says, so at a laptop's width the reader
// scrolled sideways and the Undo in its notice sat off the edge: E isn't
// confirmed, and that button is the way back.

vi.mock("next/navigation", () => ({ usePathname: () => "/client/inbox", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ dismissIssueAction: vi.fn(), restoreIssueAction: vi.fn(), fixIssueAction: vi.fn(), decideIssueAction: vi.fn() }));

import { DoneView } from "./done-view";
import { InboxView } from "./view";

const FRAME = 'class="grid grid-cols-[minmax(0,1fr)] content-start';
const row = { key: "k", kind: "late" as const, href: "/client/inbox?i=k", what: "Nobody has been in touch", who: null, line: "Sam", age: "9d ago", active: true };

describe("the reader's frame", () => {
  test("Open: the column holds to the pane, so the notice's Undo is on screen", () => {
    const html = renderToStaticMarkup(
      <InboxView
        rows={[row]}
        issue={{
          kind: "late",
          instance: { key: "k", reason: "quiet", at: "2026-10-20T10:00:00Z" },
          what: "Nobody has been in touch",
          subject: "Sam",
          card: { title: "t", detail: "d" },
          draft: null,
          fix: { type: "link", label: "Open candidate", href: "/client/candidates/p" },
          decision: null,
          terms: null,
          next: null,
          secondary: null,
          story: null,
          now: 0,
        }}
        flash={<p>Moved to Done.</p>}
        open
        truncated={false}
        draftsCapped={false}
      />,
    );
    expect(html).toContain(FRAME);
  });

  test("Done: the same", () => {
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
});

// "You're all caught up" is a claim about everything, and the reads have caps:
// a hundred dismissed drafts hold the whole of the drafts read, so older ones
// never reach the queue and the page has nothing left to say so on.
describe("all caught up", () => {
  const empty = (caps: { truncated: boolean; draftsCapped: boolean }) => renderToStaticMarkup(<InboxView rows={[]} issue={null} flash={null} open={false} {...caps} />);

  test("says so when a read stopped at its cap", () => {
    expect(empty({ truncated: false, draftsCapped: true })).toContain("Showing your newest 100 unsent drafts.");
    expect(empty({ truncated: true, draftsCapped: false })).toContain("some missing feedback may not be listed");
  });

  test("says nothing when nothing did", () => {
    const html = empty({ truncated: false, draftsCapped: false });
    expect(html).not.toContain("Showing your newest");
    expect(html).not.toContain("may not be listed");
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
